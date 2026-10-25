import { useEffect, useState } from "react";
import { Button, Field, Input, api, rows, useAPI } from "../lib";
import { ErrorMessage, Heading, Panel } from "./shared";
import { Switch } from "../ui/Settings";

type JavaRuntime = {
  id: string;
  name: string;
  major: number;
  distribution: string;
  image: string;
  enabled: boolean;
};
const endpoint = "/api/admin/java/runtimes";
const blankRuntime = (): JavaRuntime => ({ id: "", name: "", major: 21, distribution: "", image: "", enabled: true });

function validateCatalog(runtimes: JavaRuntime[]): string {
  if (!runtimes.length || runtimes.length > 200) return "Register between 1 and 200 Java runtimes.";
  const ids = new Set<string>();
  for (const [index, runtime] of runtimes.entries()) {
    const label = `Runtime ${index + 1}`;
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(runtime.id) || runtime.id === "auto")
      return `${label} needs an ID made of letters, numbers, dots, underscores or hyphens. The ID auto is reserved.`;
    if (ids.has(runtime.id)) return `Runtime ID ${runtime.id} is duplicated.`;
    ids.add(runtime.id);
    if (!runtime.name.trim() || runtime.name.length > 191) return `${label} needs a name of at most 191 characters.`;
    if (!Number.isSafeInteger(runtime.major) || runtime.major < 8 || runtime.major > 999) return `${label} needs a Java major version between 8 and 999.`;
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(runtime.distribution)) return `${label} needs a distribution ID made of letters, numbers, dots, underscores or hyphens.`;
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_./:@-]{0,510}$/.test(runtime.image)) return `${label} needs a valid container image reference.`;
  }
  return "";
}

export function JavaRuntimes() {
  const query = useAPI(endpoint);
  const [runtimes, setRuntimes] = useState<JavaRuntime[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  useEffect(() => {
    if (query.data) setRuntimes(rows(query.data));
  }, [query.data]);
  const update = (index: number, patch: Partial<JavaRuntime>) => {
    setRuntimes((old) => old.map((runtime, i) => i === index ? { ...runtime, ...patch } : runtime));
    setSaved(false);
  };
  return (
    <div className="admin-management-page management-ui">
      <Heading title="Java runtimes" />
      <p className="muted">Register container images with the Java version and distribution they provide. The panel uses this catalog to select a runtime. Images are not discovered or verified here.</p>
      <ErrorMessage error={query.error} />
      {query.error && <Button variant="secondary" onClick={query.reload}>Retry loading runtimes</Button>}
      {query.loading ? <p role="status">Loading Java runtimes...</p> : query.data && (
        <form onSubmit={async (event) => {
          event.preventDefault();
          setSaved(false);
          const normalized = runtimes.map((runtime) => ({ ...runtime, id: runtime.id.trim(), name: runtime.name.trim(), distribution: runtime.distribution.trim(), image: runtime.image.trim() }));
          const validation = validateCatalog(normalized);
          setError(validation);
          if (validation) return;
          setBusy(true);
          try {
            await api(endpoint, { method: "PUT", body: JSON.stringify({ runtimes: normalized }) });
            setSaved(true);
            query.reload();
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          } finally {
            setBusy(false);
          }
        }}>
          <ErrorMessage error={error} />
          {saved && <p className="success" role="status">Java runtime catalog saved.</p>}
          <fieldset disabled={busy} className="admin-fieldset">
            {runtimes.map((runtime, index) => (
              <details className="card admin-disclosure admin-runtime" key={index} open={openIndex === index} onInvalid={() => setOpenIndex(index)}>
                <summary onClick={(event) => { event.preventDefault(); setOpenIndex((old) => old === index ? null : index); }}>
                  <span className="admin-disclosure-title">{runtime.name || `Runtime ${index + 1}`}</span>
                  <span className="admin-disclosure-meta"><span className="badge">Java {runtime.major}</span><span>{runtime.distribution || "No distribution"}</span>{!runtime.enabled && <span className="badge">Disabled</span>}</span>
                </summary>
                <div className="form-grid">
                  <Field label="Runtime ID" hint="Keep this stable. Server settings refer to this ID.">
                    <Input required maxLength={80} value={runtime.id} onChange={(e) => update(index, { id: e.target.value })} />
                  </Field>
                  <Field label="Display name">
                    <Input required maxLength={191} value={runtime.name} onChange={(e) => update(index, { name: e.target.value })} />
                  </Field>
                  <Field label="Java major version">
                    <Input required type="number" min={8} max={999} step={1} value={Number.isNaN(runtime.major) ? "" : runtime.major} onChange={(e) => update(index, { major: e.target.valueAsNumber })} />
                  </Field>
                  <Field label="Distribution" hint="Use the same name in egg and server requirements.">
                    <Input required maxLength={80} placeholder="temurin" value={runtime.distribution} onChange={(e) => update(index, { distribution: e.target.value })} />
                  </Field>
                  <Field label="Container image" hint="Use an image that supports your node and server startup command.">
                    <Input required maxLength={511} placeholder="registry.example.com/java:21" value={runtime.image} spellCheck={false} onChange={(e) => update(index, { image: e.target.value })} />
                  </Field>
                  <Field label="Enabled">
                    <Switch checked={runtime.enabled} onCheckedChange={checked => update(index, { enabled: checked })} />
                  </Field>
                </div>
                <div className="actions admin-form-actions"><Button variant="secondary" onClick={() => {
                  setRuntimes((old) => old.filter((_, i) => i !== index));
                  setOpenIndex(null);
                  setSaved(false);
                }}>Remove {runtime.name || `runtime ${index + 1}`}</Button></div>
              </details>
            ))}
            {!runtimes.length && <Panel>No runtimes registered. Add a runtime to make it available to Java servers.</Panel>}
            <p className="muted">Disabling or removing a runtime can prevent servers that use it from starting.</p>
            <div className="actions admin-form-actions admin-form-actions-split">
              <Button variant="secondary" onClick={() => { setOpenIndex(runtimes.length); setRuntimes((old) => [...old, blankRuntime()]); setSaved(false); }}>Add runtime</Button>
              <Button type="submit">{busy ? "Saving..." : "Save runtime catalog"}</Button>
            </div>
          </fieldset>
        </form>
      )}
    </div>
  );
}
