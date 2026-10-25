import { Separator as SeparatorPrimitive } from "@base-ui/react/separator"
import { cn } from "@/lib/utils"

function Separator({
  className,
  orientation = "horizontal",
  ...props
}: SeparatorPrimitive.Props) {
  return (
    <SeparatorPrimitive
      data-slot="separator"
      orientation={orientation}
      className={cn(
        "scn:shrink-0 scn:bg-border scn:data-horizontal:h-px scn:data-horizontal:w-full scn:data-vertical:w-px scn:data-vertical:self-stretch",
        className
      )}
      {...props}
    />
  )
}

export { Separator }
