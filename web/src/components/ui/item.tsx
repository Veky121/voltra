import * as React from "react"
import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

import { Separator } from "@/components/ui/separator"

function ItemGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      role="list"
      data-slot="item-group"
      className={cn(
        "scn:group/item-group scn:flex scn:w-full scn:flex-col scn:gap-4 scn:has-data-[size=sm]:gap-2.5 scn:has-data-[size=xs]:gap-2",
        className
      )}
      {...props}
    />
  )
}

function ItemSeparator({
  className,
  ...props
}: React.ComponentProps<typeof Separator>) {
  return (
    <Separator
      data-slot="item-separator"
      orientation="horizontal"
      className={cn("scn:my-2", className)}
      {...props}
    />
  )
}

const itemVariants = cva(
  "scn:group/item scn:flex scn:w-full scn:flex-wrap scn:items-center scn:rounded-md scn:border scn:text-xs/relaxed scn:transition-colors scn:duration-100 scn:outline-none scn:focus-visible:border-ring scn:focus-visible:ring-[3px] scn:focus-visible:ring-ring/50 scn:[a]:transition-colors scn:[a]:hover:bg-muted",
  {
    variants: {
      variant: {
        default: "scn:border-transparent",
        outline: "scn:border-border",
        muted: "scn:border-transparent scn:bg-muted/50",
      },
      size: {
        default: "scn:gap-2.5 scn:px-3 scn:py-2.5",
        sm: "scn:gap-2.5 scn:px-3 scn:py-2.5",
        xs: "scn:gap-2.5 scn:px-2.5 scn:py-2 scn:in-data-[slot=dropdown-menu-content]:p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Item({
  className,
  variant = "default",
  size = "default",
  render,
  ...props
}: useRender.ComponentProps<"div"> & VariantProps<typeof itemVariants>) {
  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(
      {
        className: cn(itemVariants({ variant, size, className })),
      },
      props
    ),
    render,
    state: {
      slot: "item",
      variant,
      size,
    },
  })
}

const itemMediaVariants = cva(
  "scn:flex scn:shrink-0 scn:items-center scn:justify-center scn:gap-2 scn:group-has-data-[slot=item-description]/item:translate-y-0.5 scn:group-has-data-[slot=item-description]/item:self-start scn:[&_svg]:pointer-events-none",
  {
    variants: {
      variant: {
        default: "scn:bg-transparent",
        icon: "scn:[&_svg:not([class*=size-])]:size-4",
        image:
          "scn:size-8 scn:overflow-hidden scn:rounded-sm scn:group-data-[size=sm]/item:size-8 scn:group-data-[size=xs]/item:size-6 scn:[&_img]:size-full scn:[&_img]:object-cover",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function ItemMedia({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof itemMediaVariants>) {
  return (
    <div
      data-slot="item-media"
      data-variant={variant}
      className={cn(itemMediaVariants({ variant, className }))}
      {...props}
    />
  )
}

function ItemContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="item-content"
      className={cn(
        "scn:flex scn:flex-1 scn:flex-col scn:gap-1 scn:group-data-[size=xs]/item:gap-0.5 scn:[&+[data-slot=item-content]]:flex-none",
        className
      )}
      {...props}
    />
  )
}

function ItemTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="item-title"
      className={cn(
        "scn:line-clamp-1 scn:flex scn:w-fit scn:items-center scn:gap-2 scn:text-xs/relaxed scn:leading-snug scn:font-medium scn:underline-offset-4",
        className
      )}
      {...props}
    />
  )
}

function ItemDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="item-description"
      className={cn(
        "scn:line-clamp-2 scn:text-left scn:text-xs/relaxed scn:font-normal scn:text-muted-foreground scn:[&>a]:underline scn:[&>a]:underline-offset-4 scn:[&>a:hover]:text-primary",
        className
      )}
      {...props}
    />
  )
}

function ItemActions({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="item-actions"
      className={cn("scn:flex scn:items-center scn:gap-2", className)}
      {...props}
    />
  )
}

function ItemHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="item-header"
      className={cn(
        "scn:flex scn:basis-full scn:items-center scn:justify-between scn:gap-2",
        className
      )}
      {...props}
    />
  )
}

function ItemFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="item-footer"
      className={cn(
        "scn:flex scn:basis-full scn:items-center scn:justify-between scn:gap-2",
        className
      )}
      {...props}
    />
  )
}

export {
  Item,
  ItemMedia,
  ItemContent,
  ItemActions,
  ItemGroup,
  ItemSeparator,
  ItemTitle,
  ItemDescription,
  ItemHeader,
  ItemFooter,
}
