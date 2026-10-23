import type {CSSProperties} from "react";

export function MinecraftSegments<T extends string>({label, value, options, onChange, disabled = false}: {
  label: string; value: T; options: {id: T; name: string}[]; onChange: (id: T) => void; disabled?: boolean;
}) {
  return <div className="mc-segments" role="group" aria-label={label} style={{"--mc-count": options.length, "--mc-index": Math.max(0, options.findIndex(option => option.id === value))} as CSSProperties}>
    <span className="mc-segment-indicator" aria-hidden="true"/>
    {options.map(option => <button type="button" key={option.id} aria-pressed={value === option.id} disabled={disabled} onClick={() => onChange(option.id)}>{option.name}</button>)}
  </div>;
}
