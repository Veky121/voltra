"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      className={cn(
        "scn:flex scn:items-center scn:gap-2 scn:text-xs/relaxed scn:leading-none scn:font-medium scn:select-none scn:group-data-[disabled=true]:pointer-events-none scn:group-data-[disabled=true]:opacity-50 scn:peer-disabled:cursor-not-allowed scn:peer-disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Label }
