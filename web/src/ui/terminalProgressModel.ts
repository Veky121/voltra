import {formatBytes} from '../format.ts';

// Terminal-style progress, shared by the whole app: the Console's install
// stages, backups, uploads, transfers and updates all draw the same text bar.

export type TerminalProgressState = 'running' | 'done' | 'failed' | 'waiting';

/** Clamps a percentage to 0..100, or null when the amount is unknown. */
export function terminalPercent(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Math.min(100, Math.max(0, value));
}

/**
 * A fixed-width text bar such as `[=========>          ]`. The head `>` marks
 * the moving edge; a full bar has none.
 */
export function terminalBar(percent: number, width = 24): string {
  const size = Math.max(4, Math.floor(width));
  const filled = Math.round((Math.min(100, Math.max(0, percent)) / 100) * size);
  if (filled >= size) return `[${'='.repeat(size)}]`;
  if (filled <= 0) return `[${' '.repeat(size)}]`;
  return `[${'='.repeat(filled - 1)}>${' '.repeat(size - filled)}]`;
}

/** The glyph before a line: a spinner while running, then a tick or a cross. */
export function terminalGlyph(state: TerminalProgressState): string {
  return state === 'done' ? '✔' : state === 'failed' ? '✖' : state === 'waiting' ? '·' : '';
}

/** A byte-based percentage is available only when both counts are measured. */
export function bytesProgressValue(received?: number | null, total?: number | null): number | null {
  if (
    received == null ||
    total == null ||
    !Number.isFinite(received) ||
    !Number.isFinite(total) ||
    received < 0 ||
    total <= 0
  )
    return null;
  return terminalPercent((received / total) * 100);
}

export function formatBytesProgress(received?: number | null, total?: number | null): string {
  const amount = formatBytes(received, {empty: ''});
  const size = formatBytes(total, {empty: ''});
  return amount ? (size ? `${amount} of ${size}` : `${amount} received`) : size ? `${size} total` : '';
}
