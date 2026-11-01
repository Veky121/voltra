"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

function InputGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="input-group"
      role="group"
      className={cn(
        "scn:group/input-group scn:relative scn:flex scn:h-7 scn:w-full scn:min-w-0 scn:items-center scn:rounded-md scn:border scn:border-input scn:bg-input/20 scn:transition-colors scn:outline-none scn:in-data-[slot=combobox-content]:focus-within:border-inherit scn:in-data-[slot=combobox-content]:focus-within:ring-0 scn:has-data-[align=block-end]:rounded-md scn:has-data-[align=block-start]:rounded-md scn:has-[[data-slot=input-group-control]:focus-visible]:border-ring scn:has-[[data-slot=input-group-control]:focus-visible]:ring-2 scn:has-[[data-slot=input-group-control]:focus-visible]:ring-ring/30 scn:has-[[data-slot][aria-invalid=true]]:border-destructive scn:has-[[data-slot][aria-invalid=true]]:ring-2 scn:has-[[data-slot][aria-invalid=true]]:ring-destructive/20 scn:has-[textarea]:rounded-md scn:has-[>[data-align=block-end]]:h-auto scn:has-[>[data-align=block-end]]:flex-col scn:has-[>[data-align=block-start]]:h-auto scn:has-[>[data-align=block-start]]:flex-col scn:has-[>textarea]:h-auto scn:dark:bg-input/30 scn:dark:has-[[data-slot][aria-invalid=true]]:ring-destructive/40 scn:has-[>[data-align=block-end]]:[&>input]:pt-3 scn:has-[>[data-align=block-start]]:[&>input]:pb-3 scn:has-[>[data-align=inline-end]]:[&>input]:pr-1.5 scn:has-[>[data-align=inline-start]]:[&>input]:pl-1.5",
        className
      )}
      {...props}
    />
  )
}

const inputGroupAddonVariants = cva(
  "scn:flex scn:h-auto scn:cursor-text scn:items-center scn:justify-center scn:gap-1 scn:py-2 scn:text-xs/relaxed scn:font-medium scn:text-muted-foreground scn:select-none scn:group-data-[disabled=true]/input-group:opacity-50 scn:**:data-[slot=kbd]:rounded-[calc(var(--radius-sm)-2px)] scn:**:data-[slot=kbd]:bg-muted-foreground/10 scn:**:data-[slot=kbd]:px-1 scn:**:data-[slot=kbd]:text-[0.625rem] scn:[&>svg:not([class*='size-'])]:size-3.5",
  {
    variants: {
      align: {
        "inline-start":
          "scn:order-first scn:pl-2 scn:has-[>button]:ml-[-0.275rem] scn:has-[>kbd]:ml-[-0.275rem]",
        "inline-end":
          "scn:order-last scn:pr-2 scn:has-[>button]:mr-[-0.275rem] scn:has-[>kbd]:mr-[-0.275rem]",
        "block-start":
          "scn:order-first scn:w-full scn:justify-start scn:px-2 scn:pt-2 scn:group-has-[>input]/input-group:pt-2 scn:[.border-b]:pb-2",
        "block-end":
          "scn:order-last scn:w-full scn:justify-start scn:px-2 scn:pb-2 scn:group-has-[>input]/input-group:pb-2 scn:[.border-t]:pt-2",
      },
    },
    defaultVariants: {
      align: "inline-start",
    },
  }
)

function InputGroupAddon({
  className,
  align = "inline-start",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof inputGroupAddonVariants>) {
  return (
    <div
      role="group"
      data-slot="input-group-addon"
      data-align={align}
      className={cn(inputGroupAddonVariants({ align }), className)}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button")) {
          return
        }
        e.currentTarget.parentElement?.querySelector("input")?.focus()
      }}
      {...props}
    />
  )
}

const inputGroupButtonVariants = cva(
  "scn:flex scn:items-center scn:gap-2 scn:rounded-md scn:text-xs/relaxed scn:shadow-none",
  {
    variants: {
      size: {
        xs: "scn:h-5 scn:gap-1 scn:rounded-[calc(var(--radius-sm)-2px)] scn:px-1 scn:[&>svg:not([class*='size-'])]:size-3",
        sm: "scn:gap-1",
        "icon-xs": "scn:size-6 scn:p-0 scn:has-[>svg]:p-0",
        "icon-sm": "scn:size-7 scn:p-0 scn:has-[>svg]:p-0",
      },
    },
    defaultVariants: {
      size: "xs",
    },
  }
)

function InputGroupButton({
  className,
  type = "button",
  variant = "ghost",
  size = "xs",
  ...props
}: Omit<React.ComponentProps<typeof Button>, "size" | "type"> &
  VariantProps<typeof inputGroupButtonVariants> & {
    type?: "button" | "submit" | "reset"
  }) {
  return (
    <Button
      type={type}
      data-size={size}
      variant={variant}
      className={cn(inputGroupButtonVariants({ size }), className)}
      {...props}
    />
  )
}

function InputGroupText({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "scn:flex scn:items-center scn:gap-2 scn:text-xs/relaxed scn:text-muted-foreground scn:[&_svg]:pointer-events-none scn:[&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    />
  )
}

function InputGroupInput({
  className,
  ...props
}: React.ComponentProps<"input">) {
  return (
    <Input
      data-slot="input-group-control"
      className={cn(
        "scn:flex-1 scn:rounded-none scn:border-0 scn:bg-transparent scn:shadow-none scn:ring-0 scn:focus-visible:ring-0 scn:aria-invalid:ring-0 scn:dark:bg-transparent",
        className
      )}
      {...props}
    />
  )
}

function InputGroupTextarea({
  className,
  ...props
}: React.ComponentProps<"textarea">) {
  return (
    <Textarea
      data-slot="input-group-control"
      className={cn(
        "scn:flex-1 scn:resize-none scn:rounded-none scn:border-0 scn:bg-transparent scn:py-2 scn:shadow-none scn:ring-0 scn:focus-visible:ring-0 scn:aria-invalid:ring-0 scn:dark:bg-transparent",
        className
      )}
      {...props}
    />
  )
}

export {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
  InputGroupInput,
  InputGroupTextarea,
}
