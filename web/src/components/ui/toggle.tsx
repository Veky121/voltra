"use client"

import { Toggle as TogglePrimitive } from "@base-ui/react/toggle"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const toggleVariants = cva(
  "scn:group/toggle scn:inline-flex scn:items-center scn:justify-center scn:gap-1 scn:rounded-md scn:text-xs scn:font-medium scn:whitespace-nowrap scn:transition-all scn:outline-none scn:hover:bg-muted scn:hover:text-foreground scn:focus-visible:border-ring scn:focus-visible:ring-[3px] scn:focus-visible:ring-ring/50 scn:disabled:pointer-events-none scn:disabled:opacity-50 scn:aria-invalid:border-destructive scn:aria-invalid:ring-destructive/20 scn:aria-pressed:bg-muted scn:data-[state=on]:bg-muted scn:dark:aria-invalid:ring-destructive/40 scn:[&_svg]:pointer-events-none scn:[&_svg]:shrink-0 scn:[&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "scn:bg-transparent",
        outline: "scn:border scn:border-input scn:bg-transparent scn:hover:bg-muted",
      },
      size: {
        default:
          "scn:h-7 scn:min-w-7 scn:px-2 scn:has-data-[icon=inline-end]:pr-1.5 scn:has-data-[icon=inline-start]:pl-1.5",
        sm: "scn:h-6 scn:min-w-6 scn:rounded-[min(var(--radius-md),8px)] scn:px-2 scn:text-[0.625rem] scn:has-data-[icon=inline-end]:pr-1.5 scn:has-data-[icon=inline-start]:pl-1.5 scn:[&_svg:not([class*='size-'])]:size-3",
        lg: "scn:h-8 scn:min-w-8 scn:px-2.5 scn:has-data-[icon=inline-end]:pr-2 scn:has-data-[icon=inline-start]:pl-2",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Toggle({
  className,
  variant = "default",
  size = "default",
  ...props
}: TogglePrimitive.Props & VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Toggle, toggleVariants }
