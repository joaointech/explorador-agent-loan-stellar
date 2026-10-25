import type { NoteStatusDto, RegistryResponse } from "@/lib/api-types";
import { registryNotes } from "@/lib/api/views";
import { handle, json } from "@/lib/http";
import { syncIfStale } from "@/lib/indexer/sync";

export const dynamic = "force-dynamic";

const PAGE = 20;
const STATUSES: NoteStatusDto[] = ["Active", "Settled", "Cancelled", "WrittenOff"];

export const GET = handle(async (req: Request) => {
  await syncIfStale();
  const sp = new URL(req.url).searchParams;
  const cursor = Number(sp.get("cursor") ?? 0) || null;
  const statusParam = sp.get("status");
  const status = STATUSES.find((s) => s.toLowerCase() === statusParam?.toLowerCase());
  const q = sp.get("q")?.trim().toLowerCase() ?? "";

  const all = (await registryNotes()).sort((a, b) => b.id - a.id);
  const counts = {
    active: all.filter((n) => n.status === "Active").length,
    settled: all.filter((n) => n.status === "Settled").length,
    cancelled: all.filter((n) => n.status === "Cancelled").length,
    writtenOff: all.filter((n) => n.status === "WrittenOff").length,
    total: all.length,
  };
  const filtered = all.filter(
    (n) =>
      (!status || n.status === status) &&
      (!q || String(n.id) === q.replace(/^#/, "") || n.agent.toLowerCase().includes(q) || n.commitment.startsWith(q) || n.nullifier.startsWith(q)),
  );
  const page = filtered.filter((n) => cursor === null || n.id < cursor).slice(0, PAGE);
  const last = page[page.length - 1];
  const nextCursor = last && filtered.some((n) => n.id < last.id) ? last.id : null;
  return json<RegistryResponse>({ notes: page, nextCursor, counts });
});
