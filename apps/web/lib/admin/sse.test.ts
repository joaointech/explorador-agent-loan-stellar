import { describe, expect, it, vi } from "vitest";

import { HttpError } from "@/lib/http";
import { ContractError, TxError } from "@/lib/stellar/errors";

import { chainHttpError, contractErrorCode } from "./chain-errors";
import { encodeSseEvent, sseStream } from "./sse";
import { createSseParser, isEventStream, readSseEvents } from "./sse-parser";

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe("SSE wire format", () => {
  it("encodes one data frame per event", () => {
    expect(decode(encodeSseEvent({ step: "validating", status: "started" }))).toBe('data: {"step":"validating","status":"started"}\n\n');
  });

  it("parses frames split across arbitrary chunks, ignoring comments and other fields", () => {
    const seen: string[] = [];
    const parser = createSseParser((d) => seen.push(d));
    const wire = ': keepalive\n\ndata: {"a":1}\n\nevent: x\nid: 7\ndata: {"b":\ndata: 2}\r\n\r\ndata: {"c":3}';
    for (let i = 0; i < wire.length; i += 3) parser.push(wire.slice(i, i + 3));
    expect(seen).toEqual(['{"a":1}', '{"b":\n2}']);
    parser.flush();
    expect(seen).toEqual(['{"a":1}', '{"b":\n2}', '{"c":3}']);
  });

  it("streams events from the server helper to the client reader", async () => {
    const { response, done } = sseStream<{ n: number }>(async (writer) => {
      for (let n = 1; n <= 3; n++) {
        writer.send({ n });
        await new Promise((r) => setTimeout(r, 5));
      }
    });
    expect(isEventStream(response)).toBe(true);
    expect(response.headers.get("cache-control")).toContain("no-cache");
    const events: { n: number }[] = [];
    await readSseEvents<{ n: number }>(response, (e) => events.push(e));
    await done;
    expect(events).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
  });

  it("keeps running when the client disconnects, and sends keepalives while idle", async () => {
    let finished = false;
    const { response, done } = sseStream<{ n: number }>(
      async (writer) => {
        writer.send({ n: 1 });
        await new Promise((r) => setTimeout(r, 40));
        expect(writer.closed).toBe(true);
        writer.send({ n: 2 }); // no-op, must not throw
        finished = true;
      },
      { keepaliveMs: 5 },
    );
    const reader = response.body!.getReader();
    const first = decode((await reader.read()).value!);
    expect(first).toBe('data: {"n":1}\n\n');
    const second = decode((await reader.read()).value!);
    expect(second).toBe(": keepalive\n\n");
    await reader.cancel();
    await done;
    expect(finished).toBe(true);
  });

  it("logs and closes the stream when the operation throws", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const { response, done } = sseStream(async () => {
      throw new Error("boom");
    });
    await done;
    expect(await response.text()).toBe("");
    expect(logged).toHaveBeenCalledWith("[admin] streamed operation failed", expect.any(Error));
    logged.mockRestore();
  });
});

describe("chain errors", () => {
  it("finds contract error numbers and names, including in causes", () => {
    expect(contractErrorCode(new Error("HostError: Error(Contract, #10)"))).toBe(10);
    expect(contractErrorCode(new Error("simulation failed", { cause: new Error("Error(Contract, #9)") }))).toBe(9);
    expect(contractErrorCode("GraceNotOver")).toBe(10);
    expect(contractErrorCode(new Error("timeout"))).toBeNull();
  });

  it("maps them to HTTP errors with admin-readable messages", () => {
    const grace = chainHttpError(new Error("Error(Contract, #10)"));
    expect(grace).toMatchObject({ status: 409, code: "GRACE_NOT_OVER", message: "The grace period has not ended yet" });
    expect(chainHttpError(new Error("Error(Contract, #6)"), { 6: "Too much leverage" })).toMatchObject({ code: "LEVERAGE_CAP_EXCEEDED", message: "Too much leverage" });
    expect(chainHttpError(new Error("socket hang up"))).toMatchObject({ status: 502, code: "CHAIN_ERROR", message: "Stellar call failed: socket hang up" });
    const stub = new HttpError(501, "NOT_IMPLEMENTED", "mintNote is not implemented yet");
    expect(chainHttpError(stub)).toBe(stub);
  });

  it("rewords lib/stellar's typed contract errors and names failed transactions", () => {
    const contract = new ContractError(6, "junior_withdraw");
    expect(contractErrorCode(contract)).toBe(6);
    expect(chainHttpError(contract, { 6: "Too much leverage" })).toMatchObject({ status: 409, code: "LEVERAGE_CAP_EXCEEDED", message: "Too much leverage" });
    // Keeps lib/stellar's status (InvalidProof → 400) with the admin wording.
    expect(chainHttpError(new ContractError(13, "mint"))).toMatchObject({ status: 400, code: "INVALID_PROOF", message: "The note contract rejected the zero-knowledge proof" });
    expect(chainHttpError(new ContractError(10, "write_off", undefined, "f00d"))).toMatchObject({
      code: "GRACE_NOT_OVER",
      message: "The grace period has not ended yet (transaction f00d)",
    });
    const timeout = chainHttpError(new TxError("TX_TIMEOUT", "settle was not confirmed in 75 s", "beef"));
    expect(timeout).toMatchObject({ status: 504, code: "TX_TIMEOUT", message: "settle was not confirmed in 75 s (transaction beef)" });
    expect(contractErrorCode(new Error("settle: LineNotActive (contract error #9)"))).toBe(9);
  });
});
