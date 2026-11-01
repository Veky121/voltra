import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

function Empty({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty"
      className={cn(
        "scn:flex scn:w-full scn:min-w-0 scn:flex-1 scn:flex-col scn:items-center scn:justify-center scn:gap-4 scn:rounded-xl scn:border-dashed scn:p-6 scn:text-center scn:text-balance",
        className
      )}
      {...props}
    />
  )
}

function EmptyHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-header"
      className={cn("scn:flex scn:max-w-sm scn:flex-col scn:items-center scn:gap-1", className)}
      {...props}
    />
  )
}

const emptyMediaVariants = cva(
  "scn:mb-2 scn:flex scn:shrink-0 scn:items-center scn:justify-center scn:[&_svg]:pointer-events-none scn:[&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "scn:bg-transparent",
        icon: "scn:flex scn:size-8 scn:shrink-0 scn:items-center scn:justify-center scn:rounded-md scn:bg-muted scn:text-foreground scn:[&_svg:not([class*='size-'])]:size-4",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function EmptyMedia({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof emptyMediaVariants>) {
  return (
    <div
      data-slot="empty-icon"
      data-variant={variant}
      className={cn(emptyMediaVariants({ variant, className }))}
      {...props}
    />
  )
}

function EmptyTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-title"
      className={cn(
        "scn:text-sm scn:font-medium scn:tracking-tight",
        className
      )}
      {...props}
    />
  )
}

function EmptyDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <div
      data-slot="empty-description"
      className={cn(
        "scn:text-xs/relaxed scn:text-muted-foreground scn:[&>a]:underline scn:[&>a]:underline-offset-4 scn:[&>a:hover]:text-primary",
        className
      )}
      {...props}
    />
  )
}

function EmptyContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-content"
      className={cn(
        "scn:flex scn:w-full scn:max-w-sm scn:min-w-0 scn:flex-col scn:items-center scn:gap-2 scn:text-xs/relaxed scn:text-balance",
        className
      )}
      {...props}
    />
  )
}

export {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
  EmptyMedia,
}
