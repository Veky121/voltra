// Wings and panel resource limits use MiB; forms and resource summaries use GB.
// Keep the existing binary capacities: 1 displayed GB represents 1024 MiB.
export const miBToGB = (value: number): number => value / 1024;
export function gbToMiB(value: string | number): number {
  if (typeof value === 'string' && !value.trim()) return NaN;
  const amount = Number(value);
  const result = Math.round(amount * 1024);
  return Number.isFinite(amount) && amount >= 0 && Number.isSafeInteger(result) && !(amount > 0 && result === 0) ? result : NaN;
}
export function formatBytesGB(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return 'Unavailable';
  const amount = bytes / 1024 ** 3;
  if (amount > 0 && amount < 0.001) return '<0.001 GB';
  return `${amount.toLocaleString(undefined, {maximumFractionDigits: 3})} GB`;
}
export const formatMiBGB = (value: number): string => formatBytesGB(value * 1024 ** 2);
