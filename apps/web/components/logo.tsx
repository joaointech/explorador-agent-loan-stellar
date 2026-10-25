import { cn } from "@/lib/utils";

/** The (white) explorador logo for blue/dark backgrounds. */
export function LogoWhite({ size = 36, className }: { size?: number; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/logo.svg" alt="" width={size} height={size} className={cn("object-contain", className)} style={{ width: size, height: size }} />;
}

/** The logo recoloured with `currentColor` (for light backgrounds). */
export function LogoMark({ size = 32, className }: { size?: number; className?: string }) {
  return <span aria-hidden className={cn("logo-mask inline-block shrink-0", className)} style={{ width: size, height: size }} />;
}

/** "explorador" in the brand's pixel wordmark font, followed by the "advance" pill. */
export function Wordmark({ className, pill = true, pillClassName }: { className?: string; pill?: boolean; pillClassName?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span className="font-pixel text-2xl font-normal tracking-wide sm:text-[28px]" aria-label="explorador">
        explorador
      </span>
      {pill && (
        <span
          className={cn(
            "rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-white ring-1 ring-white/30",
            pillClassName,
          )}
        >
          advance
        </span>
      )}
    </span>
  );
}
