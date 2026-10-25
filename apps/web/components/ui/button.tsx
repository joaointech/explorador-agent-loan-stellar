import * as React from "react";
import { Slot } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import { LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-page disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-primary text-white hover:bg-primary-hover",
        secondary:
          "border border-line bg-surface text-primary hover:bg-primary-faint dark:text-blue-300",
        ghost: "text-ink-soft hover:bg-primary-faint hover:text-primary",
        outline: "border border-line bg-transparent text-ink hover:bg-primary-faint",
        danger: "bg-red-600 text-white hover:bg-red-700",
        warning: "bg-amber-500 text-white hover:bg-amber-600",
        success: "bg-emerald-600 text-white hover:bg-emerald-700",
        onPrimary: "bg-white text-blue-600 hover:bg-blue-50",
        glass: "bg-white/15 text-white hover:bg-white/25",
      },
      size: {
        default: "h-11 px-6 text-[15px]",
        sm: "h-9 px-4 text-sm",
        xs: "h-8 rounded-lg px-3 text-xs",
        lg: "h-12 px-7 text-base",
        icon: "size-10 rounded-lg",
      },
    },
    defaultVariants: { variant: "primary", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

export function Button({ className, variant, size, asChild = false, loading = false, disabled, children, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp className={cn(buttonVariants({ variant, size }), className)} disabled={asChild ? undefined : disabled || loading} {...props}>
      {asChild ? (
        children
      ) : (
        <>
          {loading && <LoaderCircle className="animate-spin" aria-hidden />}
          {children}
        </>
      )}
    </Comp>
  );
}

export { buttonVariants };
