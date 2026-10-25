import { extendTailwindMerge, type ClassNameValue } from "tailwind-merge";

// tailwind-merge taught about our @theme tokens (app/globals.css), so a
// consumer's `className` reliably overrides a primitive's defaults:
// <Card className="p-8"> beats Card's padding, <Button className="shadow-none">
// beats the CTA glow, `text-heading` is a colour and `text-[15px]` a size.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      color: [
        "bg",
        "section",
        "section-alt",
        "card",
        "card-muted",
        "overlay",
        "fg",
        "heading",
        "muted",
        "subtle",
        "line",
        "border",
        "primary",
        "primary-hover",
        "primary-fg",
        "primary-soft",
        "primary-tint",
        "primary-text",
        "primary-dark",
        "primary-light",
        "ring",
        "accent",
        "success",
        "warning",
        "danger",
        "chart-1",
        "chart-2",
        "chart-3",
        "chart-4",
        "chart-grid",
        "chart-axis",
      ],
      radius: ["button", "card", "panel"],
      shadow: ["card", "pill", "cta", "cta-hover", "pop", "brand"],
      font: ["display"],
      animate: ["fade-in", "fade-in-up", "modal-pop", "sheet-up", "toast-in", "toast-countdown", "input-shake", "live-ring"],
    },
  },
});

/** Joins class names (falsy values skipped) and resolves Tailwind conflicts, last one wins. */
export function cn(...classes: ClassNameValue[]): string {
  return twMerge(...classes);
}
