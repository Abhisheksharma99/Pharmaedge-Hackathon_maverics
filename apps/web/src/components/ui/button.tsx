import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-[10px] border border-transparent bg-clip-padding text-[13px] font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-primary/12 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-[16px]",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-[#1c3bb9]",
        outline:
          "border-border bg-card hover:bg-accent hover:text-foreground aria-expanded:bg-accent aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost:
          "hover:bg-accent hover:text-foreground aria-expanded:bg-accent aria-expanded:text-foreground dark:hover:bg-muted/50",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-[40px] gap-[8px] px-[16px] has-data-[icon=inline-end]:pr-[14px] has-data-[icon=inline-start]:pl-[14px]",
        xs: "h-[26px] gap-[4px] rounded-[8px] px-[10px] text-[12.5px] has-data-[icon=inline-end]:pr-[8px] has-data-[icon=inline-start]:pl-[8px] [&_svg:not([class*='size-'])]:size-[12px]",
        sm: "h-[32px] gap-[8px] rounded-[8px] px-[12px] has-data-[icon=inline-end]:pr-[10px] has-data-[icon=inline-start]:pl-[10px] [&_svg:not([class*='size-'])]:size-[14px]",
        lg: "h-[40px] gap-[8px] px-[16px] has-data-[icon=inline-end]:pr-[14px] has-data-[icon=inline-start]:pl-[14px]",
        icon: "size-[32px] rounded-[8px]",
        "icon-xs":
          "size-[24px] rounded-[8px] [&_svg:not([class*='size-'])]:size-[12px]",
        "icon-sm":
          "size-[28px] rounded-[8px]",
        "icon-lg": "size-[40px]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
