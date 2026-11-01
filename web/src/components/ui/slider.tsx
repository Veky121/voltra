import { Slider as SliderPrimitive } from "@base-ui/react/slider"
import { cn } from "@/lib/utils"

function Slider({
  className,
  "aria-label": ariaLabel,
  defaultValue,
  value,
  min = 0,
  max = 100,
  ...props
}: SliderPrimitive.Root.Props) {
  const _values = Array.isArray(value)
    ? value
    : Array.isArray(defaultValue)
      ? defaultValue
      : [typeof value === "number" ? value : typeof defaultValue === "number" ? defaultValue : min]

  return (
    <SliderPrimitive.Root
      className={cn("scn:data-[orientation=horizontal]:w-full scn:data-[orientation=vertical]:h-full", className)}
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      thumbAlignment="edge"
      {...props}
    >
      <SliderPrimitive.Control className="scn:relative scn:flex scn:w-full scn:touch-none scn:items-center scn:select-none scn:data-disabled:opacity-50 scn:data-[orientation=vertical]:h-full scn:data-[orientation=vertical]:min-h-40 scn:data-[orientation=vertical]:w-auto scn:data-[orientation=vertical]:flex-col">
        <SliderPrimitive.Track
          data-slot="slider-track"
          className="scn:relative scn:grow scn:overflow-hidden scn:rounded-md scn:bg-muted scn:select-none scn:data-[orientation=horizontal]:h-1 scn:data-[orientation=horizontal]:w-full scn:data-[orientation=vertical]:h-full scn:data-[orientation=vertical]:w-1"
        >
          <SliderPrimitive.Indicator
            data-slot="slider-range"
            className="scn:bg-primary scn:select-none scn:data-[orientation=horizontal]:h-full scn:data-[orientation=vertical]:w-full"
          />
        </SliderPrimitive.Track>
        {Array.from({ length: _values.length }, (_, index) => (
          <SliderPrimitive.Thumb
            data-slot="slider-thumb"
            aria-label={ariaLabel}
            key={index}
            className="scn:relative scn:block scn:size-3 scn:shrink-0 scn:rounded-md scn:border scn:border-ring scn:bg-white scn:ring-ring/30 scn:transition-[color,box-shadow] scn:select-none scn:after:absolute scn:after:-inset-2 scn:hover:ring-2 scn:focus-visible:ring-2 scn:focus-visible:outline-hidden scn:active:ring-2 scn:disabled:pointer-events-none scn:disabled:opacity-50"
          />
        ))}
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  )
}

export { Slider }

