import { LogoWhite } from "@/components/logo";
import { cn } from "@/lib/utils";

/** The agent's virtual card (blue gradient, explorador logo, last4, "Virtual · Sandbox"). */
export function CardVisual({
  last4,
  holder,
  pan,
  cvv,
  exp,
  className,
}: {
  last4: string | null;
  holder?: string | null;
  pan?: string | null;
  cvv?: string | null;
  exp?: string | null;
  className?: string;
}) {
  const groups = pan ? pan.replace(/\D/g, "").match(/.{1,4}/g) ?? [pan] : ["••••", "••••", "••••", last4 ?? "••••"];
  return (
    <div
      className={cn(
        "relative aspect-[1.586/1] w-full max-w-[380px] overflow-hidden rounded-3xl bg-gradient-to-br from-blue-500 via-blue-600 to-blue-800 p-5 text-white shadow-[0_18px_40px_-18px_rgba(37,99,235,0.7)] ring-1 ring-white/10 sm:p-6",
        className,
      )}
    >
      <div className="pointer-events-none absolute -right-16 -top-20 size-64 rounded-full bg-white/10 blur-2xl" aria-hidden />
      <div className="pointer-events-none absolute -bottom-24 -left-10 size-64 rounded-full bg-sky-300/20 blur-3xl" aria-hidden />
      <div className="relative flex h-full flex-col justify-between">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <LogoWhite size={28} />
            <span className="font-pixel text-lg tracking-wide">explorador</span>
          </div>
          <span className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ring-1 ring-white/25">advance</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="h-7 w-10 rounded-md bg-gradient-to-br from-amber-200 to-amber-400 opacity-90 ring-1 ring-amber-100/40" aria-hidden />
          <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/70">Virtual · Sandbox</span>
        </div>
        <div className="font-mono text-lg tracking-[0.12em] tabular-nums sm:text-xl">{groups.join(" ")}</div>
        <div className="flex items-end justify-between gap-3 text-xs">
          <div className="min-w-0">
            <div className="text-[9px] uppercase tracking-[0.18em] text-white/60">Card holder</div>
            <div className="truncate font-semibold">{holder ?? "explorador agent"}</div>
          </div>
          <div className="flex gap-4">
            <div>
              <div className="text-[9px] uppercase tracking-[0.18em] text-white/60">Expires</div>
              <div className="font-mono font-semibold tabular-nums">{exp ?? "••/••"}</div>
            </div>
            <div>
              <div className="text-[9px] uppercase tracking-[0.18em] text-white/60">CVV</div>
              <div className="font-mono font-semibold tabular-nums">{cvv ?? "•••"}</div>
            </div>
            <div className="self-end text-base font-bold italic tracking-tight">VISA</div>
          </div>
        </div>
      </div>
    </div>
  );
}
