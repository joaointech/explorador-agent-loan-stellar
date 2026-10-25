import type { StellarConfigResponse } from "@/lib/api-types";
import { contractsDto } from "@/lib/api/views";
import { env } from "@/lib/env";
import { handle, json } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = handle(async () =>
  json<StellarConfigResponse>({
    rpcUrl: env.rpcUrl,
    networkPassphrase: env.networkPassphrase,
    accountWasmHash: env.accountWasmHash,
    webauthnVerifier: env.webauthnVerifier,
    ed25519Verifier: env.ed25519Verifier,
    nativeToken: env.nativeToken,
    rpId: env.rpId,
    rpName: env.rpName,
    contracts: await contractsDto(),
  }),
);
