"use client"

import * as React from "react"
import { Select as SelectPrimitive } from "@base-ui/react/select"
import { cn } from "@/lib/utils"
import {useOverlayPortalContainer} from '../../ui/OverlayPortal'

import {ChevronDownIcon, ChevronUpIcon, CheckIcon} from "lucide-react"

const Select = SelectPrimitive.Root

function SelectGroup({ className, ...props }: SelectPrimitive.Group.Props) {
  return (
    <SelectPrimitive.Group
      data-slot="select-group"
      className={cn("scn:scroll-my-1 scn:p-1", className)}
      {...props}
    />
  )
}

function SelectValue({ className, ...props }: SelectPrimitive.Value.Props) {
  return (
    <SelectPrimitive.Value
      data-slot="select-value"
      className={cn("scn:flex scn:flex-1 scn:text-left", className)}
      {...props}
    />
  )
}

function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}: SelectPrimitive.Trigger.Props & {
  size?: "sm" | "default"
}) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        "scn:flex scn:w-fit scn:items-center scn:justify-between scn:gap-1.5 scn:rounded-md scn:border scn:border-input scn:bg-input/20 scn:px-2 scn:py-1.5 scn:text-xs/relaxed scn:whitespace-nowrap scn:transition-colors scn:outline-none scn:focus-visible:border-ring scn:focus-visible:ring-2 scn:focus-visible:ring-ring/30 scn:disabled:cursor-not-allowed scn:disabled:opacity-50 scn:aria-invalid:border-destructive scn:aria-invalid:ring-2 scn:aria-invalid:ring-destructive/20 scn:data-placeholder:text-muted-foreground scn:data-[size=default]:h-7 scn:data-[size=sm]:h-6 scn:*:data-[slot=select-value]:line-clamp-1 scn:*:data-[slot=select-value]:flex scn:*:data-[slot=select-value]:items-center scn:*:data-[slot=select-value]:gap-1.5 scn:dark:bg-input/30 scn:dark:hover:bg-input/50 scn:dark:aria-invalid:border-destructive/50 scn:dark:aria-invalid:ring-destructive/40 scn:[&_svg]:pointer-events-none scn:[&_svg]:shrink-0 scn:[&_svg:not([class*='size-'])]:size-3.5",
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon
        render={
          <ChevronDownIcon className="scn:pointer-events-none scn:size-3.5 scn:text-muted-foreground"/>
        }
      />
    </SelectPrimitive.Trigger>
  )
}

function SelectContent({
  className,
  children,
  portalContainer,
  side = "bottom",
  sideOffset = 4,
  align = "center",
  alignOffset = 0,
  alignItemWithTrigger = true,
  ...props
}: SelectPrimitive.Popup.Props &
  {portalContainer?: SelectPrimitive.Portal.Props["container"]} &
  Pick<
    SelectPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset" | "alignItemWithTrigger"
  >) {
  const container=useOverlayPortalContainer()
  return (
    <SelectPrimitive.Portal container={portalContainer??container}>
      <SelectPrimitive.Positioner
        // Dialog portals stay in the top layer, but their menus use viewport
        // coordinates and must escape the dialog's scrolling overflow.
        positionMethod={portalContainer || container ? "fixed" : undefined}
        collisionBoundary={[]}
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        alignItemWithTrigger={alignItemWithTrigger}
        className="scn:isolate scn:z-[280]"
      >
        <SelectPrimitive.Popup
          data-slot="select-content"
          data-align-trigger={alignItemWithTrigger}
          className={cn(
            "scn:relative scn:isolate scn:z-50 scn:max-h-(--available-height) scn:w-(--anchor-width) scn:min-w-32 scn:origin-(--transform-origin) scn:overflow-x-hidden scn:overflow-y-auto scn:rounded-lg scn:bg-popover scn:text-popover-foreground scn:shadow-md scn:ring-1 scn:ring-foreground/10 scn:duration-100 scn:data-[align-trigger=true]:animate-none scn:data-[side=bottom]:slide-in-from-top-2 scn:data-[side=inline-end]:slide-in-from-left-2 scn:data-[side=inline-start]:slide-in-from-right-2 scn:data-[side=left]:slide-in-from-right-2 scn:data-[side=right]:slide-in-from-left-2 scn:data-[side=top]:slide-in-from-bottom-2 scn:data-open:animate-in scn:data-open:fade-in-0 scn:data-open:zoom-in-95 scn:data-closed:animate-out scn:data-closed:fade-out-0 scn:data-closed:zoom-out-95",
            className
          )}
          {...props}
        >
          <SelectScrollUpButton />
          <SelectPrimitive.List>{children}</SelectPrimitive.List>
          <SelectScrollDownButton />
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  )
}

function SelectLabel({
  className,
  ...props
}: SelectPrimitive.GroupLabel.Props) {
  return (
    <SelectPrimitive.GroupLabel
      data-slot="select-label"
      className={cn("scn:px-2 scn:py-1.5 scn:text-xs scn:text-muted-foreground", className)}
      {...props}
    />
  )
}

function SelectItem({
  className,
  children,
  ...props
}: SelectPrimitive.Item.Props) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "scn:relative scn:flex scn:min-h-7 scn:w-full scn:cursor-default scn:items-center scn:gap-2 scn:rounded-md scn:px-2 scn:py-1 scn:text-xs/relaxed scn:outline-hidden scn:select-none scn:focus:bg-accent scn:focus:text-accent-foreground scn:not-data-[variant=destructive]:focus:**:text-accent-foreground scn:data-disabled:pointer-events-none scn:data-disabled:opacity-50 scn:[&_svg]:pointer-events-none scn:[&_svg]:shrink-0 scn:[&_svg:not([class*='size-'])]:size-3.5 scn:*:[span]:last:flex scn:*:[span]:last:items-center scn:*:[span]:last:gap-2",
        className
      )}
      {...props}
    >
      <SelectPrimitive.ItemText className="scn:flex scn:flex-1 scn:shrink-0 scn:gap-2 scn:whitespace-nowrap">
        {children}
      </SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator
        render={
          <span className="scn:pointer-events-none scn:absolute scn:right-2 scn:flex scn:items-center scn:justify-center" />
        }
      >
        <CheckIcon className="scn:pointer-events-none"/>
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  )
}

function SelectSeparator({
  className,
  ...props
}: SelectPrimitive.Separator.Props) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn(
        "scn:pointer-events-none scn:-mx-1 scn:my-1 scn:h-px scn:bg-border/50",
        className
      )}
      {...props}
    />
  )
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpArrow>) {
  return (
    <SelectPrimitive.ScrollUpArrow
      data-slot="select-scroll-up-button"
      className={cn(
        "scn:top-0 scn:z-10 scn:flex scn:w-full scn:cursor-default scn:items-center scn:justify-center scn:bg-popover scn:py-1 scn:[&_svg:not([class*='size-'])]:size-3.5",
        className
      )}
      {...props}
    >
      <ChevronUpIcon/>
    </SelectPrimitive.ScrollUpArrow>
  )
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownArrow>) {
  return (
    <SelectPrimitive.ScrollDownArrow
      data-slot="select-scroll-down-button"
      className={cn(
        "scn:bottom-0 scn:z-10 scn:flex scn:w-full scn:cursor-default scn:items-center scn:justify-center scn:bg-popover scn:py-1 scn:[&_svg:not([class*='size-'])]:size-3.5",
        className
      )}
      {...props}
    >
      <ChevronDownIcon/>
    </SelectPrimitive.ScrollDownArrow>
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
}
