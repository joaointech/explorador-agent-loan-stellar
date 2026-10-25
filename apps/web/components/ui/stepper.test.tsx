import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Stepper, type Step } from "./stepper";

const steps: Step[] = [
  { id: "email", label: "Email", status: "done" },
  { id: "passkey", label: "Passkey", status: "active" },
  { id: "card", label: "Card created", status: "idle" },
];

describe("Stepper", () => {
  it("vertical (proof pipeline): the running step spins", () => {
    expect(renderToStaticMarkup(<Stepper steps={steps} />)).toContain("animate-spin");
  });

  it("horizontal (onboarding): the current step waits for the user, so it shows its number, not a spinner", () => {
    const html = renderToStaticMarkup(<Stepper steps={steps} orientation="horizontal" />);
    expect(html).not.toContain("animate-spin");
    expect(html).toMatch(/aria-current="step"[^]*?>2<\/span>/);
  });
});
