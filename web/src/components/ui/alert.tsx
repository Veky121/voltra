import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const alertVariants = cva(
  "scn:group/alert scn:relative scn:grid scn:w-full scn:gap-0.5 scn:rounded-lg scn:border scn:px-2 scn:py-1.5 scn:text-left scn:text-xs/relaxed scn:has-data-[slot=alert-action]:relative scn:has-data-[slot=alert-action]:pr-18 scn:has-[>svg]:grid-cols-[auto_1fr] scn:has-[>svg]:gap-x-1.5 scn:*:[svg]:row-span-2 scn:*:[svg]:translate-y-0.5 scn:*:[svg]:text-current scn:*:[svg:not([class*='size-'])]:size-3.5",
  {
    variants: {
      variant: {
        default: "scn:bg-card scn:text-card-foreground",
        destructive:
          "scn:bg-card scn:text-destructive scn:*:data-[slot=alert-description]:text-destructive/90 scn:*:[svg]:text-current",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        "scn:font-medium scn:group-has-[>svg]/alert:col-start-2 scn:[&_a]:underline scn:[&_a]:underline-offset-3 scn:[&_a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

function AlertDescription({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        "scn:text-xs/relaxed scn:text-balance scn:text-muted-foreground scn:md:text-pretty scn:[&_a]:underline scn:[&_a]:underline-offset-3 scn:[&_a]:hover:text-foreground scn:[&_p:not(:last-child)]:mb-4",
        className
      )}
      {...props}
    />
  )
}

function AlertAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-action"
      className={cn("scn:absolute scn:top-1.5 scn:right-2", className)}
      {...props}
    />
  )
}

export { Alert, AlertTitle, AlertDescription, AlertAction }
