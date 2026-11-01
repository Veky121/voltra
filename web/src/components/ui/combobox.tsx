import {useOverlayPortalContainer} from '../../ui/OverlayPortal';
"use client"

import * as React from "react"
import { Combobox as ComboboxPrimitive } from "@base-ui/react"
import { cn } from "@/lib/utils"

import { Button } from "@/components/ui/button"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import { ChevronDownIcon, XIcon, CheckIcon } from "lucide-react"

const Combobox = ComboboxPrimitive.Root

function ComboboxValue({ ...props }: ComboboxPrimitive.Value.Props) {
  return <ComboboxPrimitive.Value data-slot="combobox-value" {...props} />
}

function ComboboxTrigger({
  className,
  children,
  ...props
}: ComboboxPrimitive.Trigger.Props) {
  return (
    <ComboboxPrimitive.Trigger
      data-slot="combobox-trigger"
      className={cn("scn:[&_svg:not([class*='size-'])]:size-3.5", className)}
      {...props}
    >
      {children}
      <ChevronDownIcon className="scn:pointer-events-none scn:size-3.5 scn:text-muted-foreground"/>
    </ComboboxPrimitive.Trigger>
  )
}

function ComboboxClear({ className, ...props }: ComboboxPrimitive.Clear.Props) {
  return (
    <ComboboxPrimitive.Clear
      data-slot="combobox-clear"
      render={<InputGroupButton variant="ghost" size="icon-xs" />}
      className={cn(className)}
      {...props}
    >
      <XIcon className="scn:pointer-events-none"/>
    </ComboboxPrimitive.Clear>
  )
}

function ComboboxInput({
  className,
  children,
  disabled = false,
  showTrigger = true,
  showClear = false,
  ...props
}: ComboboxPrimitive.Input.Props & {
  showTrigger?: boolean
  showClear?: boolean
}) {
  return (
    <InputGroup className={cn("scn:w-auto", className)}>
      <ComboboxPrimitive.Input
        render={<InputGroupInput disabled={disabled} />}
        {...props}
      />
      <InputGroupAddon align="inline-end">
        {showTrigger && (
          <InputGroupButton
            size="icon-xs"
            variant="ghost"
            render={<ComboboxTrigger />}
            data-slot="input-group-button"
            className="scn:group-has-data-[slot=combobox-clear]/input-group:hidden scn:data-pressed:bg-transparent"
            disabled={disabled}
          />
        )}
        {showClear && <ComboboxClear disabled={disabled} />}
      </InputGroupAddon>
      {children}
    </InputGroup>
  )
}

function ComboboxContent({
  className,
  side = "bottom",
  sideOffset = 6,
  align = "start",
  alignOffset = 0,
  anchor,
  ...props
}: ComboboxPrimitive.Popup.Props &
  Pick<
    ComboboxPrimitive.Positioner.Props,
    "side" | "align" | "sideOffset" | "alignOffset" | "anchor"
  >) {
  const container=useOverlayPortalContainer();
  return (
    <ComboboxPrimitive.Portal container={container}>
      <ComboboxPrimitive.Positioner positionMethod="fixed" collisionBoundary={[]}
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        anchor={anchor}
        className="scn:isolate scn:z-[280]"
      >
        <ComboboxPrimitive.Popup
          data-slot="combobox-content"
          data-chips={!!anchor}
          className={cn(
            "scn:cn-menu-target scn:cn-menu-translucent scn:group/combobox-content scn:relative scn:max-h-(--available-height) scn:w-(--anchor-width) scn:max-w-(--available-width) scn:min-w-[calc(var(--anchor-width)+--spacing(7))] scn:origin-(--transform-origin) scn:overflow-hidden scn:rounded-lg scn:bg-popover scn:text-popover-foreground scn:shadow-md scn:ring-1 scn:ring-foreground/10 scn:duration-100 scn:data-[chips=true]:min-w-(--anchor-width) scn:data-[side=bottom]:slide-in-from-top-2 scn:data-[side=inline-end]:slide-in-from-left-2 scn:data-[side=inline-start]:slide-in-from-right-2 scn:data-[side=left]:slide-in-from-right-2 scn:data-[side=right]:slide-in-from-left-2 scn:data-[side=top]:slide-in-from-bottom-2 scn:*:data-[slot=input-group]:m-1 scn:*:data-[slot=input-group]:mb-0 scn:*:data-[slot=input-group]:h-7 scn:*:data-[slot=input-group]:border-none scn:*:data-[slot=input-group]:bg-input/20 scn:*:data-[slot=input-group]:shadow-none scn:dark:bg-popover scn:data-open:animate-in scn:data-open:fade-in-0 scn:data-open:zoom-in-95 scn:data-closed:animate-out scn:data-closed:fade-out-0 scn:data-closed:zoom-out-95",
            className
          )}
          {...props}
        />
      </ComboboxPrimitive.Positioner>
    </ComboboxPrimitive.Portal>
  )
}

function ComboboxList({ className, ...props }: ComboboxPrimitive.List.Props) {
  return (
    <ComboboxPrimitive.List
      data-slot="combobox-list"
      className={cn(
        "scn:no-scrollbar scn:max-h-[min(calc(--spacing(72)---spacing(9)),calc(var(--available-height)---spacing(9)))] scn:scroll-py-1 scn:overflow-y-auto scn:overscroll-contain scn:p-1 scn:data-empty:p-0",
        className
      )}
      {...props}
    />
  )
}

function ComboboxItem({
  className,
  children,
  ...props
}: ComboboxPrimitive.Item.Props) {
  return (
    <ComboboxPrimitive.Item
      data-slot="combobox-item"
      className={cn(
        "scn:relative scn:flex scn:min-h-7 scn:w-full scn:cursor-default scn:items-center scn:gap-2 scn:rounded-md scn:px-2 scn:py-1 scn:text-xs/relaxed scn:outline-hidden scn:select-none scn:data-highlighted:bg-accent scn:data-highlighted:text-accent-foreground scn:not-data-[variant=destructive]:data-highlighted:**:text-accent-foreground scn:data-disabled:pointer-events-none scn:data-disabled:opacity-50 scn:[&_svg]:pointer-events-none scn:[&_svg]:shrink-0 scn:[&_svg:not([class*='size-'])]:size-3.5",
        className
      )}
      {...props}
    >
      {children}
      <ComboboxPrimitive.ItemIndicator
        render={
          <span className="scn:pointer-events-none scn:absolute scn:right-2 scn:flex scn:items-center scn:justify-center" />
        }
      >
        <CheckIcon className="scn:pointer-events-none"/>
      </ComboboxPrimitive.ItemIndicator>
    </ComboboxPrimitive.Item>
  )
}

function ComboboxGroup({ className, ...props }: ComboboxPrimitive.Group.Props) {
  return (
    <ComboboxPrimitive.Group
      data-slot="combobox-group"
      className={cn(className)}
      {...props}
    />
  )
}

function ComboboxLabel({
  className,
  ...props
}: ComboboxPrimitive.GroupLabel.Props) {
  return (
    <ComboboxPrimitive.GroupLabel
      data-slot="combobox-label"
      className={cn("scn:px-2 scn:py-1.5 scn:text-xs scn:text-muted-foreground", className)}
      {...props}
    />
  )
}

function ComboboxCollection({ ...props }: ComboboxPrimitive.Collection.Props) {
  return (
    <ComboboxPrimitive.Collection data-slot="combobox-collection" {...props} />
  )
}

function ComboboxEmpty({ className, ...props }: ComboboxPrimitive.Empty.Props) {
  return (
    <ComboboxPrimitive.Empty
      data-slot="combobox-empty"
      className={cn(
        "scn:hidden scn:w-full scn:justify-center scn:py-2 scn:text-center scn:text-xs/relaxed scn:text-muted-foreground scn:group-data-empty/combobox-content:flex",
        className
      )}
      {...props}
    />
  )
}

function ComboboxSeparator({
  className,
  ...props
}: ComboboxPrimitive.Separator.Props) {
  return (
    <ComboboxPrimitive.Separator
      data-slot="combobox-separator"
      className={cn("scn:-mx-1 scn:my-1 scn:h-px scn:bg-border/50", className)}
      {...props}
    />
  )
}

function ComboboxChips({
  className,
  ...props
}: React.ComponentPropsWithRef<typeof ComboboxPrimitive.Chips> &
  ComboboxPrimitive.Chips.Props) {
  return (
    <ComboboxPrimitive.Chips
      data-slot="combobox-chips"
      className={cn(
        "scn:flex scn:min-h-7 scn:flex-wrap scn:items-center scn:gap-1 scn:rounded-md scn:border scn:border-input scn:bg-input/20 scn:bg-clip-padding scn:px-2 scn:py-0.5 scn:text-xs/relaxed scn:transition-colors scn:focus-within:border-ring scn:focus-within:ring-2 scn:focus-within:ring-ring/30 scn:has-aria-invalid:border-destructive scn:has-aria-invalid:ring-2 scn:has-aria-invalid:ring-destructive/20 scn:has-data-[slot=combobox-chip]:px-1 scn:dark:bg-input/30 scn:dark:has-aria-invalid:border-destructive/50 scn:dark:has-aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

function ComboboxChip({
  className,
  children,
  showRemove = true,
  ...props
}: ComboboxPrimitive.Chip.Props & {
  showRemove?: boolean
}) {
  return (
    <ComboboxPrimitive.Chip
      data-slot="combobox-chip"
      className={cn(
        "scn:flex scn:h-[calc(--spacing(4.75))] scn:w-fit scn:items-center scn:justify-center scn:gap-1 scn:rounded-[calc(var(--radius-sm)-2px)] scn:bg-muted-foreground/10 scn:px-1.5 scn:text-xs/relaxed scn:font-medium scn:whitespace-nowrap scn:text-foreground scn:has-disabled:pointer-events-none scn:has-disabled:cursor-not-allowed scn:has-disabled:opacity-50 scn:has-data-[slot=combobox-chip-remove]:pr-0",
        className
      )}
      {...props}
    >
      {children}
      {showRemove && (
        <ComboboxPrimitive.ChipRemove
          render={<Button variant="ghost" size="icon-xs" />}
          className="scn:-ml-1 scn:opacity-50 scn:hover:opacity-100"
          data-slot="combobox-chip-remove"
        >
          <XIcon className="scn:pointer-events-none"/>
        </ComboboxPrimitive.ChipRemove>
      )}
    </ComboboxPrimitive.Chip>
  )
}

function ComboboxChipsInput({
  className,
  ...props
}: ComboboxPrimitive.Input.Props) {
  return (
    <ComboboxPrimitive.Input
      data-slot="combobox-chip-input"
      className={cn("scn:min-w-16 scn:flex-1 scn:outline-none", className)}
      {...props}
    />
  )
}

function useComboboxAnchor() {
  return React.useRef<HTMLDivElement | null>(null)
}

export {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxGroup,
  ComboboxLabel,
  ComboboxCollection,
  ComboboxEmpty,
  ComboboxSeparator,
  ComboboxChips,
  ComboboxChip,
  ComboboxChipsInput,
  ComboboxTrigger,
  ComboboxValue,
  useComboboxAnchor,
}
