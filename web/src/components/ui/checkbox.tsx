"use client"

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox"
import { cn } from "@/lib/utils"

import { CheckIcon } from "lucide-react"

function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "scn:peer scn:relative scn:flex scn:size-4 scn:shrink-0 scn:items-center scn:justify-center scn:rounded-[4px] scn:border scn:border-input scn:transition-shadow scn:outline-none scn:group-has-disabled/field:opacity-50 scn:group-has-[:focus-visible]/field-label:ring-0 scn:group-has-[:focus-visible]/field-label:not-data-checked:border-input scn:after:absolute scn:after:-inset-x-3 scn:after:-inset-y-2 scn:focus-visible:border-ring scn:focus-visible:ring-2 scn:focus-visible:ring-ring/30 scn:disabled:cursor-not-allowed scn:disabled:opacity-50 scn:aria-invalid:border-destructive scn:aria-invalid:ring-2 scn:aria-invalid:ring-destructive/20 scn:aria-invalid:aria-checked:border-primary scn:dark:bg-input/30 scn:dark:aria-invalid:border-destructive/50 scn:dark:aria-invalid:ring-destructive/40 scn:data-checked:border-primary scn:data-checked:bg-primary scn:data-checked:text-primary-foreground scn:group-has-[:focus-visible]/field-label:data-checked:border-primary scn:dark:data-checked:bg-primary",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="scn:grid scn:place-content-center scn:text-current scn:transition-none scn:[&>svg]:size-3.5"
      >
        <CheckIcon/>
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
