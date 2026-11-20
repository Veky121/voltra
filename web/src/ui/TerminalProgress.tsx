import {terminalBar, terminalGlyph, terminalPercent, type TerminalProgressState} from './terminalProgressModel';

/** An npm-style braille spinner. Pure CSS, so any number of them cost no timers. */
export function TerminalSpinner({label}: {label?: string}) {
  return (
    <span
      className="terminal-spinner"
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}

/**
 * One line of terminal-style progress:
 * `⠹ Downloading server  [==========>          ] 52%  1.4 of 2.7 GB`.
 * Without a value it shows the spinner alone, for work of unknown length.
 */
export function TerminalProgress({
  label,
  value,
  detail,
  state = 'running',
  width = 24,
  className,
  ariaLabel = label,
  statusText,
}: {
  label: string;
  value?: number | null;
  detail?: string;
  state?: TerminalProgressState;
  width?: number;
  className?: string;
  ariaLabel?: string;
  statusText?: string;
}) {
  const shown = terminalPercent(value);
  const active = state === 'running';
  const amount = shown === null ? undefined : `${Math.round(shown)}%`;
  const status = statusText ?? (state === 'done' ? 'Complete' : state === 'failed' ? 'Failed' : 'Waiting');
  return (
    <div
      className={`terminal-progress is-${state}${className ? ` ${className}` : ''}`}
      role={active ? 'progressbar' : 'status'}
      aria-label={active ? ariaLabel : undefined}
      aria-valuemin={active ? 0 : undefined}
      aria-valuemax={active ? 100 : undefined}
      aria-valuenow={active ? (shown ?? undefined) : undefined}
      aria-valuetext={active ? [amount, detail].filter(Boolean).join(', ') || undefined : undefined}
      aria-busy={active || undefined}
    >
      <span className="terminal-progress-glyph" aria-hidden="true">
        {state === 'running' ? <TerminalSpinner /> : terminalGlyph(state)}
      </span>
      <span className="terminal-progress-label">{label}</span>
      {!active && status && <span className="scn:sr-only">, {status}</span>}
      {shown !== null && (
        <span className="terminal-progress-meter" aria-hidden={active || undefined}>
          <span className="terminal-progress-bar" aria-hidden="true">
            {terminalBar(shown, width)}
          </span>
          <span className="terminal-progress-percent">{Math.round(shown)}%</span>
        </span>
      )}
      {detail && <span className="terminal-progress-detail">{detail}</span>}
    </div>
  );
}
