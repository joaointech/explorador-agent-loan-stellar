import { LoaderCircle } from "lucide-react";
import Link from "next/link";
import type { ComponentPropsWithRef, ReactNode } from "react";

import { cn } from "./cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "onPrimary";
export type ButtonSize = "sm" | "md" | "lg";

const BASE =
  "group/button inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-button font-semibold transition-[background-color,border-color,color,box-shadow,transform] duration-200 select-none disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50";

const VARIANTS: Record<ButtonVariant, string> = {
  // explorador.pt CTA: blue with a soft blue glow, hovering to navy.
  primary: "bg-primary text-primary-fg shadow-cta hover:bg-primary-hover hover:shadow-cta-hover",
  // Spec: white background, blue-600 text.
  secondary: "border border-line bg-card text-primary-text shadow-card hover:border-primary/30 hover:bg-primary-tint",
  ghost: "text-fg hover:bg-slate-100 dark:hover:bg-slate-800",
  danger: "bg-red-600 text-white shadow-[0_8px_24px_rgb(220_38_38/0.22)] hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-600",
  // White button for blue / brand surfaces (explorador.pt banner CTA).
  onPrimary: "bg-white text-blue-600 shadow-[0_8px_24px_rgb(0_0_0/0.15)] hover:bg-blue-50",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-9 px-4 text-sm",
  md: "h-11 px-6 text-[15px]",
  lg: "h-12 px-7 text-base",
};

export interface ButtonStyleOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  className?: string;
}

/** Button classes for elements that can't use <Button> (e.g. a <label> or <summary>). */
export function buttonClasses({ variant = "primary", size = "md", fullWidth, className }: ButtonStyleOptions = {}): string {
  return cn(
    BASE,
    VARIANTS[variant],
    SIZES[size],
    // The explorador CTA lift, on full-size primary buttons only.
    variant === "primary" && size !== "sm" && "motion-safe:hover:scale-[1.02] motion-safe:active:scale-[0.99]",
    fullWidth && "w-full",
    className,
  );
}

interface CommonProps extends ButtonStyleOptions {
  /** Appends "→" (spec: forward actions end with an arrow). */
  arrow?: boolean;
  /** Leading icon, e.g. `<Wallet className="size-4" />`. */
  icon?: ReactNode;
  children?: ReactNode;
}

export type ButtonAsButtonProps = CommonProps &
  Omit<ComponentPropsWithRef<"button">, "className" | "children"> & {
    href?: undefined;
    /** Shows a spinner, disables the button and sets aria-busy. */
    loading?: boolean;
  };

export type ButtonAsLinkProps = CommonProps &
  Omit<ComponentPropsWithRef<typeof Link>, "className" | "children" | "href"> & {
    href: string;
    /** Opens in a new tab with rel="noopener noreferrer" (default for http URLs). */
    external?: boolean;
  };

export type ButtonProps = ButtonAsButtonProps | ButtonAsLinkProps;

function Content({ icon, arrow, children, loading }: { icon?: ReactNode; arrow?: boolean; children?: ReactNode; loading?: boolean }) {
  return (
    <>
      {loading ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : icon}
      {children}
      {arrow && (
        <span aria-hidden className="transition-transform duration-200 group-hover/button:translate-x-0.5">
          →
        </span>
      )}
    </>
  );
}

/**
 * Primary / secondary / ghost / danger button, rounded-xl, h-11 by default.
 * Pass `href` to render a Next.js <Link> (or an external <a>) with the same look.
 *
 *   <Button arrow href="/agent">I'm an agent</Button>
 *   <Button variant="secondary" loading={pending} onClick={save}>Save</Button>
 */
export function Button(props: ButtonProps) {
  if (props.href !== undefined) {
    const { variant, size, fullWidth, className, arrow, icon, children, external, href, ...rest } = props;
    const classes = buttonClasses({ variant, size, fullWidth, className });
    const isExternal = external ?? /^https?:\/\//.test(href);
    if (isExternal) {
      const anchorRest = rest as Omit<ComponentPropsWithRef<"a">, "className" | "children" | "href">;
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" className={classes} {...anchorRest}>
          <Content icon={icon} arrow={arrow}>
            {children}
          </Content>
        </a>
      );
    }
    return (
      <Link href={href} className={classes} {...rest}>
        <Content icon={icon} arrow={arrow}>
          {children}
        </Content>
      </Link>
    );
  }

  const { variant, size, fullWidth, className, arrow, icon, children, loading, disabled, type, ...rest } = props;
  return (
    <button
      type={type ?? "button"}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClasses({ variant, size, fullWidth, className })}
      {...rest}
    >
      <Content icon={icon} arrow={arrow} loading={loading}>
        {children}
      </Content>
    </button>
  );
}

/** Square icon-only button. Always pass an accessible `label`. */
export function IconButton({
  label,
  variant = "ghost",
  size = "md",
  className,
  children,
  type,
  ...rest
}: Omit<ComponentPropsWithRef<"button">, "aria-label"> & {
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  const square: Record<ButtonSize, string> = { sm: "size-9", md: "size-11", lg: "size-12" };
  return (
    <button
      type={type ?? "button"}
      aria-label={label}
      title={label}
      className={cn(BASE, VARIANTS[variant], square[size], "px-0", className)}
      {...rest}
    >
      {children}
    </button>
  );
}
