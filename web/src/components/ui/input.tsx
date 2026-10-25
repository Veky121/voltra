import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"
import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "scn:h-7 scn:w-full scn:min-w-0 scn:rounded-md scn:border scn:border-input scn:bg-input/20 scn:px-2 scn:py-0.5 scn:text-sm scn:transition-colors scn:outline-none scn:file:inline-flex scn:file:h-6 scn:file:border-0 scn:file:bg-transparent scn:file:text-xs/relaxed scn:file:font-medium scn:file:text-foreground scn:placeholder:text-muted-foreground scn:focus-visible:border-ring scn:focus-visible:ring-2 scn:focus-visible:ring-ring/30 scn:disabled:pointer-events-none scn:disabled:cursor-not-allowed scn:disabled:opacity-50 scn:aria-invalid:border-destructive scn:aria-invalid:ring-2 scn:aria-invalid:ring-destructive/20 scn:md:text-xs/relaxed scn:dark:bg-input/30 scn:dark:aria-invalid:border-destructive/50 scn:dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Input }
