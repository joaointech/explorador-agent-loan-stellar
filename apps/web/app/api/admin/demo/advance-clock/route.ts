// POST /api/admin/demo/advance-clock (admin, DEMO_MODE only): fast-forward the
// protocol clock (spec §5.7) by `{ days }` (1–400) or to just past an agent's
// grace deadline with `{ toGraceDeadlineOf: <agent user id> }`.

import { advanceDemoClock } from "@/lib/admin/clock";
import { requireAdminMutation } from "@/lib/admin/guard";
import { advanceClockSchema } from "@/lib/admin/schemas";
import { parseBody, route } from "@/lib/http";
import { jsonResponse } from "@/lib/json";
import type { AdvanceClockResponse } from "@/lib/types/api";

// One (rarely two) testnet transactions.
export const maxDuration = 60;

export const POST = route(async (req: Request) => {
  await requireAdminMutation(req);
  const body = await parseBody(req, advanceClockSchema);
  return jsonResponse<AdvanceClockResponse>(await advanceDemoClock(body));
});
