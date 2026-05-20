import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Orka Project — shadcn-style Button.
 * Tailwind v3 compatible. Variants reference the Orka palette
 * (primary/accent/etc.) and shadcn CSS tokens (border, ring, muted, etc.).
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg text-sm font-semibold ring-offset-background transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // Orka primary blue
        default: "bg-primary text-primary-foreground hover:bg-primary-dark shadow-sm hover:shadow-pop active:translate-y-px",
        // Outline / neutral surface
        outline: "bg-white text-soft border border-line hover:text-primary hover:border-primary/40 hover:shadow-sm",
        // Subtle ghost
        ghost: "text-soft hover:text-ink hover:bg-bg",
        // Destructive (delete, etc.)
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-sm",
        // Secondary surface (toolbars)
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        // Link-style
        link: "text-primary underline-offset-4 hover:underline",
        // Sky-accent (Orka secondary brand)
        accent: "bg-accent text-accent-foreground hover:bg-accent-dark shadow-sm",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 px-3 text-xs",
        xs: "h-7 px-2.5 text-[11px]",
        lg: "h-10 px-6",
        icon: "h-9 w-9",
        "icon-sm": "h-8 w-8",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  ),
);
Button.displayName = "Button";

export { Button, buttonVariants };
