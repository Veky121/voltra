"use client"

import { Radio as RadioPrimitive } from "@base-ui/react/radio"
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group"
import { cn } from "@/lib/utils"

function RadioGroup({ className, ...props }: RadioGroupPrimitive.Props) {
  return (
    <RadioGroupPrimitive
      data-slot="radio-group"
      className={cn("scn:grid scn:w-full scn:gap-3", className)}
      {...props}
    />
  )
}

function RadioGroupItem({ className, ...props }: RadioPrimitive.Root.Props) {
  return (
    <RadioPrimitive.Root
      data-slot="radio-group-item"
      className={cn(
        "scn:group/radio-group-item scn:peer scn:relative scn:flex scn:aspect-square scn:size-4 scn:shrink-0 scn:rounded-full scn:border scn:border-input scn:outline-none scn:group-has-[:focus-visible]/field-label:ring-0 scn:group-has-[:focus-visible]/field-label:not-data-checked:border-input scn:after:absolute scn:after:-inset-x-3 scn:after:-inset-y-2 scn:focus-visible:border-ring scn:focus-visible:ring-3 scn:focus-visible:ring-ring/50 scn:disabled:cursor-not-allowed scn:disabled:opacity-50 scn:aria-invalid:border-destructive scn:aria-invalid:ring-3 scn:aria-invalid:ring-destructive/20 scn:aria-invalid:aria-checked:border-primary scn:dark:bg-input/30 scn:dark:aria-invalid:border-destructive/50 scn:dark:aria-invalid:ring-destructive/40 scn:data-checked:border-primary scn:data-checked:bg-primary scn:data-checked:text-primary-foreground scn:group-has-[:focus-visible]/field-label:data-checked:border-primary scn:dark:data-checked:bg-primary",
        className
      )}
      {...props}
    >
      <RadioPrimitive.Indicator
        data-slot="radio-group-indicator"
        className="scn:flex scn:size-4 scn:items-center scn:justify-center"
      >
        <span className="scn:absolute scn:top-1/2 scn:left-1/2 scn:size-2 scn:-translate-x-1/2 scn:-translate-y-1/2 scn:rounded-full scn:bg-primary-foreground" />
      </RadioPrimitive.Indicator>
    </RadioPrimitive.Root>
  )
}

export { RadioGroup, RadioGroupItem }
