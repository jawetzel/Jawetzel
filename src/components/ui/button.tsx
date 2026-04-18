import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium transition-[transform,background,color,box-shadow] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-surface)] disabled:pointer-events-none disabled:opacity-50 active:translate-y-[1px]",
  {
    variants: {
      variant: {
        primary:
          "bg-[var(--color-brand-primary-deep)] text-[var(--color-text-inverse)] hover:bg-[var(--color-brand-primary-dark)] shadow-[0_6px_0_rgba(23,69,67,0.25)] hover:shadow-[0_4px_0_rgba(23,69,67,0.25)]",
        accent:
          "bg-[var(--color-brand-primary)] text-[var(--color-text-primary)] hover:bg-[var(--color-brand-primary-hover)] shadow-[0_6px_0_rgba(23,69,67,0.2)] hover:shadow-[0_4px_0_rgba(23,69,67,0.2)]",
        warm:
          "bg-[var(--color-accent-warm)] text-[var(--color-text-primary)] hover:bg-[var(--color-accent-warm-hover)] shadow-[0_6px_0_rgba(149,104,15,0.25)] hover:shadow-[0_4px_0_rgba(149,104,15,0.25)]",
        outline:
          "border-2 border-[var(--color-text-primary)] bg-transparent text-[var(--color-text-primary)] hover:bg-[var(--color-text-primary)] hover:text-[var(--color-text-inverse)]",
        ghost:
          "text-[var(--color-text-primary)] hover:bg-[var(--color-brand-primary-100)]",
        link: "text-[var(--color-brand-primary-dark)] underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-9 px-4",
        md: "h-11 px-6",
        lg: "h-14 px-8 text-base",
        icon: "h-11 w-11",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
