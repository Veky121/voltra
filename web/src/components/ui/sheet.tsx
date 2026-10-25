import * as React from "react"
import { Dialog as SheetPrimitive } from "@base-ui/react/dialog"
import { cn } from "@/lib/utils"

import { Button } from "@/components/ui/button"
import { XIcon } from "lucide-react"

function Sheet({ ...props }: SheetPrimitive.Root.Props) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger({ ...props }: SheetPrimitive.Trigger.Props) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose({ ...props }: SheetPrimitive.Close.Props) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetPortal({ ...props }: SheetPrimitive.Portal.Props) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />
}

function SheetOverlay({ className, ...props }: SheetPrimitive.Backdrop.Props) {
  return (
    <SheetPrimitive.Backdrop
      data-slot="sheet-overlay"
      className={cn(
        "scn:fixed scn:inset-0 scn:z-50 scn:bg-black/80 scn:transition-opacity scn:duration-150 scn:data-ending-style:opacity-0 scn:data-starting-style:opacity-0 scn:supports-backdrop-filter:backdrop-blur-xs",
        className
      )}
      {...props}
    />
  )
}

function SheetContent({
  className,
  children,
  side = "right",
  showCloseButton = true,
  ...props
}: SheetPrimitive.Popup.Props & {
  side?: "top" | "right" | "bottom" | "left"
  showCloseButton?: boolean
}) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Popup
        data-slot="sheet-content"
        data-side={side}
        className={cn(
          "scn:fixed scn:z-50 scn:flex scn:flex-col scn:bg-popover scn:bg-clip-padding scn:text-xs/relaxed scn:text-popover-foreground scn:shadow-lg scn:transition scn:duration-200 scn:ease-in-out scn:data-ending-style:opacity-0 scn:data-starting-style:opacity-0 scn:data-[side=bottom]:inset-x-0 scn:data-[side=bottom]:bottom-0 scn:data-[side=bottom]:h-auto scn:data-[side=bottom]:border-t scn:data-[side=bottom]:data-ending-style:translate-y-[2.5rem] scn:data-[side=bottom]:data-starting-style:translate-y-[2.5rem] scn:data-[side=left]:inset-y-0 scn:data-[side=left]:left-0 scn:data-[side=left]:h-full scn:data-[side=left]:w-3/4 scn:data-[side=left]:border-r scn:data-[side=left]:data-ending-style:translate-x-[-2.5rem] scn:data-[side=left]:data-starting-style:translate-x-[-2.5rem] scn:data-[side=right]:inset-y-0 scn:data-[side=right]:right-0 scn:data-[side=right]:h-full scn:data-[side=right]:w-3/4 scn:data-[side=right]:border-l scn:data-[side=right]:data-ending-style:translate-x-[2.5rem] scn:data-[side=right]:data-starting-style:translate-x-[2.5rem] scn:data-[side=top]:inset-x-0 scn:data-[side=top]:top-0 scn:data-[side=top]:h-auto scn:data-[side=top]:border-b scn:data-[side=top]:data-ending-style:translate-y-[-2.5rem] scn:data-[side=top]:data-starting-style:translate-y-[-2.5rem] scn:data-[side=left]:sm:max-w-sm scn:data-[side=right]:sm:max-w-sm",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <SheetPrimitive.Close
            data-slot="sheet-close"
            render={
              <Button
                variant="ghost"
                className="scn:absolute scn:top-4 scn:right-4"
                size="icon-sm"
              />
            }
          >
            <XIcon
            />
            <span className="scn:sr-only">Close</span>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Popup>
    </SheetPortal>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("scn:flex scn:flex-col scn:gap-1.5 scn:p-6", className)}
      {...props}
    />
  )
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("scn:mt-auto scn:flex scn:flex-col scn:gap-2 scn:p-6", className)}
      {...props}
    />
  )
}

function SheetTitle({ className, ...props }: SheetPrimitive.Title.Props) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn(
        " scn:text-sm scn:font-medium scn:text-foreground",
        className
      )}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: SheetPrimitive.Description.Props) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("scn:text-xs/relaxed scn:text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
