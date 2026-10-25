"use client";

import { useLayoutEffect, useRef, type ComponentPropsWithRef, type ReactNode } from "react";

import { cn } from "./cn";
import { controlClasses, useFieldControl } from "./field";

/** Keeps digits and at most one "." with up to `decimals` fraction digits; strips leading zeros. */
export function normalizeNumeric(input: string, decimals: number): string {
  let s = input.replace(/[^\d.]/g, "");
  const dot = s.indexOf(".");
  if (decimals === 0 || dot === -1) {
    s = s.replace(/\./g, "");
  } else {
    s = s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, "").slice(0, decimals);
  }
  const [int, frac] = s.split(".");
  const cleanInt = int.replace(/^0+(?=\d)/, "");
  if (frac === undefined) return cleanInt;
  return `${cleanInt === "" ? "0" : cleanInt}.${frac}`;
}

/** en-GB grouping of a normalized value, keeping a trailing "." while typing: "300000.5" → "300,000.5". */
export function groupNumeric(raw: string): string {
  if (raw === "") return "";
  const [int, frac] = raw.split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac === undefined ? grouped : `${grouped}.${frac}`;
}

export type NumberInputProps = Omit<ComponentPropsWithRef<"input">, "value" | "defaultValue" | "onChange" | "type" | "prefix"> & {
  /** Raw value without separators, e.g. "300000.50" ("" when empty). */
  value: string;
  onValueChange: (raw: string) => void;
  /** Fraction digits allowed: 0 (default) or 2 for euros. */
  decimals?: number;
  prefix?: ReactNode;
  suffix?: ReactNode;
  inputClassName?: string;
};

/**
 * Number input that shows thousands separators ("300,000") while keeping a raw
 * value for state and forms (a hidden input carries `name`). type="text" with
 * the numeric keyboard, because type="number" can't display separators.
 *
 *   const [eur, setEur] = useState("");
 *   <NumberInput value={eur} onValueChange={setEur} decimals={2} prefix="€" />
 */
export function NumberInput({
  value,
  onValueChange,
  decimals = 0,
  prefix,
  suffix,
  name,
  className,
  inputClassName,
  ...props
}: NumberInputProps) {
  const wiring = useFieldControl(props);
  const inputRef = useRef<HTMLInputElement>(null);
  // Caret position to restore after regrouping, counted in digits/dots from the start.
  const caretRef = useRef<number | null>(null);
  const displayed = groupNumeric(value);

  useLayoutEffect(() => {
    const want = caretRef.current;
    caretRef.current = null;
    const el = inputRef.current;
    if (want === null || !el || document.activeElement !== el) return;
    let seen = 0;
    let pos = el.value.length;
    if (want === 0) pos = 0;
    else {
      for (let i = 0; i < el.value.length; i++) {
        if (/[\d.]/.test(el.value[i]) && ++seen === want) {
          pos = i + 1;
          break;
        }
      }
    }
    el.setSelectionRange(pos, pos);
  }, [displayed]);

  return (
    <div className={cn("relative", className)}>
      {prefix && (
        <span aria-hidden className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-base text-subtle">
          {prefix}
        </span>
      )}
      <input
        {...props}
        {...wiring}
        ref={inputRef}
        type="text"
        inputMode={decimals > 0 ? "decimal" : "numeric"}
        autoComplete="off"
        spellCheck={false}
        value={displayed}
        onChange={(e) => {
          const caret = e.target.selectionStart ?? e.target.value.length;
          caretRef.current = e.target.value.slice(0, caret).replace(/[^\d.]/g, "").length;
          onValueChange(normalizeNumeric(e.target.value, decimals));
        }}
        className={cn(controlClasses, "h-11 px-3.5 tabular-nums", prefix ? "pl-8" : undefined, suffix ? "pr-16" : undefined, inputClassName)}
      />
      {suffix && (
        <span className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-sm font-medium text-subtle">
          {suffix}
        </span>
      )}
      {name && <input type="hidden" name={name} value={value} />}
    </div>
  );
}
