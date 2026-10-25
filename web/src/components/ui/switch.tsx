"use client"

import { Switch as SwitchPrimitive } from "@base-ui/react/switch"
import { cn } from "@/lib/utils"

function Switch({
  className,
  size = "default",
  ...props
}: SwitchPrimitive.Root.Props & {
  size?: "sm" | "default"
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "scn:peer scn:group/switch scn:relative scn:inline-flex scn:shrink-0 scn:items-center scn:rounded-full scn:border scn:border-transparent scn:transition-all scn:outline-none scn:group-has-[:focus-visible]/field-label:border-transparent scn:group-has-[:focus-visible]/field-label:ring-0 scn:after:absolute scn:after:-inset-x-3 scn:after:-inset-y-2 scn:focus-visible:border-ring scn:focus-visible:ring-2 scn:focus-visible:ring-ring/30 scn:aria-invalid:border-destructive scn:aria-invalid:ring-2 scn:aria-invalid:ring-destructive/20 scn:data-[size=default]:h-[16.6px] scn:data-[size=default]:w-[28px] scn:data-[size=sm]:h-[14px] scn:data-[size=sm]:w-[24px] scn:dark:aria-invalid:border-destructive/50 scn:dark:aria-invalid:ring-destructive/40 scn:data-checked:bg-primary scn:data-unchecked:bg-input scn:dark:data-unchecked:bg-input/80 scn:data-disabled:cursor-not-allowed scn:data-disabled:opacity-50",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="scn:pointer-events-none scn:block scn:rounded-full scn:bg-background scn:ring-0 scn:transition-transform scn:group-data-[size=default]/switch:size-3.5 scn:group-data-[size=sm]/switch:size-3 scn:group-data-[size=default]/switch:data-checked:translate-x-[calc(100%-2px)] scn:group-data-[size=sm]/switch:data-checked:translate-x-[calc(100%-2px)] scn:dark:data-checked:bg-primary-foreground scn:group-data-[size=default]/switch:data-unchecked:translate-x-0 scn:group-data-[size=sm]/switch:data-unchecked:translate-x-0 scn:dark:data-unchecked:bg-foreground"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
