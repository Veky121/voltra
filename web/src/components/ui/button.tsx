import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "scn:group/button scn:inline-flex scn:shrink-0 scn:items-center scn:justify-center scn:rounded-md scn:border scn:border-transparent scn:bg-clip-padding scn:text-xs/relaxed scn:font-medium scn:whitespace-nowrap scn:transition-all scn:outline-none scn:select-none scn:focus-visible:border-ring scn:focus-visible:ring-2 scn:focus-visible:ring-ring/30 scn:active:not-aria-[haspopup]:translate-y-px scn:disabled:pointer-events-none scn:disabled:opacity-50 scn:aria-invalid:border-destructive scn:aria-invalid:ring-2 scn:aria-invalid:ring-destructive/20 scn:dark:aria-invalid:border-destructive/50 scn:dark:aria-invalid:ring-destructive/40 scn:[&_svg]:pointer-events-none scn:[&_svg]:shrink-0 scn:[&_svg:not([class*=size-])]:size-4",
  {
    variants: {
      variant: {
        default: "scn:bg-primary scn:text-primary-foreground scn:hover:bg-primary scn:hover:brightness-110",
        outline:
          "scn:border-border scn:hover:bg-input/50 scn:hover:text-foreground scn:aria-expanded:bg-muted scn:aria-expanded:text-foreground scn:dark:bg-input/30",
        secondary:
          "scn:bg-secondary scn:text-secondary-foreground scn:hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] scn:aria-expanded:bg-secondary scn:aria-expanded:text-secondary-foreground",
        ghost:
          "scn:hover:bg-muted scn:hover:text-foreground scn:aria-expanded:bg-muted scn:aria-expanded:text-foreground scn:dark:hover:bg-muted/50",
        destructive:
          "scn:bg-destructive/10 scn:text-destructive scn:hover:bg-destructive/20 scn:focus-visible:border-destructive/40 scn:focus-visible:ring-destructive/20 scn:dark:bg-destructive/20 scn:dark:hover:bg-destructive/30 scn:dark:focus-visible:ring-destructive/40",
        link: "scn:text-primary scn:underline-offset-4 scn:hover:underline",
      },
      size: {
        default:
          "scn:h-7 scn:gap-1 scn:px-2 scn:text-xs/relaxed scn:has-data-[icon=inline-end]:pr-1.5 scn:has-data-[icon=inline-start]:pl-1.5 scn:[&_svg:not([class*=size-])]:size-3.5",
        xs: "scn:h-5 scn:gap-1 scn:rounded-sm scn:px-2 scn:text-[0.625rem] scn:has-data-[icon=inline-end]:pr-1.5 scn:has-data-[icon=inline-start]:pl-1.5 scn:[&_svg:not([class*=size-])]:size-2.5",
        sm: "scn:h-6 scn:gap-1 scn:px-2 scn:text-xs/relaxed scn:has-data-[icon=inline-end]:pr-1.5 scn:has-data-[icon=inline-start]:pl-1.5 scn:[&_svg:not([class*=size-])]:size-3",
        lg: "scn:h-8 scn:gap-1 scn:px-2.5 scn:text-xs/relaxed scn:has-data-[icon=inline-end]:pr-2 scn:has-data-[icon=inline-start]:pl-2 scn:[&_svg:not([class*=size-])]:size-4",
        icon: "scn:size-7 scn:[&_svg:not([class*=size-])]:size-3.5",
        "icon-xs": "scn:size-5 scn:rounded-sm scn:[&_svg:not([class*=size-])]:size-2.5",
        "icon-sm": "scn:size-6 scn:[&_svg:not([class*=size-])]:size-3",
        "icon-lg": "scn:size-8 scn:[&_svg:not([class*=size-])]:size-4",
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
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
