"use client"

import { useMemo } from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"

function FieldSet({ className, ...props }: React.ComponentProps<"fieldset">) {
  return (
    <fieldset
      data-slot="field-set"
      className={cn(
        "scn:flex scn:flex-col scn:gap-4 scn:has-[>[data-slot=checkbox-group]]:gap-3 scn:has-[>[data-slot=radio-group]]:gap-3",
        className
      )}
      {...props}
    />
  )
}

function FieldLegend({
  className,
  variant = "legend",
  ...props
}: React.ComponentProps<"legend"> & { variant?: "legend" | "label" }) {
  return (
    <legend
      data-slot="field-legend"
      data-variant={variant}
      className={cn(
        "scn:mb-2 scn:font-medium scn:data-[variant=label]:text-xs/relaxed scn:data-[variant=legend]:text-sm",
        className
      )}
      {...props}
    />
  )
}

function FieldGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="field-group"
      className={cn(
        "scn:group/field-group scn:@container/field-group scn:flex scn:w-full scn:flex-col scn:gap-4 scn:data-[slot=checkbox-group]:gap-3 scn:*:data-[slot=field-group]:gap-4",
        className
      )}
      {...props}
    />
  )
}

const fieldVariants = cva(
  "scn:group/field scn:flex scn:w-full scn:gap-2 scn:data-[invalid=true]:text-destructive",
  {
    variants: {
      orientation: {
        vertical: "scn:flex-col scn:*:w-full scn:[&>.sr-only]:w-auto",
        horizontal:
          "scn:flex-row scn:items-center scn:has-[>[data-slot=field-content]]:items-start scn:*:data-[slot=field-label]:flex-auto scn:has-[>[data-slot=field-content]]:[&>[role=checkbox],[role=radio]]:mt-px",
        responsive:
          "scn:flex-col scn:*:w-full scn:@md/field-group:flex-row scn:@md/field-group:items-center scn:@md/field-group:*:w-auto scn:@md/field-group:has-[>[data-slot=field-content]]:items-start scn:@md/field-group:*:data-[slot=field-label]:flex-auto scn:[&>.sr-only]:w-auto scn:@md/field-group:has-[>[data-slot=field-content]]:[&>[role=checkbox],[role=radio]]:mt-px",
      },
    },
    defaultVariants: {
      orientation: "vertical",
    },
  }
)

function Field({
  className,
  orientation = "vertical",
  as: Component = "div",
  ...props
}: React.HTMLAttributes<HTMLElement> & VariantProps<typeof fieldVariants> & {as?:"div"|"label"}) {
  return (
    <Component
      role="group"
      data-slot="field"
      data-orientation={orientation}
      className={cn(fieldVariants({ orientation }), className)}
      {...props}
    />
  )
}

function FieldContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="field-content"
      className={cn(
        "scn:group/field-content scn:flex scn:flex-1 scn:flex-col scn:gap-0.5 scn:leading-snug",
        className
      )}
      {...props}
    />
  )
}

function FieldLabel({
  className,
  ...props
}: React.ComponentProps<typeof Label>) {
  return (
    <Label
      data-slot="field-label"
      className={cn(
        "scn:group/field-label scn:peer/field-label scn:flex scn:w-fit scn:gap-2 scn:leading-snug scn:group-data-[disabled=true]/field:opacity-50 scn:has-data-checked:bg-primary/5 scn:has-[>[data-slot=field]]:rounded-md scn:has-[>[data-slot=field]]:border scn:has-[>[data-slot=field]]:not-has-[:disabled,[data-disabled]]:hover:bg-input/40 scn:has-[>[data-slot=field]]:has-[:focus-visible]:border-ring scn:has-[>[data-slot=field]]:has-[:focus-visible]:ring-2 scn:has-[>[data-slot=field]]:has-[:focus-visible]:ring-ring/30 scn:*:data-[slot=field]:p-2 scn:dark:has-data-checked:bg-primary/10",
        "scn:has-[>[data-slot=field]]:w-full scn:has-[>[data-slot=field]]:flex-col",
        className
      )}
      {...props}
    />
  )
}

function FieldTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="field-label"
      className={cn(
        "scn:flex scn:w-fit scn:items-center scn:gap-2 scn:text-xs/relaxed scn:font-medium scn:group-data-[disabled=true]/field:opacity-50",
        className
      )}
      {...props}
    />
  )
}

function FieldDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="field-description"
      className={cn(
        "scn:text-left scn:text-xs/relaxed scn:leading-normal scn:font-normal scn:text-muted-foreground scn:group-has-data-horizontal/field:text-balance scn:[[data-variant=legend]+&]:-mt-1.5",
        "scn:last:mt-0 scn:nth-last-2:-mt-1",
        "scn:[&>a]:underline scn:[&>a]:underline-offset-4 scn:[&>a:hover]:text-primary",
        className
      )}
      {...props}
    />
  )
}

function FieldSeparator({
  children,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  children?: React.ReactNode
}) {
  return (
    <div
      data-slot="field-separator"
      data-content={!!children}
      className={cn(
        "scn:relative scn:-my-2 scn:h-5 scn:text-xs/relaxed scn:group-data-[variant=outline]/field-group:-mb-2",
        className
      )}
      {...props}
    >
      <Separator className="scn:absolute scn:inset-0 scn:top-1/2" />
      {children && (
        <span
          className="scn:relative scn:mx-auto scn:block scn:w-fit scn:bg-background scn:px-2 scn:text-muted-foreground"
          data-slot="field-separator-content"
        >
          {children}
        </span>
      )}
    </div>
  )
}

function FieldError({
  className,
  children,
  errors,
  ...props
}: React.ComponentProps<"div"> & {
  errors?: Array<{ message?: string } | undefined>
}) {
  const content = useMemo(() => {
    if (children) {
      return children
    }

    if (!errors?.length) {
      return null
    }

    const uniqueErrors = [
      ...new Map(errors.map((error) => [error?.message, error])).values(),
    ]

    if (uniqueErrors?.length == 1) {
      return uniqueErrors[0]?.message
    }

    return (
      <ul className="scn:ml-4 scn:flex scn:list-disc scn:flex-col scn:gap-1">
        {uniqueErrors.map(
          (error, index) =>
            error?.message && <li key={index}>{error.message}</li>
        )}
      </ul>
    )
  }, [children, errors])

  if (!content) {
    return null
  }

  return (
    <div
      role="alert"
      data-slot="field-error"
      className={cn("scn:text-xs/relaxed scn:font-normal scn:text-destructive", className)}
      {...props}
    >
      {content}
    </div>
  )
}

export {
  Field,
  FieldLabel,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLegend,
  FieldSeparator,
  FieldSet,
  FieldContent,
  FieldTitle,
}
