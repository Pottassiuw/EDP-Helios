import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a&]:hover:bg-primary/90",
        secondary:
          "bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90",
        destructive:
          "bg-destructive text-destructive-foreground focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40 [a&]:hover:bg-destructive/90",
        outline:
          "border-border text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
        ghost: "[a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
        link: "text-primary underline-offset-4 [a&]:hover:underline",
        tagOk: "inline-flex items-center gap-[5px] font-mono text-[10.5px] font-semibold tracking-[0.08em] uppercase py-[3px] px-[8px] rounded-[5px] whitespace-nowrap border-transparent bg-green text-on-green",
        tagErr: "inline-flex items-center gap-[5px] font-mono text-[10.5px] font-semibold tracking-[0.08em] uppercase py-[3px] px-[8px] rounded-[5px] whitespace-nowrap border-transparent bg-tint-red text-red",
        tagDone: "inline-flex items-center gap-[5px] font-mono text-[10.5px] font-semibold tracking-[0.08em] uppercase py-[3px] px-[8px] rounded-[5px] whitespace-nowrap border-transparent bg-tint-indigo text-indigo",
        tagDup: "inline-flex items-center gap-[5px] font-mono text-[10.5px] font-semibold tracking-[0.08em] uppercase py-[3px] px-[8px] rounded-[5px] whitespace-nowrap border-transparent bg-indigo text-on-dark",
        prioHigh: "inline-flex items-center justify-center min-w-[26px] h-[26px] px-[7px] rounded-[7px] font-mono text-[13px] font-semibold border bg-tint-red text-red",
        prioMed: "inline-flex items-center justify-center min-w-[26px] h-[26px] px-[7px] rounded-[7px] font-mono text-[13px] font-semibold border bg-tint-amber text-amber",
        prioLow: "inline-flex items-center justify-center min-w-[26px] h-[26px] px-[7px] rounded-[7px] font-mono text-[13px] font-semibold border bg-green text-on-green",
        prioNone: "inline-flex items-center justify-center min-w-[26px] h-[26px] px-[7px] rounded-[7px] font-mono text-[13px] font-semibold border border-line bg-surface-2 text-text-dim",
        situPlano: "inline-flex items-center gap-[5px] font-mono text-[10.5px] font-semibold tracking-[0.08em] uppercase py-[3px] px-[8px] rounded-[5px] whitespace-nowrap border-transparent bg-green text-on-green",
        situExec: "inline-flex items-center gap-[5px] font-mono text-[10.5px] font-semibold tracking-[0.08em] uppercase py-[3px] px-[8px] rounded-[5px] whitespace-nowrap border-transparent bg-tint-indigo text-indigo",
        situFora: "inline-flex items-center gap-[5px] font-mono text-[10.5px] font-semibold tracking-[0.08em] uppercase py-[3px] px-[8px] rounded-[5px] whitespace-nowrap border-transparent bg-tint-amber text-amber",
        situCancel: "inline-flex items-center gap-[5px] font-mono text-[10.5px] font-semibold tracking-[0.08em] uppercase py-[3px] px-[8px] rounded-[5px] whitespace-nowrap border-transparent bg-tint-red text-red",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
