"use client"

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn(
        "scn:group/tabs scn:flex scn:gap-2 scn:data-[orientation=horizontal]:flex-col",
        className
      )}
      {...props}
    />
  )
}

const tabsListVariants = cva(
  "scn:group/tabs-list scn:inline-flex scn:w-fit scn:items-center scn:justify-center scn:rounded-lg scn:p-[3px] scn:text-muted-foreground scn:group-data-[orientation=horizontal]/tabs:h-8 scn:group-data-[orientation=vertical]/tabs:h-fit scn:group-data-[orientation=vertical]/tabs:flex-col scn:data-[variant=line]:rounded-none",
  {
    variants: {
      variant: {
        default: "scn:bg-muted",
        line: "scn:gap-1 scn:bg-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function TabsList({
  className,
  variant = "default",
  ...props
}: TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  )
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        "scn:relative scn:inline-flex scn:h-[calc(100%-1px)] scn:flex-1 scn:items-center scn:justify-center scn:gap-1.5 scn:rounded-md scn:border scn:border-transparent scn:px-1.5 scn:py-0.5 scn:text-xs scn:font-medium scn:whitespace-nowrap scn:text-foreground/60 scn:transition-all scn:group-data-[orientation=vertical]/tabs:w-full scn:group-data-[orientation=vertical]/tabs:justify-start scn:group-data-[orientation=vertical]/tabs:py-[calc(--spacing(1.25))] scn:hover:text-foreground scn:focus-visible:border-ring scn:focus-visible:ring-[3px] scn:focus-visible:ring-ring/50 scn:focus-visible:outline-1 scn:focus-visible:outline-ring scn:disabled:pointer-events-none scn:disabled:opacity-50 scn:has-data-[icon=inline-end]:pr-1 scn:has-data-[icon=inline-start]:pl-1 scn:aria-disabled:pointer-events-none scn:aria-disabled:opacity-50 scn:dark:text-muted-foreground scn:dark:hover:text-foreground scn:[&_svg]:pointer-events-none scn:[&_svg]:shrink-0 scn:[&_svg:not([class*='size-'])]:size-3.5",
        "scn:group-data-[variant=line]/tabs-list:bg-transparent scn:group-data-[variant=line]/tabs-list:data-active:bg-transparent scn:dark:group-data-[variant=line]/tabs-list:data-active:border-transparent scn:dark:group-data-[variant=line]/tabs-list:data-active:bg-transparent",
        "scn:data-active:bg-background scn:data-active:text-foreground scn:dark:data-active:border-input scn:dark:data-active:bg-input/30 scn:dark:data-active:text-foreground",
        "scn:after:absolute scn:after:bg-foreground scn:after:opacity-0 scn:after:transition-opacity scn:group-data-[orientation=horizontal]/tabs:after:inset-x-0 scn:group-data-[orientation=horizontal]/tabs:after:bottom-[-5px] scn:group-data-[orientation=horizontal]/tabs:after:h-0.5 scn:group-data-[orientation=vertical]/tabs:after:inset-y-0 scn:group-data-[orientation=vertical]/tabs:after:-right-1 scn:group-data-[orientation=vertical]/tabs:after:w-0.5 scn:group-data-[variant=line]/tabs-list:data-active:after:opacity-100",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn("scn:flex-1 scn:text-xs/relaxed scn:outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
