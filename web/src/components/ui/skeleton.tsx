import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("scn:animate-pulse scn:rounded-md scn:bg-muted", className)}
      {...props}
    />
  )
}

export { Skeleton }
