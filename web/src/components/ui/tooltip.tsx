"use client"

import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip"
import { cn } from "@/lib/utils"

function TooltipProvider({
  delay = 0,
  ...props
}: TooltipPrimitive.Provider.Props) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delay={delay}
      {...props}
    />
  )
}

function Tooltip({ ...props }: TooltipPrimitive.Root.Props) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />
}

function TooltipTrigger({ ...props }: TooltipPrimitive.Trigger.Props) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

function TooltipContent({
  className,
  side = "top",
  sideOffset = 4,
  align = "center",
  alignOffset = 0,
  children,
  ...props
}: TooltipPrimitive.Popup.Props &
  Pick<
    TooltipPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  >) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className="scn:isolate scn:z-50"
      >
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={cn(
            "scn:z-50 scn:inline-flex scn:w-fit scn:max-w-xs scn:origin-(--transform-origin) scn:items-center scn:gap-1.5 scn:rounded-md scn:bg-foreground scn:px-3 scn:py-1.5 scn:text-xs scn:text-background scn:has-data-[slot=kbd]:pr-1.5 scn:data-[side=bottom]:slide-in-from-top-2 scn:data-[side=inline-end]:slide-in-from-left-2 scn:data-[side=inline-start]:slide-in-from-right-2 scn:data-[side=left]:slide-in-from-right-2 scn:data-[side=right]:slide-in-from-left-2 scn:data-[side=top]:slide-in-from-bottom-2 scn:**:data-[slot=kbd]:relative scn:**:data-[slot=kbd]:isolate scn:**:data-[slot=kbd]:z-50 scn:**:data-[slot=kbd]:rounded-sm scn:data-[state=delayed-open]:animate-in scn:data-[state=delayed-open]:fade-in-0 scn:data-[state=delayed-open]:zoom-in-95 scn:data-open:animate-in scn:data-open:fade-in-0 scn:data-open:zoom-in-95 scn:data-closed:animate-out scn:data-closed:fade-out-0 scn:data-closed:zoom-out-95",
            className
          )}
          {...props}
        >
          {children}
          <TooltipPrimitive.Arrow className="scn:z-50 scn:size-2.5 scn:translate-y-[calc(-50%-2px)] scn:rotate-45 scn:rounded-[2px] scn:bg-foreground scn:fill-foreground scn:data-[side=bottom]:top-1 scn:data-[side=inline-end]:top-1/2! scn:data-[side=inline-end]:-left-1 scn:data-[side=inline-end]:-translate-y-1/2 scn:data-[side=inline-start]:top-1/2! scn:data-[side=inline-start]:-right-1 scn:data-[side=inline-start]:-translate-y-1/2 scn:data-[side=left]:top-1/2! scn:data-[side=left]:-right-1 scn:data-[side=left]:-translate-y-1/2 scn:data-[side=right]:top-1/2! scn:data-[side=right]:-left-1 scn:data-[side=right]:-translate-y-1/2 scn:data-[side=top]:-bottom-2.5" />
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
