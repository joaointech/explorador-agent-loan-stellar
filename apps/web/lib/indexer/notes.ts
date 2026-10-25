// All notes from the registry contract (live state, spec §6), cached briefly
// and shared by the registry list, the status counts and the pool stats.

import { MAX_LIST_LIMIT, readNoteCount, readNotes } from "@/lib/stellar/contracts";
import { requireDeployment } from "@/lib/stellar/deployment";
import type { Note } from "@/lib/types/chain";

const CACHE_MS = 5_000;

type Cache = { key: string; at: number; notes: Note[] };
const g = globalThis as unknown as { advanceNotes?: Cache; advanceNotesInflight?: { key: string; promise: Promise<Note[]> } };

async function fetchAll(): Promise<Note[]> {
  const count = await readNoteCount();
  if (count === 0) return [];
  // `list(start, limit)` pages from `start`; one extra page covers ids starting at 0 or 1.
  const pages = Math.ceil((count + 1) / MAX_LIST_LIMIT);
  const results = await Promise.allSettled(Array.from({ length: pages }, (_, i) => readNotes(i * MAX_LIST_LIMIT, MAX_LIST_LIMIT)));
  if (results[0].status === "rejected") throw results[0].reason;
  const byId = new Map<number, Note>();
  for (const r of results) if (r.status === "fulfilled") for (const n of r.value) byId.set(n.id, n);
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

/** Every note of the current deployment, ascending by id (cached 5 s). */
export async function getAllNotes(opts: { fresh?: boolean } = {}): Promise<Note[]> {
  const { key } = await requireDeployment();
  const cached = g.advanceNotes;
  if (!opts.fresh && cached && cached.key === key && Date.now() - cached.at < CACHE_MS) return cached.notes;
  if (g.advanceNotesInflight?.key === key) return g.advanceNotesInflight.promise;
  const promise = fetchAll()
    .then((notes) => {
      g.advanceNotes = { key, at: Date.now(), notes };
      return notes;
    })
    .finally(() => {
      if (g.advanceNotesInflight?.promise === promise) g.advanceNotesInflight = undefined;
    });
  g.advanceNotesInflight = { key, promise };
  return promise;
}
