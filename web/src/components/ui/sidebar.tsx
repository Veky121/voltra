"use client"

import * as React from "react"
import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

import { useIsMobile } from "@/hooks/use-mobile"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { PanelLeftIcon } from "lucide-react"

const SIDEBAR_WIDTH = "16rem"
const SIDEBAR_WIDTH_MOBILE = "18rem"
const SIDEBAR_WIDTH_ICON = "3rem"
const SIDEBAR_KEYBOARD_SHORTCUT = "b"

type SidebarContextProps = {
  state: "expanded" | "collapsed"
  open: boolean
  setOpen: (open: boolean) => void
  openMobile: boolean
  setOpenMobile: (open: boolean) => void
  isMobile: boolean
  toggleSidebar: () => void
}

const SidebarContext = React.createContext<SidebarContextProps | null>(null)

function useSidebar() {
  const context = React.useContext(SidebarContext)
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider.")
  }

  return context
}

function SidebarProvider({
  defaultOpen = true,
  open: openProp,
  onOpenChange: setOpenProp,
  className,
  style,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const isMobile = useIsMobile()
  const [openMobile, setOpenMobile] = React.useState(false)

  // This is the internal state of the sidebar.
  // We use openProp and setOpenProp for control from outside the component.
  const [_open, _setOpen] = React.useState(defaultOpen)
  const open = openProp ?? _open
  const setOpen = React.useCallback(
    (value: boolean | ((value: boolean) => boolean)) => {
      const openState = typeof value === "function" ? value(open) : value
      if (setOpenProp) {
        setOpenProp(openState)
      } else {
        _setOpen(openState)
      }

      // Voltra persists the controlled state in its account-scoped preferences.
    },
    [setOpenProp, open]
  )

  // Helper to toggle the sidebar.
  const toggleSidebar = React.useCallback(() => {
    return isMobile ? setOpenMobile((open) => !open) : setOpen((open) => !open)
  }, [isMobile, setOpen, setOpenMobile])

  // Adds a keyboard shortcut to toggle the sidebar.
  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === SIDEBAR_KEYBOARD_SHORTCUT &&
        (event.metaKey || event.ctrlKey)
      ) {
        event.preventDefault()
        toggleSidebar()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [toggleSidebar])

  // We add a state so that we can do data-state="expanded" or "collapsed".
  // This makes it easier to style the sidebar with Tailwind classes.
  const state = open ? "expanded" : "collapsed"

  const contextValue = React.useMemo<SidebarContextProps>(
    () => ({
      state,
      open,
      setOpen,
      isMobile,
      openMobile,
      setOpenMobile,
      toggleSidebar,
    }),
    [state, open, setOpen, isMobile, openMobile, setOpenMobile, toggleSidebar]
  )

  return (
    <SidebarContext.Provider value={contextValue}>
      <div
        data-slot="sidebar-wrapper"
        style={
          {
            "--sidebar-width": SIDEBAR_WIDTH,
            "--sidebar-width-icon": SIDEBAR_WIDTH_ICON,
            ...style,
          } as React.CSSProperties
        }
        className={cn(
          "scn:group/sidebar-wrapper scn:flex scn:min-h-svh scn:w-full scn:has-data-[variant=inset]:bg-sidebar",
          className
        )}
        {...props}
      >
        {children}
      </div>
    </SidebarContext.Provider>
  )
}

function Sidebar({
  side = "left",
  variant = "sidebar",
  collapsible = "offcanvas",
  className,
  children,
  dir,
  ...props
}: React.ComponentProps<"div"> & {
  side?: "left" | "right"
  variant?: "sidebar" | "floating" | "inset"
  collapsible?: "offcanvas" | "icon" | "none"
}) {
  const { isMobile, state, openMobile, setOpenMobile } = useSidebar()

  if (collapsible === "none") {
    return (
      <div
        data-slot="sidebar"
        className={cn(
          "scn:flex scn:h-full scn:w-(--sidebar-width) scn:flex-col scn:bg-sidebar scn:text-sidebar-foreground",
          className
        )}
        {...props}
      >
        {children}
      </div>
    )
  }

  if (isMobile) {
    return (
      <Sheet open={openMobile} onOpenChange={setOpenMobile} {...props}>
        <SheetContent
          showCloseButton={false}
          dir={dir}
          data-sidebar="sidebar"
          data-slot="sidebar"
          data-mobile="true"
          className={cn("scn:w-(--sidebar-width) scn:bg-sidebar scn:p-0 scn:text-sidebar-foreground scn:[&>button]:hidden", className)}
          style={
            {
              "--sidebar-width": SIDEBAR_WIDTH_MOBILE,
            } as React.CSSProperties
          }
          side={side}
        >
          <SheetHeader className="scn:sr-only">
            <SheetTitle>Sidebar</SheetTitle>
            <SheetDescription>Displays the mobile sidebar.</SheetDescription>
          </SheetHeader>
          <div className="scn:flex scn:h-full scn:w-full scn:flex-col">{children}</div>
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <div
      className="scn:group scn:peer scn:hidden scn:text-sidebar-foreground scn:md:block"
      data-state={state}
      data-collapsible={state === "collapsed" ? collapsible : ""}
      data-variant={variant}
      data-side={side}
      data-slot="sidebar"
    >
      {/* This is what handles the sidebar gap on desktop */}
      <div
        data-slot="sidebar-gap"
        className={cn(
          "scn:relative scn:w-(--sidebar-width) scn:bg-transparent scn:transition-[width] scn:duration-200 scn:ease-linear",
          "scn:group-data-[collapsible=offcanvas]:w-0",
          "scn:group-data-[side=right]:rotate-180",
          variant === "floating" || variant === "inset"
            ? "scn:group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)+(--spacing(4)))]"
            : "scn:group-data-[collapsible=icon]:w-(--sidebar-width-icon)"
        )}
      />
      <div
        data-slot="sidebar-container"
        data-side={side}
        className={cn(
          "scn:fixed scn:inset-y-0 scn:z-10 scn:hidden scn:h-svh scn:w-(--sidebar-width) scn:transition-[left,right,width] scn:duration-200 scn:ease-linear scn:data-[side=left]:left-0 scn:data-[side=left]:group-data-[collapsible=offcanvas]:left-[calc(var(--sidebar-width)*-1)] scn:data-[side=right]:right-0 scn:data-[side=right]:group-data-[collapsible=offcanvas]:right-[calc(var(--sidebar-width)*-1)] scn:md:flex",
          // Adjust the padding for floating and inset variants.
          variant === "floating" || variant === "inset"
            ? "scn:p-2 scn:group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)+(--spacing(4))+2px)]"
            : "scn:group-data-[collapsible=icon]:w-(--sidebar-width-icon) scn:group-data-[side=left]:border-r scn:group-data-[side=right]:border-l",
          className
        )}
        {...props}
      >
        <div
          data-sidebar="sidebar"
          data-slot="sidebar-inner"
          className="scn:flex scn:size-full scn:flex-col scn:bg-sidebar scn:group-data-[variant=floating]:rounded-lg scn:group-data-[variant=floating]:shadow-sm scn:group-data-[variant=floating]:ring-1 scn:group-data-[variant=floating]:ring-sidebar-border"
        >
          {children}
        </div>
      </div>
    </div>
  )
}

function SidebarTrigger({
  className,
  onClick,
  ...props
}: React.ComponentProps<typeof Button>) {
  const { toggleSidebar } = useSidebar()

  return (
    <Button
      data-sidebar="trigger"
      data-slot="sidebar-trigger"
      variant="ghost"
      size="icon-sm"
      className={cn(className)}
      onClick={(event) => {
        onClick?.(event)
        toggleSidebar()
      }}
      {...props}
    >
      <PanelLeftIcon />
      <span className="scn:sr-only">Toggle Sidebar</span>
    </Button>
  )
}

function SidebarRail({ className, ...props }: React.ComponentProps<"button">) {
  const { toggleSidebar } = useSidebar()

  return (
    <button
      data-sidebar="rail"
      data-slot="sidebar-rail"
      aria-label="Toggle Sidebar"
      tabIndex={-1}
      onClick={toggleSidebar}
      title="Toggle Sidebar"
      className={cn(
        "scn:absolute scn:inset-y-0 scn:z-20 scn:hidden scn:w-4 scn:transition-all scn:ease-linear scn:group-data-[side=left]:-right-4 scn:group-data-[side=right]:left-0 scn:after:absolute scn:after:inset-y-0 scn:after:start-1/2 scn:after:w-[2px] scn:hover:after:bg-sidebar-border scn:sm:flex scn:ltr:-translate-x-1/2 scn:rtl:-translate-x-1/2",
        "scn:in-data-[side=left]:cursor-w-resize scn:in-data-[side=right]:cursor-e-resize",
        "scn:[[data-side=left][data-state=collapsed]_&]:cursor-e-resize scn:[[data-side=right][data-state=collapsed]_&]:cursor-w-resize",
        "scn:group-data-[collapsible=offcanvas]:translate-x-0 scn:group-data-[collapsible=offcanvas]:after:left-full scn:hover:group-data-[collapsible=offcanvas]:bg-sidebar",
        "scn:[[data-side=left][data-collapsible=offcanvas]_&]:-right-2",
        "scn:[[data-side=right][data-collapsible=offcanvas]_&]:-left-2",
        className
      )}
      {...props}
    />
  )
}

function SidebarInset({ className, ...props }: React.ComponentProps<"main">) {
  return (
    <main
      data-slot="sidebar-inset"
      className={cn(
        "scn:relative scn:flex scn:w-full scn:flex-1 scn:flex-col scn:bg-background scn:md:peer-data-[variant=inset]:m-2 scn:md:peer-data-[variant=inset]:ml-0 scn:md:peer-data-[variant=inset]:rounded-xl scn:md:peer-data-[variant=inset]:shadow-sm scn:md:peer-data-[variant=inset]:peer-data-[state=collapsed]:ml-2",
        className
      )}
      {...props}
    />
  )
}

function SidebarInput({
  className,
  ...props
}: React.ComponentProps<typeof Input>) {
  return (
    <Input
      data-slot="sidebar-input"
      data-sidebar="input"
      className={cn(
        "scn:h-8 scn:w-full scn:border-input scn:bg-muted/20 scn:dark:bg-muted/30",
        className
      )}
      {...props}
    />
  )
}

function SidebarHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-header"
      data-sidebar="header"
      className={cn("scn:flex scn:flex-col scn:gap-2 scn:p-2", className)}
      {...props}
    />
  )
}

function SidebarFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-footer"
      data-sidebar="footer"
      className={cn("scn:flex scn:flex-col scn:gap-2 scn:p-2", className)}
      {...props}
    />
  )
}

function SidebarSeparator({
  className,
  ...props
}: React.ComponentProps<typeof Separator>) {
  return (
    <Separator
      data-slot="sidebar-separator"
      data-sidebar="separator"
      className={cn("scn:mx-2 scn:w-auto scn:bg-sidebar-border", className)}
      {...props}
    />
  )
}

function SidebarContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-content"
      data-sidebar="content"
      className={cn(
        "scn:no-scrollbar scn:flex scn:min-h-0 scn:flex-1 scn:flex-col scn:gap-0 scn:overflow-auto scn:group-data-[collapsible=icon]:overflow-hidden",
        className
      )}
      {...props}
    />
  )
}

function SidebarGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-group"
      data-sidebar="group"
      className={cn(
        "scn:relative scn:flex scn:w-full scn:min-w-0 scn:flex-col scn:px-2 scn:py-1",
        className
      )}
      {...props}
    />
  )
}

function SidebarGroupLabel({
  className,
  render,
  ...props
}: useRender.ComponentProps<"div"> & React.ComponentProps<"div">) {
  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(
      {
        className: cn(
          "scn:flex scn:h-8 scn:shrink-0 scn:items-center scn:rounded-md scn:px-2 scn:text-xs scn:text-sidebar-foreground/70 scn:ring-sidebar-ring scn:outline-hidden scn:transition-[margin,opacity] scn:duration-200 scn:ease-linear scn:group-data-[collapsible=icon]:-mt-8 scn:group-data-[collapsible=icon]:opacity-0 scn:focus-visible:ring-2 scn:[&>svg]:size-4 scn:[&>svg]:shrink-0",
          className
        ),
      },
      props
    ),
    render,
    state: {
      slot: "sidebar-group-label",
      sidebar: "group-label",
    },
  })
}

function SidebarGroupAction({
  className,
  render,
  ...props
}: useRender.ComponentProps<"button"> & React.ComponentProps<"button">) {
  return useRender({
    defaultTagName: "button",
    props: mergeProps<"button">(
      {
        className: cn(
          "scn:absolute scn:top-3.5 scn:right-3 scn:flex scn:aspect-square scn:w-5 scn:items-center scn:justify-center scn:rounded-md scn:p-0 scn:text-sidebar-foreground scn:ring-sidebar-ring scn:outline-hidden scn:transition-transform scn:group-data-[collapsible=icon]:hidden scn:after:absolute scn:after:-inset-2 scn:hover:bg-sidebar-accent scn:hover:text-sidebar-accent-foreground scn:focus-visible:ring-2 scn:md:after:hidden scn:[&>svg]:size-4 scn:[&>svg]:shrink-0",
          className
        ),
      },
      props
    ),
    render,
    state: {
      slot: "sidebar-group-action",
      sidebar: "group-action",
    },
  })
}

function SidebarGroupContent({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-group-content"
      data-sidebar="group-content"
      className={cn("scn:w-full scn:text-xs", className)}
      {...props}
    />
  )
}

function SidebarMenu({ className, ...props }: React.ComponentProps<"ul">) {
  return (
    <ul
      data-slot="sidebar-menu"
      data-sidebar="menu"
      className={cn("scn:flex scn:w-full scn:min-w-0 scn:flex-col scn:gap-px", className)}
      {...props}
    />
  )
}

function SidebarMenuItem({ className, ...props }: React.ComponentProps<"li">) {
  return (
    <li
      data-slot="sidebar-menu-item"
      data-sidebar="menu-item"
      className={cn("scn:group/menu-item scn:relative", className)}
      {...props}
    />
  )
}

const sidebarMenuButtonVariants = cva(
  "scn:peer/menu-button scn:group/menu-button scn:flex scn:w-full scn:items-center scn:gap-2 scn:overflow-hidden scn:rounded-[calc(var(--radius-sm)+2px)] scn:p-2 scn:text-left scn:text-xs scn:ring-sidebar-ring scn:outline-hidden scn:transition-[width,height,padding] scn:group-has-data-[sidebar=menu-action]/menu-item:pr-8 scn:group-data-[collapsible=icon]:size-8! scn:group-data-[collapsible=icon]:p-2! scn:hover:bg-sidebar-accent scn:hover:text-sidebar-accent-foreground scn:focus-visible:ring-2 scn:active:bg-sidebar-accent scn:active:text-sidebar-accent-foreground scn:disabled:pointer-events-none scn:disabled:opacity-50 scn:aria-disabled:pointer-events-none scn:aria-disabled:opacity-50 scn:data-open:hover:bg-sidebar-accent scn:data-open:hover:text-sidebar-accent-foreground scn:data-active:bg-sidebar-accent scn:data-active:font-medium scn:data-active:text-sidebar-accent-foreground scn:[&_svg]:size-4 scn:[&_svg]:shrink-0 scn:[&>span:last-child]:truncate",
  {
    variants: {
      variant: {
        default: "scn:hover:bg-sidebar-accent scn:hover:text-sidebar-accent-foreground",
        outline:
          "scn:bg-background scn:shadow-[0_0_0_1px_var(--sidebar-border)] scn:hover:bg-sidebar-accent scn:hover:text-sidebar-accent-foreground scn:hover:shadow-[0_0_0_1px_var(--sidebar-accent)]",
      },
      size: {
        default: "scn:h-8 scn:text-xs",
        sm: "scn:h-7 scn:text-xs",
        lg: "scn:h-12 scn:text-xs scn:group-data-[collapsible=icon]:p-0!",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function SidebarMenuButton({
  render,
  isActive = false,
  variant = "default",
  size = "default",
  tooltip,
  className,
  ...props
}: useRender.ComponentProps<"button"> &
  React.ComponentProps<"button"> & {
    isActive?: boolean
    tooltip?: string | React.ComponentProps<typeof TooltipContent>
  } & VariantProps<typeof sidebarMenuButtonVariants>) {
  const { isMobile, state } = useSidebar()
  const comp = useRender({
    defaultTagName: "button",
    props: mergeProps<"button">(
      {
        className: cn(sidebarMenuButtonVariants({ variant, size }), className),
      },
      props
    ),
    render: !tooltip ? render : <TooltipTrigger render={render} />,
    state: {
      slot: "sidebar-menu-button",
      sidebar: "menu-button",
      size,
      active: isActive,
    },
  })

  if (!tooltip) {
    return comp
  }

  if (typeof tooltip === "string") {
    tooltip = {
      children: tooltip,
    }
  }

  return (
    <Tooltip disabled={state !== "collapsed" || isMobile}>
      {comp}
      <TooltipContent
        side="right"
        align="center"
        hidden={state !== "collapsed" || isMobile}
        {...tooltip}
      />
    </Tooltip>
  )
}

function SidebarMenuAction({
  className,
  render,
  showOnHover = false,
  ...props
}: useRender.ComponentProps<"button"> &
  React.ComponentProps<"button"> & {
    showOnHover?: boolean
  }) {
  return useRender({
    defaultTagName: "button",
    props: mergeProps<"button">(
      {
        className: cn(
          "scn:absolute scn:top-1.5 scn:right-1 scn:flex scn:aspect-square scn:w-5 scn:items-center scn:justify-center scn:rounded-[calc(var(--radius-sm)-2px)] scn:p-0 scn:text-sidebar-foreground scn:ring-sidebar-ring scn:outline-hidden scn:transition-transform scn:group-data-[collapsible=icon]:hidden scn:peer-hover/menu-button:text-sidebar-accent-foreground scn:peer-data-[size=default]/menu-button:top-1.5 scn:peer-data-[size=lg]/menu-button:top-2.5 scn:peer-data-[size=sm]/menu-button:top-1 scn:after:absolute scn:after:-inset-2 scn:hover:bg-sidebar-accent scn:hover:text-sidebar-accent-foreground scn:focus-visible:ring-2 scn:md:after:hidden scn:[&>svg]:size-4 scn:[&>svg]:shrink-0",
          showOnHover &&
            "scn:group-focus-within/menu-item:opacity-100 scn:group-hover/menu-item:opacity-100 scn:peer-data-active/menu-button:text-sidebar-accent-foreground scn:aria-expanded:opacity-100 scn:md:opacity-0",
          className
        ),
      },
      props
    ),
    render,
    state: {
      slot: "sidebar-menu-action",
      sidebar: "menu-action",
    },
  })
}

function SidebarMenuBadge({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-menu-badge"
      data-sidebar="menu-badge"
      className={cn(
        "scn:pointer-events-none scn:absolute scn:right-1 scn:flex scn:h-5 scn:min-w-5 scn:items-center scn:justify-center scn:rounded-[calc(var(--radius-sm)-2px)] scn:px-1 scn:text-xs scn:font-medium scn:text-sidebar-foreground scn:tabular-nums scn:select-none scn:group-data-[collapsible=icon]:hidden scn:peer-hover/menu-button:text-sidebar-accent-foreground scn:peer-data-[size=default]/menu-button:top-1.5 scn:peer-data-[size=lg]/menu-button:top-2.5 scn:peer-data-[size=sm]/menu-button:top-1 scn:peer-data-active/menu-button:text-sidebar-accent-foreground",
        className
      )}
      {...props}
    />
  )
}

function SidebarMenuSkeleton({
  className,
  showIcon = false,
  ...props
}: React.ComponentProps<"div"> & {
  showIcon?: boolean
}) {
  // Random width between 50 to 90%.
  const [width] = React.useState(() => {
    return `${Math.floor(Math.random() * 40) + 50}%`
  })

  return (
    <div
      data-slot="sidebar-menu-skeleton"
      data-sidebar="menu-skeleton"
      className={cn("scn:flex scn:h-8 scn:items-center scn:gap-2 scn:rounded-md scn:px-2", className)}
      {...props}
    >
      {showIcon && (
        <Skeleton
          className="scn:size-4 scn:rounded-md"
          data-sidebar="menu-skeleton-icon"
        />
      )}
      <Skeleton
        className="scn:h-4 scn:max-w-(--skeleton-width) scn:flex-1"
        data-sidebar="menu-skeleton-text"
        style={
          {
            "--skeleton-width": width,
          } as React.CSSProperties
        }
      />
    </div>
  )
}

function SidebarMenuSub({ className, ...props }: React.ComponentProps<"ul">) {
  return (
    <ul
      data-slot="sidebar-menu-sub"
      data-sidebar="menu-sub"
      className={cn(
        "scn:mx-3.5 scn:flex scn:min-w-0 scn:translate-x-px scn:flex-col scn:gap-1 scn:border-l scn:border-sidebar-border scn:px-2.5 scn:py-0.5 scn:group-data-[collapsible=icon]:hidden",
        className
      )}
      {...props}
    />
  )
}

function SidebarMenuSubItem({
  className,
  ...props
}: React.ComponentProps<"li">) {
  return (
    <li
      data-slot="sidebar-menu-sub-item"
      data-sidebar="menu-sub-item"
      className={cn("scn:group/menu-sub-item scn:relative", className)}
      {...props}
    />
  )
}

function SidebarMenuSubButton({
  render,
  size = "md",
  isActive = false,
  className,
  ...props
}: useRender.ComponentProps<"a"> &
  React.ComponentProps<"a"> & {
    size?: "sm" | "md"
    isActive?: boolean
  }) {
  return useRender({
    defaultTagName: "a",
    props: mergeProps<"a">(
      {
        className: cn(
          "scn:flex scn:h-7 scn:min-w-0 scn:-translate-x-px scn:items-center scn:gap-2 scn:overflow-hidden scn:rounded-md scn:px-2 scn:text-sidebar-foreground scn:ring-sidebar-ring scn:outline-hidden scn:group-data-[collapsible=icon]:hidden scn:hover:bg-sidebar-accent scn:hover:text-sidebar-accent-foreground scn:focus-visible:ring-2 scn:active:bg-sidebar-accent scn:active:text-sidebar-accent-foreground scn:disabled:pointer-events-none scn:disabled:opacity-50 scn:aria-disabled:pointer-events-none scn:aria-disabled:opacity-50 scn:data-[size=md]:text-xs scn:data-[size=sm]:text-xs scn:data-active:bg-sidebar-accent scn:data-active:text-sidebar-accent-foreground scn:[&>span:last-child]:truncate scn:[&>svg]:size-4 scn:[&>svg]:shrink-0 scn:[&>svg]:text-sidebar-accent-foreground",
          className
        ),
      },
      props
    ),
    render,
    state: {
      slot: "sidebar-menu-sub-button",
      sidebar: "menu-sub-button",
      size,
      active: isActive,
    },
  })
}

export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
}
