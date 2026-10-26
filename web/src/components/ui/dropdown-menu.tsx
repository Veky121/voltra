import * as React from "react"
import { Menu as MenuPrimitive } from "@base-ui/react/menu"
import { cn } from "@/lib/utils"
import { ChevronRightIcon, CheckIcon } from "lucide-react"
import {useOverlayPortalContainer} from '../../ui/OverlayPortal'

function DropdownMenu({ modal, ...props }: MenuPrimitive.Root.Props) {
  const container=useOverlayPortalContainer()
  return <MenuPrimitive.Root data-slot="dropdown-menu" modal={modal??!container} {...props} />
}

function DropdownMenuPortal({ ...props }: MenuPrimitive.Portal.Props) {
  const container=useOverlayPortalContainer()
  return <MenuPrimitive.Portal data-slot="dropdown-menu-portal" container={container} {...props} />
}

function DropdownMenuTrigger({ ...props }: MenuPrimitive.Trigger.Props) {
  return <MenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />
}

function DropdownMenuContent({
  align = "start",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 4,
  anchor,
  className,
  ...props
}: MenuPrimitive.Popup.Props &
  Pick<
    MenuPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset" | "anchor"
  >) {
  return (
    <DropdownMenuPortal>
      <MenuPrimitive.Positioner
        collisionBoundary={[]}
        data-slot="dropdown-menu-positioner"
        className="scn:isolate scn:z-[260] scn:outline-none"
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        anchor={anchor}
      >
        <MenuPrimitive.Popup
          data-slot="dropdown-menu-content"
          className={cn("scn:z-50 scn:max-h-(--available-height) scn:w-(--anchor-width) scn:min-w-32 scn:origin-(--transform-origin) scn:overflow-x-hidden scn:overflow-y-auto scn:rounded-lg scn:bg-popover scn:p-1 scn:text-popover-foreground scn:shadow-md scn:ring-1 scn:ring-foreground/10 scn:duration-100 scn:outline-none scn:data-[side=bottom]:slide-in-from-top-2 scn:data-[side=inline-end]:slide-in-from-left-2 scn:data-[side=inline-start]:slide-in-from-right-2 scn:data-[side=left]:slide-in-from-right-2 scn:data-[side=right]:slide-in-from-left-2 scn:data-[side=top]:slide-in-from-bottom-2 scn:data-open:animate-in scn:data-open:fade-in-0 scn:data-open:zoom-in-95 scn:data-closed:animate-out scn:data-closed:overflow-hidden scn:data-closed:fade-out-0 scn:data-closed:zoom-out-95", className )}
          {...props}
        />
      </MenuPrimitive.Positioner>
    </DropdownMenuPortal>
  )
}

function DropdownMenuGroup({ ...props }: MenuPrimitive.Group.Props) {
  return <MenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />
}

function DropdownMenuLabel({
  className,
  inset,
  ...props
}: MenuPrimitive.GroupLabel.Props & {
  inset?: boolean
}) {
  return (
    <MenuPrimitive.GroupLabel
      data-slot="dropdown-menu-label"
      data-inset={inset}
      className={cn(
        "scn:px-2 scn:py-1.5 scn:text-xs scn:text-muted-foreground scn:data-inset:pl-7.5",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuItem({
  className,
  inset,
  variant = "default",
  ...props
}: MenuPrimitive.Item.Props & {
  inset?: boolean
  variant?: "default" | "destructive"
}) {
  return (
    <MenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        "scn:group/dropdown-menu-item scn:relative scn:flex scn:min-h-7 scn:cursor-default scn:items-center scn:gap-2 scn:rounded-md scn:px-2 scn:py-1 scn:text-xs/relaxed scn:outline-hidden scn:select-none scn:focus:bg-accent scn:focus:text-accent-foreground scn:not-data-[variant=destructive]:focus:**:text-accent-foreground scn:data-inset:pl-7.5 scn:data-[variant=destructive]:text-destructive scn:data-[variant=destructive]:focus:bg-destructive/10 scn:data-[variant=destructive]:focus:text-destructive scn:dark:data-[variant=destructive]:focus:bg-destructive/20 scn:data-disabled:pointer-events-none scn:data-disabled:opacity-50 scn:[&_svg]:pointer-events-none scn:[&_svg]:shrink-0 scn:[&_svg:not([class*=size-])]:size-3.5 scn:data-[variant=destructive]:*:[svg]:text-destructive",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuSub({ ...props }: MenuPrimitive.SubmenuRoot.Props) {
  return <MenuPrimitive.SubmenuRoot data-slot="dropdown-menu-sub" {...props} />
}

function DropdownMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: MenuPrimitive.SubmenuTrigger.Props & {
  inset?: boolean
}) {
  return (
    <MenuPrimitive.SubmenuTrigger
      data-slot="dropdown-menu-sub-trigger"
      data-inset={inset}
      className={cn(
        "scn:flex scn:min-h-7 scn:cursor-default scn:items-center scn:gap-2 scn:rounded-md scn:px-2 scn:py-1 scn:text-xs scn:outline-hidden scn:select-none scn:focus:bg-accent scn:focus:text-accent-foreground scn:not-data-[variant=destructive]:focus:**:text-accent-foreground scn:data-inset:pl-7.5 scn:data-popup-open:bg-accent scn:data-popup-open:text-accent-foreground scn:data-open:bg-accent scn:data-open:text-accent-foreground scn:[&_svg]:pointer-events-none scn:[&_svg]:shrink-0 scn:[&_svg:not([class*=size-])]:size-3.5",
        className
      )}
      {...props}
    >
      {children}
      <ChevronRightIcon className="scn:ml-auto" />
    </MenuPrimitive.SubmenuTrigger>
  )
}

function DropdownMenuSubContent({
  align = "start",
  alignOffset = -3,
  side = "right",
  sideOffset = 0,
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuContent>) {
  return (
    <DropdownMenuContent
      data-slot="dropdown-menu-sub-content"
      className={cn("scn:w-auto scn:min-w-32 scn:rounded-lg scn:bg-popover scn:p-1 scn:text-popover-foreground scn:shadow-md scn:ring-1 scn:ring-foreground/10 scn:duration-100 scn:data-[side=bottom]:slide-in-from-top-2 scn:data-[side=left]:slide-in-from-right-2 scn:data-[side=right]:slide-in-from-left-2 scn:data-[side=top]:slide-in-from-bottom-2 scn:data-open:animate-in scn:data-open:fade-in-0 scn:data-open:zoom-in-95 scn:data-closed:animate-out scn:data-closed:fade-out-0 scn:data-closed:zoom-out-95", className )}
      align={align}
      alignOffset={alignOffset}
      side={side}
      sideOffset={sideOffset}
      {...props}
    />
  )
}

function DropdownMenuCheckboxItem({
  className,
  children,
  checked,
  inset,
  ...props
}: MenuPrimitive.CheckboxItem.Props & {
  inset?: boolean
}) {
  return (
    <MenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      data-inset={inset}
      className={cn(
        "scn:relative scn:flex scn:min-h-7 scn:cursor-default scn:items-center scn:gap-2 scn:rounded-md scn:py-1.5 scn:pr-8 scn:pl-2 scn:text-xs scn:outline-hidden scn:select-none scn:focus:bg-accent scn:focus:text-accent-foreground scn:focus:**:text-accent-foreground scn:data-inset:pl-7.5 scn:data-disabled:pointer-events-none scn:data-disabled:opacity-50 scn:[&_svg]:pointer-events-none scn:[&_svg]:shrink-0 scn:[&_svg:not([class*=size-])]:size-3.5",
        className
      )}
      checked={checked}
      {...props}
    >
      <span
        className="scn:pointer-events-none scn:absolute scn:right-2 scn:flex scn:items-center scn:justify-center"
        data-slot="dropdown-menu-checkbox-item-indicator"
      >
        <MenuPrimitive.CheckboxItemIndicator>
          <CheckIcon
          />
        </MenuPrimitive.CheckboxItemIndicator>
      </span>
      {children}
    </MenuPrimitive.CheckboxItem>
  )
}

function DropdownMenuRadioGroup({ ...props }: MenuPrimitive.RadioGroup.Props) {
  return (
    <MenuPrimitive.RadioGroup
      data-slot="dropdown-menu-radio-group"
      {...props}
    />
  )
}

function DropdownMenuRadioItem({
  className,
  children,
  inset,
  ...props
}: MenuPrimitive.RadioItem.Props & {
  inset?: boolean
}) {
  return (
    <MenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      data-inset={inset}
      className={cn(
        "scn:relative scn:flex scn:min-h-7 scn:cursor-default scn:items-center scn:gap-2 scn:rounded-md scn:py-1.5 scn:pr-8 scn:pl-2 scn:text-xs scn:outline-hidden scn:select-none scn:focus:bg-accent scn:focus:text-accent-foreground scn:focus:**:text-accent-foreground scn:data-inset:pl-7.5 scn:data-disabled:pointer-events-none scn:data-disabled:opacity-50 scn:[&_svg]:pointer-events-none scn:[&_svg]:shrink-0 scn:[&_svg:not([class*=size-])]:size-3.5",
        className
      )}
      {...props}
    >
      <span
        className="scn:pointer-events-none scn:absolute scn:right-2 scn:flex scn:items-center scn:justify-center"
        data-slot="dropdown-menu-radio-item-indicator"
      >
        <MenuPrimitive.RadioItemIndicator>
          <CheckIcon
          />
        </MenuPrimitive.RadioItemIndicator>
      </span>
      {children}
    </MenuPrimitive.RadioItem>
  )
}

function DropdownMenuSeparator({
  className,
  ...props
}: MenuPrimitive.Separator.Props) {
  return (
    <MenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn("scn:-mx-1 scn:my-1 scn:h-px scn:bg-border/50", className)}
      {...props}
    />
  )
}

function DropdownMenuShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      className={cn(
        "scn:ml-auto scn:text-[0.625rem] scn:tracking-widest scn:text-muted-foreground scn:group-focus/dropdown-menu-item:text-accent-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  DropdownMenu,
  DropdownMenuPortal,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
}
