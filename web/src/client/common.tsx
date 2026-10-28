import {formatBytesGB,formatMiBGB} from '../resourceUnits';
import './gameSwitch.css';
import { createContext, useContext, useState } from "react";
import { api, Button } from "../lib";
import {Switch} from '../ui/Settings';
import './serverPageHeader.css';
import './operations-ui.css';
export type RecordData = Record<string, any>;
export function ServerPageTitle({title,limit}:{title:string;limit?:number|null}){
  return <div className="server-page-title"><h2>{title}</h2><span className="server-limit-badge">Limit: {limit ?? 'Unlimited'}</span></div>;
}
export const ServerContext = createContext<{
  server: RecordData;
  permissions: string[];
  base: string;
  reload: () => void;
}>({ server: {}, permissions: [], base: "", reload: () => {} });
export const useServer = () => useContext(ServerContext);
export const can = (permissions: string[], permission: string) =>
  permissions.includes("*") || permissions.includes(permission);
export const value = (data: any) => data?.attributes ?? data?.data ?? data;
export const items = (data: any): RecordData[] =>
  (data?.data ?? (Array.isArray(data) ? data : [])).map((x: any) => ({
    ...value(x),
    ...(x.meta ? { _meta: x.meta } : {}),
  }));
export const json = (method: string, body?: any): RequestInit => ({
  method,
  ...(body === undefined
    ? {}
    : {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
});
export function useAction() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState("");
  async function run<T>(
    fn: () => Promise<T>,
    done?: (result: T) => void
  ): Promise<T | undefined> {
    setError("");
    setSuccess("");
    setBusy(true);
    try {
      const r = await fn();
      done?.(r);
      return r;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return undefined;
    } finally {
      setBusy(false);
    }
  }
  return { error, busy, success, setError, setSuccess, run };
}
export function Notice({ action }: { action: ReturnType<typeof useAction> }) {
  return (
    <>
      {action.error && (
        <div role="alert" className="error">
          {action.error}
        </div>
      )}
      {action.success && (
        <div role="status" className="success">
          {action.success}
        </div>
      )}
    </>
  );
}
export function PageError({ error }: { error: string }) {
  return error ? (
    <div role="alert" className="error">
      {error}
    </div>
  ) : null;
}
export function Pager({
  data,
  page,
  setPage,
}: {
  data: any;
  page: number;
  setPage: (page: number) => void;
}) {
  const p = data?.meta?.pagination;
  return p && p.total_pages > 1 ? (
    <div className="toolbar operations-pager" aria-label="Pagination">
      <Button
        variant="secondary"
        disabled={page <= 1}
        onClick={() => setPage(page - 1)}
      >
        Previous
      </Button>
      <span>
        Page {page} of {p.total_pages}
      </span>
      <Button
        variant="secondary"
        disabled={page >= p.total_pages}
        onClick={() => setPage(page + 1)}
      >
        Next
      </Button>
    </div>
  ) : null;
}
export const date = (v: any) => (v ? new Date(v).toLocaleString() : "Never");
export function bytes(v: any) {
  const n = Number(v || 0);
  if (!Number.isFinite(n) || n === 0) return "0 B";
  const i = Math.max(0, Math.min(Math.floor(Math.log(Math.abs(n)) / Math.log(1024)), 4));
  return `${(n / 1024 ** i).toFixed(i ? 1 : Math.abs(n) < 1 ? 2 : 0)} ${
    ["B", "KiB", "MiB", "GiB", "TiB"][i]
  }`;
}
export async function download(path: string) {
  const r = value(await api(path));
  window.location.assign(r.url);
}
export function Check({
  label,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="check operations-check">
      <Switch
        checked={checked}
        disabled={disabled}
        onCheckedChange={checked => onChange(checked)}
      />
      {label}
    </label>
  );
}

// Resource telemetry is bytes; configured resource limits are MiB.
export function resourceUsageGB(value: unknown): string {
  return value === null || value === undefined || value === ''
    ? 'Unavailable' : formatBytesGB(Number(value));
}
export function resourceLimitGB(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'Unavailable';
  const amount = Number(value);
  return amount === 0 ? 'Unlimited' : formatMiBGB(amount);
}
export function resourceReadingGB(used: unknown, limitMiB: unknown): string {
  return `${resourceUsageGB(used)} / ${resourceLimitGB(limitMiB)}`;
}
