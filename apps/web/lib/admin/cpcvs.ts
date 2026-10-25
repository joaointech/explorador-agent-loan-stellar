// Reads behind GET /api/admin/cpcv and GET /api/admin/cpcv/[id].

import { z } from "zod";

import { db } from "@/lib/db";
import { notFound } from "@/lib/http";
import { readAgentPosition, readLine } from "@/lib/stellar/contracts";
import type { AdminCpcvDetailResponse, AdminCpcvListResponse, SnarkjsProof } from "@/lib/types/api";

import { protocolDayOf, readDemoClock } from "./clock";
import { cpcvWithAgent, toAdminCpcvRow, tryDecryptPii } from "./rows";

/** The table shows the latest CPCVs; older ones stay in the database. */
const LIST_LIMIT = 500;

export async function listAdminCpcvs(): Promise<AdminCpcvListResponse> {
  const [rows, clock] = await Promise.all([
    db.cpcv.findMany({ include: cpcvWithAgent, orderBy: { createdAt: "desc" }, take: LIST_LIMIT }),
    readDemoClock(),
  ]);
  const day = protocolDayOf(clock);
  return { cpcvs: rows.map((row) => toAdminCpcvRow(row, day)), clock };
}

const storedProofSchema = z.object({
  proof: z.looseObject({
    pi_a: z.array(z.string()),
    pi_b: z.array(z.array(z.string())),
    pi_c: z.array(z.string()),
  }),
  publicSignals: z.array(z.string()),
});

/** `Cpcv.proof` as written by the pipeline (`{ proof, publicSignals }`); null when absent or malformed. */
export function parseStoredProof(json: unknown): AdminCpcvDetailResponse["proof"] {
  const parsed = storedProofSchema.safeParse(json);
  if (!parsed.success) return null;
  const proof: SnarkjsProof = { ...parsed.data.proof, protocol: "groth16", curve: "bn128" };
  return { proof, publicSignals: parsed.data.publicSignals };
}

const quiet = <T>(promise: Promise<T>): Promise<T | null> => promise.catch(() => null);

export async function getAdminCpcvDetail(id: string): Promise<AdminCpcvDetailResponse> {
  const row = await db.cpcv.findUnique({ where: { id }, include: cpcvWithAgent });
  if (!row) throw notFound("There is no CPCV with this id");

  const pii = tryDecryptPii(row);
  const active = row.status === "MINTED" && row.noteId !== null;
  const [clock, line, position] = await Promise.all([
    readDemoClock(),
    active ? quiet(readLine(row.noteId!)) : Promise.resolve(null),
    quiet(readAgentPosition(row.agent.smartAccount)),
  ]);

  return {
    cpcv: toAdminCpcvRow(row, protocolDayOf(clock), pii),
    commitment: row.commitment,
    nullifier: row.nullifier,
    salt: pii?.salt ?? null,
    proof: parseStoredProof(row.proof),
    line: line
      ? {
          creditLimit: line.line.creditLimit.toString(),
          principal: line.line.principal.toString(),
          debt: line.debt.toString(),
          interest: line.interest.toString(),
          available: line.available.toString(),
        }
      : null,
    agentPosition: position
      ? {
          cardBalance: position.cardBalance.toString(),
          carriedDebt: position.carriedDebt.toString(),
          graceDeadline: position.graceDeadline === null ? null : Number(position.graceDeadline),
        }
      : null,
    clock,
  };
}
