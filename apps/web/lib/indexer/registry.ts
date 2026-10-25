// Public registry read model (spec §9.7, §10.2): notes are live chain state;
// tx hashes, timelines and the written-off status come from indexed events;
// the snarkjs proof + public signals come from `Cpcv.proof` when the row
// matches the note's commitment. Never reads or returns PII: Cpcv queries
// select public columns only.

import { z } from "zod";

import { db, Prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { isOverdue } from "@/lib/pool/clock";
import { getPoolStatsCached } from "@/lib/pool/stats-cache";
import { readLine, readNote } from "@/lib/stellar/contracts";
import { requireDeployment, resolveDeployment, type ResolvedDeployment } from "@/lib/stellar/deployment";
import { publicSignalsFromNote, sorobanProofToSnarkjs } from "@/lib/stellar/proof";
import type {
  RegistryDetailResponse,
  RegistryListResponse,
  RegistryNote,
  RegistryStatus,
  SnarkjsProof,
  StatusCounts,
  TimelineEvent,
} from "@/lib/types/api";
import type { Note } from "@/lib/types/chain";
import { BPS, DAY_SECS, PARAMS, stroopsToEur } from "@/lib/units";

import { attributeDraws, type LineWindow, type Position } from "./attribution";
import { dataBigInt, dataNumber, EventType } from "./events";
import { getAllNotes } from "./notes";
import { loadAgentEvents, loadCreditLimits, loadMintTxHashes, loadWrittenOffNoteIds, type StoredEvent } from "./queries";

export const REGISTRY_STATUSES = ["Active", "Settled", "Cancelled", "WrittenOff"] as const satisfies readonly RegistryStatus[];

/** What the proof keeps private (spec §8.1). */
export const HIDDEN_FIELDS = ["Buyer name", "Buyer NIF", "Seller name", "Seller NIF", "Sale price", "Commission rate", "Property address", "CPCV date"];

export const emptyCounts = (): StatusCounts => ({ Active: 0, Settled: 0, Cancelled: 0, WrittenOff: 0, total: 0 });

export function countStatuses(statuses: RegistryStatus[]): StatusCounts {
  const counts = emptyCounts();
  for (const s of statuses) counts[s]++;
  counts.total = statuses.length;
  return counts;
}

// ---------- context shared by list / detail / metadata ----------

interface CpcvInfo {
  status: string;
  mintTxHash: string | null;
  commitment: string;
  proof: unknown;
}

interface RegistryContext {
  writtenOff: Set<number>;
  creditLimits: Map<number, bigint>;
  mintTx: Map<number, string>;
  cpcv: Map<number, CpcvInfo>;
  protocolNow: bigint | null;
  ltvBps: number;
}

const normHex = (hex: string) => hex.toLowerCase().replace(/^0x/, "");
/** A Cpcv row describes this on-chain note only if the commitments match (guards against rows of an older deployment). */
const sameDeal = (row: CpcvInfo | undefined, note: Note): row is CpcvInfo => !!row && normHex(row.commitment) === normHex(note.commitment);

async function loadCpcvInfo(noteIds: number[]): Promise<Map<number, CpcvInfo>> {
  if (noteIds.length === 0) return new Map();
  const rows = await db.cpcv.findMany({
    where: { noteId: { in: noteIds } },
    select: { noteId: true, status: true, mintTxHash: true, commitment: true, proof: true },
  });
  return new Map(rows.filter((r) => r.noteId !== null).map((r) => [r.noteId as number, { status: r.status, mintTxHash: r.mintTxHash, commitment: r.commitment, proof: r.proof }]));
}

async function loadContext(d: ResolvedDeployment, noteIds: number[]): Promise<RegistryContext> {
  const [writtenOff, creditLimits, mintTx, cpcv, stats] = await Promise.all([
    loadWrittenOffNoteIds(d.info.advancePool),
    loadCreditLimits(d.info.advancePool),
    loadMintTxHashes(d.info.cpcvNote),
    loadCpcvInfo(noteIds),
    getPoolStatsCached().catch(() => null),
  ]);
  return { writtenOff, creditLimits, mintTx, cpcv, protocolNow: stats?.protocolNow ?? null, ltvBps: stats?.params.ltvBps ?? PARAMS.ltvBps };
}

function registryStatus(note: Note, ctx: RegistryContext): RegistryStatus {
  if (note.status !== "Cancelled") return note.status;
  const row = ctx.cpcv.get(note.id);
  return ctx.writtenOff.has(note.id) || (sameDeal(row, note) && row.status === "WRITTEN_OFF") ? "WrittenOff" : "Cancelled";
}

const creditLimitOf = (note: Note, ctx: RegistryContext): bigint =>
  ctx.creditLimits.get(note.id) ?? (note.agentCommission * BigInt(ctx.ltvBps)) / BPS;

function toRegistryNote(note: Note, ctx: RegistryContext): RegistryNote {
  const row = ctx.cpcv.get(note.id);
  return {
    id: note.id,
    agent: note.agent,
    totalCommission: note.totalCommission.toString(),
    agentCommission: note.agentCommission.toString(),
    exploradorCommission: note.exploradorCommission.toString(),
    creditLimit: creditLimitOf(note, ctx).toString(),
    escrituraDay: note.escrituraDay,
    status: registryStatus(note, ctx),
    overdue: ctx.protocolNow !== null && isOverdue(note.status, note.escrituraDay, ctx.protocolNow),
    mintedAt: Number(note.mintedAt),
    mintTxHash: ctx.mintTx.get(note.id) ?? (sameDeal(row, note) ? row.mintTxHash : null),
  };
}

// ---------- list ----------

export interface RegistryQuery {
  /** Opaque: the id of the last note of the previous page (pages go newest first). */
  cursor?: string | null;
  status?: RegistryStatus | null;
  /** Note id ("12", "#12") or agent address: full, partial, or truncated "CDLZ…4XQA". */
  q?: string | null;
  limit?: number;
}

export const DEFAULT_PAGE_SIZE = 25;

export function matchesQuery(note: { id: number; agent: string }, q: string): boolean {
  const term = q.trim();
  if (term === "") return true;
  if (/^#?\d+$/.test(term)) return note.id === Number(term.replace("#", ""));
  const agent = note.agent.toUpperCase();
  const parts = term.toUpperCase().split(/…|\.\.\./);
  if (parts.length === 2 && parts[0] && parts[1]) return agent.startsWith(parts[0]) && agent.endsWith(parts[1]);
  return agent.includes(term.toUpperCase());
}

export async function getRegistryList(query: RegistryQuery = {}): Promise<RegistryListResponse> {
  const deployment = await resolveDeployment();
  if (!deployment) return { notes: [], nextCursor: null, counts: emptyCounts() };
  const notes = await getAllNotes();
  const ctx = await loadContext(deployment, notes.map((n) => n.id));
  const all = notes.map((n) => toRegistryNote(n, ctx)).sort((a, b) => b.id - a.id);
  const counts = countStatuses(all.map((n) => n.status));

  const limit = Math.max(1, Math.min(100, query.limit ?? DEFAULT_PAGE_SIZE));
  const after = query.cursor && /^\d+$/.test(query.cursor) ? Number(query.cursor) : null;
  const filtered = all.filter(
    (n) => (!query.status || n.status === query.status) && (!query.q || matchesQuery(n, query.q)) && (after === null || n.id < after),
  );
  const page = filtered.slice(0, limit);
  return { notes: page, nextCursor: filtered.length > limit ? String(page[page.length - 1].id) : null, counts };
}

/** Counts of notes by registry status (for the pool stats endpoint and the landing page). */
export async function getStatusCounts(): Promise<StatusCounts> {
  const deployment = await resolveDeployment();
  if (!deployment) return emptyCounts();
  const notes = await getAllNotes();
  const ctx = await loadContext(deployment, notes.filter((n) => n.status === "Cancelled").map((n) => n.id));
  return countStatuses(notes.map((n) => registryStatus(n, ctx)));
}

// ---------- detail ----------

const storedProofSchema = z.object({
  proof: z.object({
    pi_a: z.array(z.string()).min(2),
    pi_b: z.array(z.array(z.string()).length(2)).min(2),
    pi_c: z.array(z.string()).min(2),
  }),
  publicSignals: z.array(z.string()).length(9),
});

/** `Cpcv.proof` JSON `{ proof, publicSignals }` (spec §9.1), normalized to SnarkjsProof. */
export function parseStoredProof(raw: unknown): { proof: SnarkjsProof; publicSignals: string[] } | null {
  const parsed = storedProofSchema.safeParse(raw);
  if (!parsed.success) return null;
  const { pi_a, pi_b, pi_c } = parsed.data.proof;
  return { proof: { pi_a, pi_b, pi_c, protocol: "groth16", curve: "bn128" }, publicSignals: parsed.data.publicSignals };
}

/** Attester key + nullifier-secret commitment (public signals 6–8): contract constants without a view, taken from any stored proof. */
async function loadAttesterConstants(): Promise<{ attesterAx: string; attesterAy: string; nullifierSecretCommitment: string } | null> {
  const rows = await db.cpcv.findMany({ where: { proof: { not: Prisma.AnyNull } }, select: { proof: true }, orderBy: { createdAt: "desc" }, take: 5 });
  for (const r of rows) {
    const stored = parseStoredProof(r.proof);
    if (stored) {
      const [, , , , , , attesterAx, attesterAy, nullifierSecretCommitment] = stored.publicSignals;
      return { attesterAx, attesterAy, nullifierSecretCommitment };
    }
  }
  return null;
}

const position = (e: StoredEvent): Position => ({ ledger: e.ledger, eventIdx: e.eventIdx });
const NEVER: Position = { ledger: 0, eventIdx: -1 };
const NOTE_LIFECYCLE = new Set<string>([EventType.NoteMinted, EventType.LineOpened, EventType.NoteSettled, EventType.NoteCancelled]);

function toTimeline(e: StoredEvent, extra: Record<string, unknown> = {}): TimelineEvent {
  return { type: e.type, at: e.protocolTs === null ? null : Number(e.protocolTs), ledger: e.ledger, txHash: e.txHash, data: { ...e.data, ...extra } };
}

/** Line windows of every note of the agent, for draw attribution. Missing events = before RPC retention. */
function lineWindows(agentNotes: Note[], events: StoredEvent[], ctx: RegistryContext): LineWindow[] {
  return agentNotes.map((n) => {
    const opened = events.find((e) => (e.type === EventType.LineOpened && dataNumber(e.data, "noteId") === n.id) || (e.type === EventType.NoteMinted && dataNumber(e.data, "id") === n.id));
    const closed = events.find((e) => (e.type === EventType.NoteSettled || e.type === EventType.NoteCancelled) && dataNumber(e.data, "noteId") === n.id);
    return {
      noteId: n.id,
      escrituraDay: n.escrituraDay,
      creditLimit: creditLimitOf(n, ctx),
      opened: opened ? position(opened) : NEVER,
      closed: closed ? position(closed) : n.status === "Active" ? null : NEVER,
    };
  });
}

export async function getRegistryDetail(id: number): Promise<RegistryDetailResponse> {
  const deployment = await requireDeployment();
  const note = await readNote(id);
  const [ctx, events, allNotes] = await Promise.all([
    loadContext(deployment, [id]),
    loadAgentEvents(note.agent, [deployment.info.cpcvNote, deployment.info.advancePool]),
    getAllNotes().catch(() => [note]),
  ]);
  const base = toRegistryNote(note, ctx);

  // draws attributed to this note
  const agentNotes = allNotes.filter((n) => n.agent === note.agent);
  if (!agentNotes.some((n) => n.id === id)) agentNotes.push(note);
  const drawEvents = events.filter((e) => e.type === EventType.CardDraw);
  const shares = attributeDraws(
    lineWindows(agentNotes, events, ctx),
    drawEvents.map((e) => ({ at: position(e), fromCredit: dataBigInt(e.data, "fromCredit") ?? 0n })),
  ).map((m) => m.get(id) ?? 0n);
  const myDraws = drawEvents.map((e, i) => ({ e, share: shares[i] })).filter((d) => d.share > 0n);

  const settled = events.find((e) => e.type === EventType.NoteSettled && dataNumber(e.data, "noteId") === id);
  const cancelled = events.find((e) => e.type === EventType.NoteCancelled && dataNumber(e.data, "noteId") === id);
  let drawsTotal = myDraws.reduce((sum, d) => sum + d.share, 0n);
  if (settled) {
    drawsTotal = (dataBigInt(settled.data, "debtRepaid") ?? 0n) - (dataBigInt(settled.data, "interestPaid") ?? 0n);
  } else if (note.status === "Active") {
    drawsTotal = await readLine(id).then((l) => l.line.principal, () => drawsTotal);
  }

  // timeline: minted, line opened, attributed draws, settled / cancelled, written off
  const timeline: TimelineEvent[] = [];
  for (const e of events) {
    if (!NOTE_LIFECYCLE.has(e.type)) continue;
    if (dataNumber(e.data, e.type === EventType.NoteMinted ? "id" : "noteId") === id) timeline.push(toTimeline(e));
  }
  for (const d of myDraws) timeline.push(toTimeline(d.e, { attributedToNote: d.share.toString() }));
  if (base.status === "WrittenOff" && cancelled) {
    const writeOff = events.find((e) => e.type === EventType.DebtWrittenOff && (e.ledger > cancelled.ledger || (e.ledger === cancelled.ledger && e.eventIdx > cancelled.eventIdx)));
    if (writeOff) timeline.push(toTimeline(writeOff));
  }
  timeline.sort((a, b) => a.ledger - b.ledger);

  // proof: stored snarkjs proof + signals when the Cpcv row matches; else derived from chain data
  const row = ctx.cpcv.get(id);
  const stored = sameDeal(row, note) ? parseStoredProof(row.proof) : null;
  let snarkjsProof: SnarkjsProof | null = stored?.proof ?? null;
  if (!snarkjsProof) {
    try {
      snarkjsProof = sorobanProofToSnarkjs(note.proof);
    } catch {
      snarkjsProof = null;
    }
  }
  let publicSignals = stored?.publicSignals ?? [];
  if (publicSignals.length !== 9) {
    const constants = await loadAttesterConstants();
    publicSignals = constants ? publicSignalsFromNote(note, constants) : [];
  }

  return {
    note: { ...base, commitment: note.commitment, nullifier: note.nullifier, proof: { a: note.proof.a, b: note.proof.b, c: note.proof.c } },
    publicSignals,
    snarkjsProof,
    draws: { count: myDraws.length, total: drawsTotal.toString() },
    timeline,
    hidden: HIDDEN_FIELDS,
  };
}

// ---------- SEP-50 token metadata ----------

export interface NoteMetadata {
  name: string;
  description: string;
  image: string;
  external_url: string;
  attributes: { trait_type: string; value: string | number; display_type?: "number" | "date" }[];
}

const isoDay = (day: number) => new Date(day * DAY_SECS * 1000).toISOString().slice(0, 10);
const eur = (stroops: bigint) => Math.round(stroopsToEur(stroops) * 100) / 100;

/** `token_uri` target (spec §7.2): name, description, image, attributes. Public data only. */
export async function getNoteMetadata(id: number): Promise<NoteMetadata> {
  const deployment = await requireDeployment();
  const note = await readNote(id);
  const ctx = await loadContext(deployment, [id]);
  const status = registryStatus(note, ctx);
  const appUrl = env().APP_URL.replace(/\/$/, "");
  return {
    name: `explorador advance CPCV Note #${id}`,
    description:
      "Soulbound CPCV Note on explorador advance. A zero-knowledge proof, verified on Stellar, attests that explorador signed this deal's promissory purchase contract (CPCV) and that the commission and the agent's half are computed correctly. The note is the collateral for the agent's card credit line. No personal data: buyer, seller, their NIFs, sale price, commission rate, property and CPCV date stay private.",
    image: `${appUrl}/logo.svg`,
    external_url: `${appUrl}/registry/${id}`,
    attributes: [
      { trait_type: "Status", value: status },
      { trait_type: "Agent", value: note.agent },
      { trait_type: "Total commission (EUR)", value: eur(note.totalCommission), display_type: "number" },
      { trait_type: "Agent commission (EUR)", value: eur(note.agentCommission), display_type: "number" },
      { trait_type: "explorador commission (EUR)", value: eur(note.exploradorCommission), display_type: "number" },
      { trait_type: "Credit limit (EUR)", value: eur(creditLimitOf(note, ctx)), display_type: "number" },
      { trait_type: "Escritura date", value: isoDay(note.escrituraDay) },
      { trait_type: "Minted", value: Number(note.mintedAt), display_type: "date" },
      { trait_type: "Commitment", value: `0x${note.commitment}` },
      { trait_type: "Nullifier", value: `0x${note.nullifier}` },
    ],
  };
}
