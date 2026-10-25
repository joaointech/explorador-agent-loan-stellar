"use client";

import { ChevronDown } from "lucide-react";
import { createContext, useContext, useId, type AriaAttributes, type ComponentPropsWithRef, type ReactNode } from "react";

import { cn } from "./cn";

interface FieldState {
  id: string;
  describedBy?: string;
  invalid: boolean;
}

const FieldContext = createContext<FieldState | null>(null);

/** Wires the control inside a <Field> to its label, hint and error. */
function useFieldControl(props: { id?: string; "aria-describedby"?: string; "aria-invalid"?: AriaAttributes["aria-invalid"] }) {
  const field = useContext(FieldContext);
  return {
    id: props.id ?? field?.id,
    "aria-describedby": cn(field?.describedBy, props["aria-describedby"]) || undefined,
    "aria-invalid": props["aria-invalid"] ?? (field?.invalid ? true : undefined),
  };
}

/**
 * Label + control + hint/error, with ids and aria wired automatically.
 *
 *   <Field label="Amount" hint="Card balance first, then credit." error={errors.amount}>
 *     <NumberInput value={amount} onValueChange={setAmount} prefix="€" decimals={2} />
 *   </Field>
 */
export function Field({
  label,
  hint,
  error,
  required,
  optional,
  id: idProp,
  className,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  /** Shows "(optional)" after the label. */
  optional?: boolean;
  id?: string;
  className?: string;
  children: ReactNode;
}) {
  const autoId = useId();
  const id = idProp ?? autoId;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <FieldContext.Provider value={{ id, describedBy: cn(hintId, errorId) || undefined, invalid: Boolean(error) }}>
      <div className={cn("flex flex-col gap-1.5", className)}>
        <label htmlFor={id} className="text-sm font-semibold text-heading">
          {label}
          {required && (
            <span aria-hidden className="ml-0.5 text-red-600 dark:text-red-400">
              *
            </span>
          )}
          {optional && <span className="ml-1 font-normal text-muted">(optional)</span>}
        </label>
        {children}
        {hint && !error && (
          <p id={hintId} className="text-xs leading-relaxed text-muted">
            {hint}
          </p>
        )}
        {error && (
          <p id={errorId} className="text-xs leading-relaxed font-medium text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
      </div>
    </FieldContext.Provider>
  );
}

/** Shared control styling (explorador onboarding inputs: rounded-xl, blue focus ring). */
export const controlClasses =
  "w-full rounded-xl border border-slate-300 bg-white text-base text-fg shadow-[0_1px_2px_rgb(15_23_42/0.04)] outline-none transition-[border-color,box-shadow] placeholder:text-subtle focus:border-primary focus:ring-4 focus:ring-primary/15 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-subtle aria-invalid:border-red-500 aria-invalid:focus:ring-red-500/15 dark:border-slate-700 dark:bg-slate-900 dark:disabled:bg-slate-800";

export type InputProps = Omit<ComponentPropsWithRef<"input">, "prefix"> & {
  /** Static text or icon inside the left edge, e.g. "€". */
  prefix?: ReactNode;
  /** Static text or icon inside the right edge, e.g. "tEURC". */
  suffix?: ReactNode;
  inputClassName?: string;
};

/** Text input (h-11, 16 px text so iOS doesn't zoom). Reads id/aria from a surrounding <Field>. */
export function Input({ prefix, suffix, className, inputClassName, ...props }: InputProps) {
  const wiring = useFieldControl(props);
  const input = (
    <input
      {...props}
      {...wiring}
      className={cn(controlClasses, "h-11 px-3.5", prefix ? "pl-9" : undefined, suffix ? "pr-16" : undefined, inputClassName, !prefix && !suffix && className)}
    />
  );
  if (!prefix && !suffix) return input;
  return (
    <div className={cn("relative", className)}>
      {prefix && (
        <span aria-hidden className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-sm text-subtle [&_svg]:size-4">
          {prefix}
        </span>
      )}
      {input}
      {suffix && (
        <span className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-sm font-medium text-subtle [&_svg]:size-4">
          {suffix}
        </span>
      )}
    </div>
  );
}

/** Native select styled like Input, with a chevron. */
export function Select({ className, children, ...props }: ComponentPropsWithRef<"select">) {
  const wiring = useFieldControl(props);
  return (
    <div className={cn("relative", className)}>
      <select {...props} {...wiring} className={cn(controlClasses, "h-11 appearance-none pr-10 pl-3.5")}>
        {children}
      </select>
      <ChevronDown aria-hidden className="pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2 text-subtle" />
    </div>
  );
}

/** Multi-line text input styled like Input. */
export function Textarea({ className, ...props }: ComponentPropsWithRef<"textarea">) {
  const wiring = useFieldControl(props);
  return <textarea {...props} {...wiring} className={cn(controlClasses, "min-h-24 px-3.5 py-2.5", className)} />;
}

export { useFieldControl };
