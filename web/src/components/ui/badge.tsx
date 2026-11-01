import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "scn:group/badge scn:inline-flex scn:h-5 scn:w-fit scn:shrink-0 scn:items-center scn:justify-center scn:gap-1 scn:overflow-hidden scn:rounded-full scn:border scn:border-transparent scn:px-2 scn:py-0.5 scn:text-[0.625rem] scn:font-medium scn:whitespace-nowrap scn:transition-all scn:focus-visible:border-ring scn:focus-visible:ring-[3px] scn:focus-visible:ring-ring/50 scn:has-data-[icon=inline-end]:pr-1.5 scn:has-data-[icon=inline-start]:pl-1.5 scn:aria-invalid:border-destructive scn:aria-invalid:ring-destructive/20 scn:dark:aria-invalid:ring-destructive/40 scn:[&>svg]:pointer-events-none scn:[&>svg]:size-2.5!",
  {
    variants: {
      variant: {
        default: "scn:bg-primary scn:text-primary-foreground scn:[a]:hover:bg-primary/80",
        secondary:
          "scn:bg-secondary scn:text-secondary-foreground scn:[a]:hover:bg-secondary/80",
        destructive:
          "scn:bg-destructive/10 scn:text-destructive scn:focus-visible:ring-destructive/20 scn:dark:bg-destructive/20 scn:dark:focus-visible:ring-destructive/40 scn:[a]:hover:bg-destructive/20",
        outline:
          "scn:border-border scn:bg-input/20 scn:text-foreground scn:dark:bg-input/30 scn:[a]:hover:bg-muted scn:[a]:hover:text-muted-foreground",
        ghost:
          "scn:hover:bg-muted scn:hover:text-muted-foreground scn:dark:hover:bg-muted/50",
        link: "scn:text-primary scn:underline-offset-4 scn:hover:underline",
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
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  })
}

export { Badge, badgeVariants }
