import * as React from "react"
import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "scn:flex scn:field-sizing-content scn:min-h-16 scn:w-full scn:resize-none scn:rounded-md scn:border scn:border-input scn:bg-input/20 scn:px-2 scn:py-2 scn:text-sm scn:transition-colors scn:outline-none scn:placeholder:text-muted-foreground scn:focus-visible:border-ring scn:focus-visible:ring-2 scn:focus-visible:ring-ring/30 scn:disabled:cursor-not-allowed scn:disabled:opacity-50 scn:aria-invalid:border-destructive scn:aria-invalid:ring-2 scn:aria-invalid:ring-destructive/20 scn:md:text-xs/relaxed scn:dark:bg-input/30 scn:dark:aria-invalid:border-destructive/50 scn:dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
