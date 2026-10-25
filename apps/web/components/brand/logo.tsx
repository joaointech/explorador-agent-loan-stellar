import { cn } from "@/components/ui/cn";

export type LogoTone = "white" | "blue";

// The explorador mark is a raster "doorway" pin wrapped in SVG (public/logo.svg
// is white for blue/dark surfaces, public/logo-blue.svg for light ones), the
// same assets explorador.pt serves.
const SRC: Record<LogoTone, string> = {
  white: "/logo.svg",
  blue: "/logo-blue.svg",
};

/** The explorador mark on its own. Size it with `className` (default `size-8`). Decorative unless `label` is given. */
export function LogoMark({ tone = "white", label, className }: { tone?: LogoTone; label?: string; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- static brand SVG, no optimisation needed
    <img
      src={SRC[tone]}
      alt={label ?? ""}
      aria-hidden={label ? undefined : true}
      width={40}
      height={40}
      className={cn("size-8 shrink-0 object-contain", className)}
    />
  );
}

/** The small "advance" pill that follows the wordmark (spec §10.1 top nav). */
export function AdvancePill({ tone = "onPrimary", className }: { tone?: "onPrimary" | "onSurface"; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs leading-5 font-semibold lowercase",
        tone === "onPrimary"
          ? "bg-white/15 text-white ring-1 ring-white/30"
          : "bg-primary-tint text-primary-text ring-1 ring-primary/20",
        className,
      )}
    >
      advance
    </span>
  );
}

/**
 * Full lockup: mark + "explorador" wordmark + "advance" pill. The accessible
 * name is the product name, always lowercase: "explorador advance".
 */
export function Logo({
  tone = "white",
  pill = true,
  markClassName,
  className,
}: {
  tone?: LogoTone;
  pill?: boolean;
  /** Mark size, e.g. `size-[34px] sm:size-10` (header). Default `size-8`. */
  markClassName?: string;
  className?: string;
}) {
  return (
    <span
      role="img"
      aria-label="explorador advance"
      className={cn("inline-flex items-center gap-2", tone === "white" ? "text-white" : "text-primary-text", className)}
    >
      <LogoMark tone={tone} className={markClassName} />
      <span aria-hidden className="wordmark">
        explorador
      </span>
      {pill && <AdvancePill tone={tone === "white" ? "onPrimary" : "onSurface"} className="ml-0.5" />}
    </span>
  );
}
