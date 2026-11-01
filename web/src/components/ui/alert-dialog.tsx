"use client"

import * as React from "react"
import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog"
import { cn } from "@/lib/utils"

import { Button } from "@/components/ui/button"

function AlertDialog({ ...props }: AlertDialogPrimitive.Root.Props) {
  return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />
}

function AlertDialogTrigger({ ...props }: AlertDialogPrimitive.Trigger.Props) {
  return (
    <AlertDialogPrimitive.Trigger data-slot="alert-dialog-trigger" {...props} />
  )
}

function AlertDialogPortal({ ...props }: AlertDialogPrimitive.Portal.Props) {
  return (
    <AlertDialogPrimitive.Portal data-slot="alert-dialog-portal" {...props} />
  )
}

function AlertDialogOverlay({
  className,
  ...props
}: AlertDialogPrimitive.Backdrop.Props) {
  return (
    <AlertDialogPrimitive.Backdrop
      data-slot="alert-dialog-overlay"
      className={cn(
        "scn:fixed scn:inset-0 scn:isolate scn:z-50 scn:bg-black/80 scn:duration-100 scn:supports-backdrop-filter:backdrop-blur-xs scn:data-open:animate-in scn:data-open:fade-in-0 scn:data-closed:animate-out scn:data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogContent({
  className,
  size = "default",
  ...props
}: AlertDialogPrimitive.Popup.Props & {
  size?: "default" | "sm"
}) {
  return (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Popup
        data-slot="alert-dialog-content"
        data-size={size}
        className={cn(
          "scn:group/alert-dialog-content scn:fixed scn:top-1/2 scn:left-1/2 scn:z-50 scn:grid scn:w-full scn:-translate-x-1/2 scn:-translate-y-1/2 scn:gap-3 scn:rounded-xl scn:bg-popover scn:p-4 scn:text-popover-foreground scn:ring-1 scn:ring-foreground/10 scn:duration-100 scn:outline-none scn:data-[size=default]:max-w-xs scn:data-[size=sm]:max-w-64 scn:data-[size=default]:sm:max-w-sm scn:data-open:animate-in scn:data-open:fade-in-0 scn:data-open:zoom-in-95 scn:data-closed:animate-out scn:data-closed:fade-out-0 scn:data-closed:zoom-out-95",
          className
        )}
        {...props}
      />
    </AlertDialogPortal>
  )
}

function AlertDialogHeader({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-header"
      className={cn(
        "scn:grid scn:grid-rows-[auto_1fr] scn:place-items-center scn:gap-1 scn:text-center scn:has-data-[slot=alert-dialog-media]:grid-rows-[auto_auto_1fr] scn:has-data-[slot=alert-dialog-media]:gap-x-4 scn:sm:group-data-[size=default]/alert-dialog-content:place-items-start scn:sm:group-data-[size=default]/alert-dialog-content:text-left scn:sm:group-data-[size=default]/alert-dialog-content:has-data-[slot=alert-dialog-media]:grid-rows-[auto_1fr]",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogFooter({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-footer"
      className={cn(
        "scn:flex scn:flex-col-reverse scn:gap-2 scn:group-data-[size=sm]/alert-dialog-content:grid scn:group-data-[size=sm]/alert-dialog-content:grid-cols-2 scn:sm:flex-row scn:sm:justify-end",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogMedia({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-media"
      className={cn(
        "scn:mb-2 scn:inline-flex scn:size-8 scn:items-center scn:justify-center scn:rounded-md scn:bg-muted scn:sm:group-data-[size=default]/alert-dialog-content:row-span-2 scn:*:[svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return (
    <AlertDialogPrimitive.Title
      data-slot="alert-dialog-title"
      className={cn(
        "cn-font-heading scn:text-sm scn:font-medium scn:sm:group-data-[size=default]/alert-dialog-content:group-has-data-[slot=alert-dialog-media]/alert-dialog-content:col-start-2",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      className={cn(
        "scn:text-xs/relaxed scn:text-balance scn:text-muted-foreground scn:md:text-pretty scn:*:[a]:underline scn:*:[a]:underline-offset-3 scn:*:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogAction({
  className,
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <Button
      data-slot="alert-dialog-action"
      className={cn(className)}
      {...props}
    />
  )
}

function AlertDialogCancel({
  className,
  variant = "outline",
  size = "default",
  ...props
}: AlertDialogPrimitive.Close.Props &
  Pick<React.ComponentProps<typeof Button>, "variant" | "size">) {
  return (
    <AlertDialogPrimitive.Close
      data-slot="alert-dialog-cancel"
      className={cn(className)}
      render={<Button variant={variant} size={size} />}
      {...props}
    />
  )
}

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTitle,
  AlertDialogTrigger,
}

