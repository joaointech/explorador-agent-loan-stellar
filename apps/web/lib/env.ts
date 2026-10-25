// Server configuration (§11.3). Read lazily so `next build` works without secrets.

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name} (run \`pnpm keys:generate\`)`);
  return v;
}

function opt(name: string): string | undefined {
  const v = process.env[name];
  return v && v.length > 0 ? v : undefined;
}

export const env = {
  get databaseUrl() {
    return req("DATABASE_URL");
  },
  get appUrl() {
    return (opt("APP_URL") ?? "http://localhost:3000").replace(/\/$/, "");
  },
  get sessionSecret() {
    return req("SESSION_SECRET");
  },
  get adminEmails(): string[] {
    return (opt("ADMIN_EMAILS") ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  },
  get resendApiKey() {
    return opt("RESEND_API_KEY");
  },
  get emailFrom() {
    return opt("EMAIL_FROM") ?? "explorador advance <advance@explorador.pt>";
  },
  get rpId() {
    return opt("WEBAUTHN_RP_ID") ?? "localhost";
  },
  get rpName() {
    return opt("WEBAUTHN_RP_NAME") ?? "explorador advance";
  },
  get network() {
    return opt("STELLAR_NETWORK") ?? "testnet";
  },
  get rpcUrl() {
    return opt("STELLAR_RPC_URL") ?? "https://soroban-testnet.stellar.org";
  },
  get horizonUrl() {
    return opt("STELLAR_HORIZON_URL") ?? "https://horizon-testnet.stellar.org";
  },
  get networkPassphrase() {
    return opt("STELLAR_NETWORK_PASSPHRASE") ?? "Test SDF Network ; September 2015";
  },
  get adminSecret() {
    return req("ADMIN_SECRET");
  },
  get operatorSecret() {
    return req("OPERATOR_SECRET");
  },
  get treasurySecret() {
    return req("TREASURY_SECRET");
  },
  get cardSettlementPublic() {
    return req("CARD_SETTLEMENT_PUBLIC");
  },
  get sponsorSecret() {
    return req("SPONSOR_SECRET");
  },
  get demoMode() {
    return (opt("DEMO_MODE") ?? "true").toLowerCase() === "true";
  },
  get attesterPrivKey() {
    return req("ATTESTER_EDDSA_PRIVKEY");
  },
  get nullifierSecret(): bigint {
    const v = req("NULLIFIER_SECRET");
    return BigInt(v.startsWith("0x") ? v : `0x${v}`);
  },
  get piiKey(): Buffer {
    const k = Buffer.from(req("PII_ENCRYPTION_KEY"), "hex");
    if (k.length !== 32) throw new Error("PII_ENCRYPTION_KEY must be 32 bytes hex");
    return k;
  },
  get lithicApiKey() {
    return opt("LITHIC_API_KEY");
  },
  get lithicAsaSecret() {
    return opt("LITHIC_ASA_HMAC_SECRET");
  },
  /** OpenZeppelin smart-account contracts already deployed on testnet (see DECISIONS.md). */
  get accountWasmHash() {
    return opt("SMART_ACCOUNT_WASM_HASH") ?? "1b5f4534a76322da2ad7c745f6900857a6802b0ca79850c35a03561df997785a";
  },
  get webauthnVerifier() {
    return opt("WEBAUTHN_VERIFIER_ADDRESS") ?? "CC7EKIHQP3TN4CARQDND6CEOY2UXLWWC2X5GHTD5NLAT7BG5GPZIOM3F";
  },
  get ed25519Verifier() {
    return opt("ED25519_VERIFIER_ADDRESS") ?? "CAAVTMCBXEIBPR64EAASKFXERVPYFZA2JYP5A3BG6PESWEFUJX5IHKN4";
  },
  get nativeToken() {
    return opt("NATIVE_TOKEN_CONTRACT") ?? "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
  },
  get cronSecret() {
    return opt("CRON_SECRET");
  },
};
