import { Keypair, Operation, rpc, StrKey, TransactionBuilder, xdr } from "@stellar/stellar-sdk";
import { env } from "@/lib/env";

let server: rpc.Server | null = null;

export function rpcServer(): rpc.Server {
  server ??= new rpc.Server(env.rpcUrl, { allowHttp: env.rpcUrl.startsWith("http://") });
  return server;
}

export type Role = "admin" | "operator" | "treasury" | "sponsor";

export function keypair(role: Role): Keypair {
  switch (role) {
    case "admin":
      return Keypair.fromSecret(env.adminSecret);
    case "operator":
      return Keypair.fromSecret(env.operatorSecret);
    case "treasury":
      return Keypair.fromSecret(env.treasurySecret);
    case "sponsor":
      return Keypair.fromSecret(env.sponsorSecret);
  }
}

export function publicKey(role: Role): string {
  return keypair(role).publicKey();
}

export function explorerUrl(id: string): string {
  const net = env.network === "public" || env.network === "mainnet" ? "public" : "testnet";
  if (/^[0-9a-f]{64}$/i.test(id)) return `https://stellar.expert/explorer/${net}/tx/${id}`;
  if (id.startsWith("C")) return `https://stellar.expert/explorer/${net}/contract/${id}`;
  return `https://stellar.expert/explorer/${net}/account/${id}`;
}

export async function friendbot(address: string): Promise<void> {
  const res = await fetch(`https://friendbot.stellar.org/?addr=${encodeURIComponent(address)}`);
  if (!res.ok) {
    const text = await res.text();
    if (!/createAccountAlreadyExist|already funded/i.test(text)) throw new Error(`Friendbot failed for ${address}: ${text.slice(0, 200)}`);
  }
}

export async function accountExists(address: string): Promise<boolean> {
  try {
    await rpcServer().getAccount(address);
    return true;
  } catch {
    return false;
  }
}

export function withTimeout<T>(p: Promise<T>, ms: number, label = "operation"): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

export async function xlmBalance(address: string): Promise<bigint> {
  const key = xdr.LedgerKey.account(new xdr.LedgerKeyAccount({ accountId: xdr.PublicKey.publicKeyTypeEd25519(StrKey.decodeEd25519PublicKey(address)) }));
  const r = await rpcServer().getLedgerEntries(key);
  return r.entries[0] ? BigInt(r.entries[0].val.account().balance().toString()) : 0n;
}

/**
 * Tops `target` up to at least `minXlm` by funding throwaway accounts with Friendbot and
 * merging them into it (Friendbot gives ~10,000 XLM per account). Testnet only.
 */
export async function ensureXlm(target: string, minXlm: number, log: (l: string) => void = console.log): Promise<void> {
  const min = BigInt(minXlm) * 10_000_000n;
  for (let i = 0; i < 20; i++) {
    const bal = await xlmBalance(target);
    if (bal >= min) return;
    const tmp = Keypair.random();
    await friendbot(tmp.publicKey());
    const acct = await rpcServer().getAccount(tmp.publicKey());
    const tx = new TransactionBuilder(acct, { fee: "1000", networkPassphrase: env.networkPassphrase })
      .addOperation(Operation.accountMerge({ destination: target }))
      .setTimeout(60)
      .build();
    tx.sign(tmp);
    const sent = await rpcServer().sendTransaction(tx);
    if (sent.status === "ERROR") throw new Error(`account merge failed: ${sent.errorResult?.result().switch().name}`);
    for (let j = 0; j < 30; j++) {
      const r = await rpcServer().getTransaction(sent.hash);
      if (r.status === rpc.Api.GetTransactionStatus.SUCCESS) break;
      if (r.status === rpc.Api.GetTransactionStatus.FAILED) throw new Error("account merge failed");
      await new Promise((res) => setTimeout(res, 1000));
    }
    log(`topped up ${target.slice(0, 6)}… (${Number(bal / 10_000_000n)} XLM → +10,000)`);
  }
}
