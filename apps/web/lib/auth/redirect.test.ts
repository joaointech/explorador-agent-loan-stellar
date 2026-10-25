import { describe, expect, it } from "vitest";

import { homeForRole, loginPath, postLoginPath, requiredRoleForPath, sanitizeNextPath } from "@/lib/auth/redirect";

describe("requiredRoleForPath", () => {
  it("maps /agent/** to AGENT and /admin/** to ADMIN", () => {
    expect(requiredRoleForPath("/agent")).toBe("AGENT");
    expect(requiredRoleForPath("/agent/settings")).toBe("AGENT");
    expect(requiredRoleForPath("/admin")).toBe("ADMIN");
    expect(requiredRoleForPath("/admin/cpcv/new")).toBe("ADMIN");
  });

  it("leaves look-alikes and public pages alone", () => {
    for (const path of ["/", "/agents", "/administrator", "/registry/3", "/invest", "/login", "/api/agent/overview"]) {
      expect(requiredRoleForPath(path)).toBeNull();
    }
  });
});

describe("sanitizeNextPath", () => {
  it("keeps same-origin paths with query and hash", () => {
    expect(sanitizeNextPath("/agent")).toBe("/agent");
    expect(sanitizeNextPath("/registry/12?tab=proof#a")).toBe("/registry/12?tab=proof#a");
  });

  it.each([
    "https://evil.example/agent",
    "//evil.example/agent",
    "/\\evil.example",
    "\\\\evil.example",
    "javascript:alert(1)",
    "agent",
    "/agent\n",
    "/\tagent",
    "/api/auth/session",
    "/login",
    "/login?next=/agent",
    "",
    `/${"a".repeat(600)}`,
  ])("rejects %j", (next) => {
    expect(sanitizeNextPath(next)).toBeNull();
  });

  it("rejects non-strings", () => {
    expect(sanitizeNextPath(undefined)).toBeNull();
    expect(sanitizeNextPath(42)).toBeNull();
  });
});

describe("postLoginPath", () => {
  it("sends agents to /agent and admins to /admin by default", () => {
    expect(homeForRole("AGENT")).toBe("/agent");
    expect(homeForRole("ADMIN")).toBe("/admin");
    expect(postLoginPath("AGENT")).toBe("/agent");
    expect(postLoginPath("ADMIN", null)).toBe("/admin");
  });

  it("honours next when the role may open it", () => {
    expect(postLoginPath("AGENT", "/agent/settings?x=1")).toBe("/agent/settings?x=1");
    expect(postLoginPath("ADMIN", "/admin/cpcv")).toBe("/admin/cpcv");
    expect(postLoginPath("AGENT", "/registry/3")).toBe("/registry/3");
  });

  it("ignores next pointing at the other role's area or off-site", () => {
    expect(postLoginPath("AGENT", "/admin")).toBe("/agent");
    expect(postLoginPath("ADMIN", "/agent")).toBe("/admin");
    expect(postLoginPath("AGENT", "https://evil.example")).toBe("/agent");
  });
});

describe("loginPath", () => {
  it("encodes a safe next and drops an unsafe one", () => {
    expect(loginPath("/agent/settings?x=1")).toBe("/login?next=%2Fagent%2Fsettings%3Fx%3D1");
    expect(loginPath("//evil.example")).toBe("/login");
    expect(loginPath()).toBe("/login");
  });
});
