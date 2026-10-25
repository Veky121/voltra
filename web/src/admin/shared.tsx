import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import {Select,  api, rows, unwrap, useAPI as useCoreAPI } from "../lib";
import { Switch } from "../ui/Settings";
import "./management-ui.css";

export { api, rows, unwrap };
// Administration selectors and local table searches need every page, including
// records beyond the backend's per-page limit.
export function useAPI(path: string | null) {
  const source = useCoreAPI(path);
  const [complete, setComplete] = useState<any>(null);
  const [loadingPages, setLoadingPages] = useState(false);
  const [pageError, setPageError] = useState("");
  useEffect(() => {
    let cancelled = false;
    setComplete(null);
    setPageError("");
    const data = source.data as any;
    const pages = Number(data?.meta?.pagination?.total_pages ?? 1);
    if (!path || source.loading || data?.object !== "list" || pages < 2) {
      setLoadingPages(false);
      return;
    }
    setLoadingPages(true);
    void (async () => {
      try {
        const all = [...data.data];
        for (let page = 2; page <= pages; page++) {
          if (cancelled) return;
          const url = new URL(path, window.location.origin);
          url.searchParams.set("page", String(page));
          const next = await api(`${url.pathname}${url.search}`);
          all.push(...next.data);
        }
        if (!cancelled) setComplete({ ...data, data: all });
      } catch (error) {
        if (!cancelled)
          setPageError(error instanceof Error ? error.message : String(error));
      } finally {
        if (!cancelled) setLoadingPages(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source.data, source.loading, path]);
  return {
    ...source,
    data: complete ?? source.data,
    error: source.error || pageError,
    loading: source.loading || loadingPages,
  };
}
export type RecordData = Record<string, any>;
export type FieldSpec = {
  key: string;
  label: string;
  type?:
    | "number"
    | "checkbox"
    | "textarea"
    | "json"
    | "password"
    | "select"
    | "multiselect"
    | "email";
  required?: boolean;
  disabled?: boolean;
  hint?: string;
  options?: { value: string | number; label: string }[];
  default?: any;
};
export const f = (
  key: string,
  label: string,
  type?: FieldSpec["type"],
  extra: Partial<FieldSpec> = {}
): FieldSpec => ({ key, label, type, ...extra });
export function defaults(fields: FieldSpec[]) {
  return Object.fromEntries(
    fields.map((x) => [
      x.key,
      x.default ??
        (x.type === "number"
          ? 0
          : x.type === "checkbox"
          ? false
          : x.type === "json"
          ? {}
          : x.type === "multiselect"
          ? []
          : ""),
    ])
  );
}
export function ErrorMessage({ error }: { error?: string }) {
  return error ? (
    <div className="error admin-feedback management-ui" role="alert">
      {error}
    </div>
  ) : null;
}
export function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="success admin-feedback management-ui" role="status">
      {children}
    </div>
  );
}
export function Heading({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-header admin-heading management-ui">
      <div>
        <p className="eyebrow">Administration</p>
        <h1>{title}</h1>
      </div>
      <div className="actions">{children}</div>
    </div>
  );
}
export function Panel({
  title,
  children,
  className = "",
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card admin-panel management-ui ${className}`}>
      {title && <h2>{title}</h2>}
      {children}
    </section>
  );
}
export function DataTable({
  data,
  columns,
  empty = "No records yet.",
  loading = false,
}: {
  data: RecordData[];
  columns: { label: string; render: (r: RecordData) => ReactNode }[];
  empty?: string;
  loading?: boolean;
}) {
  const [search, setSearch] = useState("");
  const filtered = data.filter((x) =>
    JSON.stringify(x).toLowerCase().includes(search.toLowerCase())
  );
  return (
    <div className="admin-data management-ui" aria-busy={loading}>
      <div className="toolbar admin-data-toolbar">
        <input
          type="search"
          aria-label="Search records"
          placeholder="Search records…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="muted admin-record-count" role="status">{loading ? "Loading..." : `${filtered.length} ${filtered.length === 1 ? "record" : "records"}`}</span>
      </div>
      <div className="admin-table-scroll">
        <table className="table">
          <thead>
            <tr>
              {columns.map((c) => (
                <th scope="col" key={c.label}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? <tr><td colSpan={columns.length} className="admin-table-empty">Loading records...</td></tr> : filtered.map((r, i) => (
              <tr key={r.id ?? r.identifier ?? i}>
                {columns.map((c) => (
                  <td key={c.label}>{c.render(r)}</td>
                ))}
              </tr>
            ))}
            {!loading && !filtered.length && <tr><td colSpan={columns.length} className="admin-table-empty">{search ? "No records match your search." : empty}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
export function Fields({
  fields,
  value,
  onChange,
}: {
  fields: FieldSpec[];
  value: RecordData;
  onChange: (value: RecordData) => void;
}) {
  return (
    <div className="form-grid admin-fields management-ui">
      {fields.map((field) => {
        const v = value[field.key] ?? "";
        const set = (next: any) => onChange({ ...value, [field.key]: next });
        return (
          <label className={`field admin-field${field.type === "checkbox" ? " admin-field-switch" : ""}${field.type === "json" ? " admin-field-code" : ""}`} key={field.key}>
            <span>
              {field.label}
              {field.required && " *"}
            </span>
            {field.type === "checkbox" ? (
              <Switch
                checked={Boolean(v)}
                onCheckedChange={checked => set(checked)}
              />
            ) : field.type === "select" || field.type === "multiselect" ? (
              <Select
                disabled={field.disabled}
                multiple={field.type === "multiselect"}
                required={field.required}
                value={
                  field.type === "multiselect"
                    ? Array.isArray(v)
                      ? v.map(String)
                      : []
                    : v
                }
                onChange={(e) =>
                  set(
                    field.type === "multiselect"
                      ? Array.from(e.target.selectedOptions)
                          .filter((o) => o.value !== "")
                          .map(
                            (o) =>
                              field.options?.find(
                                (x) => String(x.value) === o.value
                              )?.value ?? o.value
                          )
                      : field.options?.find(
                          (x) => String(x.value) === e.target.value
                        )?.value ?? null
                  )
                }
              >
                <option value="">Select…</option>
                {field.options?.map((x) => (
                  <option key={x.value} value={x.value}>
                    {x.label}
                  </option>
                ))}
              </Select>
            ) : field.type === "textarea" || field.type === "json" ? (
              <textarea
                rows={field.type === "json" ? 7 : 4}
                required={field.required}
                value={typeof v === "object" ? JSON.stringify(v, null, 2) : v}
                onChange={(e) => set(e.target.value)}
                spellCheck={false}
              />
            ) : (
              <input
                required={field.required}
                type={field.type ?? "text"}
                value={v}
                onChange={(e) =>
                  set(
                    field.type === "number"
                      ? e.target.value === ""
                        ? ""
                        : Number(e.target.value)
                      : e.target.value
                  )
                }
              />
            )}
            {field.hint && <small className="muted">{field.hint}</small>}
          </label>
        );
      })}
    </div>
  );
}
export function normalize(fields: FieldSpec[], value: RecordData) {
  const out = { ...value };
  for (const field of fields) {
    if (field.type === "json" && typeof out[field.key] === "string")
      out[field.key] = JSON.parse(out[field.key] || "{}");
    if (field.type === "select" && out[field.key] === "") out[field.key] = null;
    if (field.type === "number")
      out[field.key] =
        out[field.key] == null || out[field.key] === ""
          ? null
          : Number(out[field.key]);
  }
  return out;
}
export function Editor({
  title,
  fields,
  initial,
  endpoint,
  method = "PATCH",
  transform,
  onSaved,
  submit = "Save changes",
}: {
  title?: string;
  fields: FieldSpec[];
  initial?: RecordData;
  endpoint: string;
  method?: string;
  transform?: (v: RecordData) => RecordData;
  onSaved?: (result: any) => void;
  submit?: string;
}) {
  const [value, setValue] = useState<RecordData>({
    ...defaults(fields),
    ...initial,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    setValue({ ...defaults(fields), ...initial });
  }, [initial]);
  return (
    <Panel title={title}>
      <form
        className="admin-editor-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          setSaved(false);
          try {
            const selected = Object.fromEntries(
              fields
                .filter(
                  (field) =>
                    !(
                      method === "PATCH" &&
                      field.type === "password" &&
                      !value[field.key]
                    )
                )
                .map((field) => [field.key, value[field.key]])
            );
            const normalized = normalize(
              fields.filter((field) => field.key in selected),
              selected
            );
            const result = await api(endpoint, {
              method,
              body: JSON.stringify(
                transform ? transform(normalized) : normalized
              ),
            });
            setSaved(true);
            onSaved?.(result);
          } catch (err) {
            setError(String(err instanceof Error ? err.message : err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <ErrorMessage error={error} />
        {saved && <Notice>Changes saved.</Notice>}
        <Fields fields={fields} value={value} onChange={setValue} />
        <div className="actions admin-form-actions">
          <button disabled={busy} type="submit">
            {busy ? "Saving…" : submit}
          </button>
        </div>
      </form>
    </Panel>
  );
}
export function Action({
  path,
  children,
  body,
  method = "POST",
  confirm,
  onDone,
  danger = false,
}: {
  path: string;
  children: ReactNode;
  body?: any;
  method?: string;
  confirm?: string;
  onDone?: (v: any) => void;
  danger?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  return (
    <div className="admin-action management-ui">
      <button
        className={danger ? "danger" : "secondary"}
        disabled={busy}
        onClick={async () => {
          if (confirm && !window.confirm(confirm)) return;
          setBusy(true);
          setError("");
          setDone(false);
          try {
            const v = await api(path, {
              method,
              ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
            });
            setDone(true);
            onDone?.(v);
          } catch (err) {
            setError(String(err instanceof Error ? err.message : err));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Working…" : children}
      </button>
      <ErrorMessage error={error} />
      {done && (
        <small className="success admin-action-status" role="status">
          Completed.
        </small>
      )}
    </div>
  );
}
export function ResourceList({
  title,
  description,
  endpoint,
  base,
  columns,
}: {
  title: string;
  description?: string;
  endpoint: string;
  base: string;
  columns: string[];
}) {
  const q = useAPI(endpoint);
  return (
    <div className="admin-management-page management-ui">
      <Heading title={title}>
        <Link className="button" to={`${base}/new`}>
          Create {title.toLowerCase().replace(/s$/, "")}
        </Link>
        <button className="secondary" onClick={q.reload}>
          Refresh
        </button>
      </Heading>
      {description && <p className="muted">{description}</p>}
      <ErrorMessage error={q.error} />
      {q.loading ? (
        <p className="admin-loading" role="status">Loading records...</p>
      ) : (
        <Panel>
          <DataTable
            data={q.data ? rows(q.data) : []}
            columns={[
              {
                label: "ID",
                render: (x) => <Link to={`${base}/${x.id}`}>#{x.id}</Link>,
              },
              ...columns.map((key) => ({
                label: key.replaceAll("_", " "),
                render: (x: RecordData) => (
                  <Link to={`${base}/${x.id}`}>
                    {typeof x[key] === "boolean"
                      ? x[key]
                        ? "Yes"
                        : "No"
                      : String(x[key] ?? "—")}
                  </Link>
                ),
              })),
            ]}
          />
        </Panel>
      )}
    </div>
  );
}
export function ResourceEditor({
  title,
  endpoint,
  base,
  id,
  fields,
  children,
}: {
  title: string;
  endpoint: string;
  base: string;
  id: string;
  fields: FieldSpec[];
  children?: (record: RecordData) => ReactNode;
}) {
  const navigate = useNavigate();
  const creating = id === "new";
  const q = useAPI(creating ? null : `${endpoint}/${id}`);
  const record = q.data ? unwrap(q.data) : undefined;
  return (
    <div className="admin-management-page management-ui">
      <Heading
        title={
          creating
            ? `Create ${title}`
            : `${title} · ${
                record?.name ?? record?.username ?? record?.short ?? id
              }`
        }
      >
        <Link to={base}>Back to list</Link>
        {!creating && (
          <Action
            path={`${endpoint}/${id}`}
            method="DELETE"
            danger
            confirm={`Delete this ${title.toLowerCase()}? This cannot be undone.`}
            onDone={() => navigate(base)}
          >
            Delete
          </Action>
        )}
      </Heading>
      <ErrorMessage error={q.error} />
      {!creating && q.loading ? (
        <p className="admin-loading" role="status">Loading details...</p>
      ) : (
        <Editor
          fields={fields}
          initial={record}
          endpoint={creating ? endpoint : `${endpoint}/${id}`}
          method={creating ? "POST" : "PATCH"}
          onSaved={(r) =>
            creating ? navigate(`${base}/${unwrap(r)?.id ?? r.id}`) : q.reload()
          }
          submit={creating ? `Create ${title.toLowerCase()}` : undefined}
        />
      )}
      {record && children?.(record)}
    </div>
  );
}
export function JsonView({ value }: { value: any }) {
  return (
    <pre className="admin-json management-ui">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}
export function DownloadJSON({ value, name }: { value: any; name: string }) {
  return (
    <button
      className="secondary"
      onClick={() => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(
          new Blob([JSON.stringify(value, null, 2)], {
            type: "application/json",
          })
        );
        a.download = name;
        a.click();
        URL.revokeObjectURL(a.href);
      }}
    >
      Download JSON
    </button>
  );
}
