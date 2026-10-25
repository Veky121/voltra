import * as React from "react"
import { cn } from "@/lib/utils"

function Card({
  className,
  as: Component = "div",
  size = "default",
  ...props
}: React.ComponentProps<"div"> & { size?: "default" | "sm"; as?: "div" | "section" | "article" }) {
  return (
    <Component
      data-slot="card"
      data-size={size}
      className={cn(
        "scn:group/card scn:flex scn:flex-col scn:gap-(--card-spacing) scn:overflow-hidden scn:rounded-lg scn:bg-card scn:py-(--card-spacing) scn:text-xs/relaxed scn:text-card-foreground scn:ring-1 scn:ring-foreground/10 scn:[--card-spacing:--spacing(4)] scn:has-[>img:first-child]:pt-0 scn:data-[size=sm]:[--card-spacing:--spacing(3)] scn:*:[img:first-child]:rounded-t-lg scn:*:[img:last-child]:rounded-b-lg",
        className
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "scn:group/card-header scn:@container/card-header scn:grid scn:auto-rows-min scn:items-start scn:gap-1 scn:rounded-t-lg scn:px-(--card-spacing) scn:has-data-[slot=card-action]:grid-cols-[1fr_auto] scn:has-data-[slot=card-description]:grid-rows-[auto_auto] scn:[.border-b]:pb-(--card-spacing)",
        className
      )}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn(" scn:text-sm scn:font-medium", className)}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("scn:text-xs/relaxed scn:text-muted-foreground", className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "scn:col-start-2 scn:row-span-2 scn:row-start-1 scn:self-start scn:justify-self-end",
        className
      )}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("scn:px-(--card-spacing)", className)}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "scn:flex scn:items-center scn:rounded-b-lg scn:px-(--card-spacing) scn:[.border-t]:pt-(--card-spacing)",
        className
      )}
      {...props}
    />
  )
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
}
