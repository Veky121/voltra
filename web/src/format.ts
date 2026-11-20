// One place for how dates, times and sizes read in the panel.
//
// Memory, storage and capacity are GB (1 GB = 1024 MiB), through the resource
// unit helpers re-exported here. File sizes and network traffic scale from B
// to TB on the same 1024 base, so a 2 GB file and a 2 GB limit mean the same.
import {formatBytesGB, formatMiBGB} from './resourceUnits.ts';

export {formatBytesGB, formatMiBGB};

export type DateTimeStyle = 'datetime' | 'date' | 'time' | 'precise';
export type DateTimeOptions = {
  style?: DateTimeStyle;
  /** Shown when there is no date at all, such as a key that was never used. */
  empty?: string;
  /** Shown when the value is not a date. */
  invalid?: string;
  locale?: string;
  timeZone?: string;
};

const presets: Record<DateTimeStyle, Intl.DateTimeFormatOptions> = {
  datetime: {year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'},
  date: {year: 'numeric', month: 'short', day: 'numeric'},
  time: {hour: '2-digit', minute: '2-digit'},
  precise: {year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit'},
};
const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(style: DateTimeStyle, locale?: string, timeZone?: string) {
  const key = `${style}|${locale ?? ''}|${timeZone ?? ''}`;
  let format = formatters.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(locale, {...presets[style], ...(timeZone ? {timeZone} : {})});
    formatters.set(key, format);
  }
  return format;
}

/**
 * A Date for a panel timestamp, or `null` when there is none (nothing, an
 * empty string, or Go's zero time) and `undefined` when it is not a date.
 */
export function parseDateTime(value: unknown): Date | null | undefined {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string' && /^0001-01-01/.test(value)) return null;
  const date =
    value instanceof Date
      ? value
      : typeof value === 'string' || typeof value === 'number'
        ? new Date(value)
        : undefined;
  return date && !Number.isNaN(date.getTime()) ? date : undefined;
}

export function formatDateTime(
  value: unknown,
  {style = 'datetime', empty = 'Never', invalid = 'Unknown', locale, timeZone}: DateTimeOptions = {}
): string {
  const date = parseDateTime(value);
  if (date === null) return empty;
  if (date === undefined) return invalid;
  return formatter(style, locale, timeZone).format(date);
}

const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

export type SizeOptions = {empty?: string; locale?: string};

/** File and transfer sizes: `512 B`, `1.5 KB`, `12.3 MB`, `120 MB`, `2 GB`. */
export function formatBytes(value: unknown, {empty = 'Unavailable', locale}: SizeOptions = {}): string {
  if (value === null || value === undefined || value === '') return empty;
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return empty;
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  let unit = 0,
    amount = bytes;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit++;
  }
  let digits = amount < 100 ? 1 : 0;
  let rounded = Number(amount.toFixed(digits));
  // 1023.97 KB rounds to 1024 KB; say 1 MB instead.
  if (rounded >= 1024 && unit < units.length - 1) {
    rounded = 1;
    unit++;
    digits = 1;
  }
  return `${rounded.toLocaleString(locale, {maximumFractionDigits: digits})} ${units[unit]}`;
}

/** Network throughput: `0 B/s`, `1.2 MB/s`. */
export function formatByteRate(bytesPerSecond: unknown, options: SizeOptions = {}): string {
  const text = formatBytes(bytesPerSecond, {...options, empty: ''});
  return text ? `${text}/s` : (options.empty ?? 'Unavailable');
}
