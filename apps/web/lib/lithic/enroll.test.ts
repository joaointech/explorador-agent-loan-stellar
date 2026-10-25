import { beforeEach, describe, expect, it, vi } from "vitest";

const lithic = vi.hoisted(() => ({
  responderEndpoints: { checkStatus: vi.fn(), create: vi.fn(), delete: vi.fn() },
  authStreamEnrollment: { retrieveSecret: vi.fn() },
}));
vi.mock("./client", () => ({ getLithic: () => lithic }));
vi.mock("./rate-limit", () => ({ createSpacer: () => <T>(fn: () => Promise<T>) => fn() }));

import { asaResponderUrl, enrollAsaResponder, isPublicUrl } from "./enroll";

const SECRET = "whsec_1NDsYinMGr951KuDEaj78VtWzlyPaOnwUVagFiWIPJs=";
const APP = "https://advance-demo.trycloudflare.com";

describe("ASA responder enrollment", () => {
  beforeEach(() => {
    lithic.responderEndpoints.checkStatus.mockReset();
    lithic.responderEndpoints.create.mockReset().mockResolvedValue({ enrolled: true });
    lithic.responderEndpoints.delete.mockReset().mockResolvedValue(undefined);
    lithic.authStreamEnrollment.retrieveSecret.mockReset().mockResolvedValue({ secret: SECRET });
  });

  it("builds the responder URL from APP_URL", () => {
    expect(asaResponderUrl(APP)).toBe(`${APP}/api/lithic/asa`);
    expect(asaResponderUrl(`${APP}/`)).toBe(`${APP}/api/lithic/asa`);
  });

  it("enrolls AUTH_STREAM_ACCESS and returns the HMAC secret", async () => {
    lithic.responderEndpoints.checkStatus.mockResolvedValue({ enrolled: false, url: null });
    expect(await enrollAsaResponder(APP)).toEqual({ url: `${APP}/api/lithic/asa`, replaced: null, secret: SECRET });
    expect(lithic.responderEndpoints.checkStatus).toHaveBeenCalledWith({ type: "AUTH_STREAM_ACCESS" });
    expect(lithic.responderEndpoints.create).toHaveBeenCalledWith({ type: "AUTH_STREAM_ACCESS", url: `${APP}/api/lithic/asa` });
    expect(lithic.responderEndpoints.delete).not.toHaveBeenCalled();
  });

  it("is a no-op enrollment when the same URL is already enrolled", async () => {
    lithic.responderEndpoints.checkStatus.mockResolvedValue({ enrolled: true, url: `${APP}/api/lithic/asa` });
    expect((await enrollAsaResponder(APP)).replaced).toBeNull();
    expect(lithic.responderEndpoints.create).not.toHaveBeenCalled();
    expect(lithic.authStreamEnrollment.retrieveSecret).toHaveBeenCalled();
  });

  it("replaces a different enrolled URL", async () => {
    lithic.responderEndpoints.checkStatus.mockResolvedValue({ enrolled: true, url: "https://old.example.com/api/lithic/asa" });
    expect((await enrollAsaResponder(APP)).replaced).toBe("https://old.example.com/api/lithic/asa");
    expect(lithic.responderEndpoints.delete).toHaveBeenCalledWith({ type: "AUTH_STREAM_ACCESS" });
    expect(lithic.responderEndpoints.create).toHaveBeenCalled();
  });

  it("fails when Lithic does not enroll or returns no secret", async () => {
    lithic.responderEndpoints.checkStatus.mockResolvedValue({ enrolled: false, url: null });
    lithic.responderEndpoints.create.mockResolvedValueOnce({ enrolled: false });
    await expect(enrollAsaResponder(APP)).rejects.toThrow(/did not enroll/);
    lithic.authStreamEnrollment.retrieveSecret.mockResolvedValueOnce({});
    await expect(enrollAsaResponder(APP)).rejects.toThrow(/no ASA HMAC secret/);
  });

  it("flags URLs Lithic cannot reach", () => {
    expect(isPublicUrl(APP)).toBe(true);
    expect(isPublicUrl("https://advance.explorador.ai")).toBe(true);
    for (const url of ["http://localhost:3107", "http://127.0.0.1:3000", "http://192.168.1.20:3000", "http://10.0.0.2", "http://mac.local:3000"]) {
      expect(isPublicUrl(url)).toBe(false);
    }
  });
});
