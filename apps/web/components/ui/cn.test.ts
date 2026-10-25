import { describe, expect, it } from "vitest";

import { cn } from "./cn";

describe("cn", () => {
  it("skips falsy values", () => {
    expect(cn("a", false, null, undefined, 0, "b")).toBe("a b");
  });

  it("lets later classes override earlier ones", () => {
    expect(cn("inline-flex h-10", "hidden lg:inline-flex")).toBe("h-10 hidden lg:inline-flex");
    expect(cn("p-5 sm:p-6", "p-8")).toBe("sm:p-6 p-8");
    expect(cn("size-8", "size-[34px] sm:size-10")).toBe("size-[34px] sm:size-10");
  });

  it("knows the custom theme tokens", () => {
    expect(cn("text-heading text-sm", "text-muted")).toBe("text-sm text-muted");
    expect(cn("text-[15px] text-primary-text", "text-base")).toBe("text-primary-text text-base");
    expect(cn("shadow-cta hover:shadow-cta-hover", "shadow-none")).toBe("hover:shadow-cta-hover shadow-none");
    expect(cn("rounded-card", "rounded-panel")).toBe("rounded-panel");
    expect(cn("bg-card", "bg-section")).toBe("bg-section");
    expect(cn("border-line", "border-primary/30")).toBe("border-primary/30");
  });
});
