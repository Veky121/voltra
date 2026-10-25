import { useEffect, useState } from "react";
import { Button, Field, Input, Select, Textarea, api } from "../lib";
import { ErrorMessage, Panel } from "./shared";
import { SettingsRow, Switch } from "../ui/Settings";

type JavaEggConfig = {
  enabled: boolean;
  required_major: number;
  default_major?: number;
  legacy_startup?: string;
  required_distribution: string;
  memory_mode: "command" | "argfile";
  args_file: string;
  jvm_args: string;
};

function initialConfig(config?: Partial<JavaEggConfig>): JavaEggConfig {
  return {
    enabled: false,
    required_major: 0,
    required_distribution: "",
    memory_mode: "command",
    args_file: "user_jvm_args.txt",
    jvm_args: "",
    ...config,
  };
}

export function JavaEgg({ eggID, config, onSaved }: {
  eggID: string;
  config?: Partial<JavaEggConfig>;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState(() => initialConfig(config));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => setDraft(initialConfig(config)), [config, eggID]);
  const change = <K extends keyof JavaEggConfig>(key: K, value: JavaEggConfig[K]) => {
    setDraft((old) => ({ ...old, [key]: value }));
    setSaved(false);
  };
  return (
    <Panel title="Java settings" className="admin-java-settings">
      <p className="muted">Enable Java controls for servers using this egg. Existing eggs stay unchanged until Java is enabled.</p>
      <form onSubmit={async (event) => {
        event.preventDefault();
        setError("");
        setSaved(false);
        setBusy(true);
        try {
          await api(`/api/admin/eggs/${eggID}`, {
            method: "PATCH",
            body: JSON.stringify({ java_config: draft }),
          });
          setSaved(true);
          onSaved();
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        } finally {
          setBusy(false);
        }
      }}>
        <ErrorMessage error={error} />
        {saved && <p className="success" role="status">Java settings saved.</p>}
        <fieldset disabled={busy} className="admin-fieldset">
          <SettingsRow className="admin-toggle-row" label="Enable Java controls" control={
            <Switch aria-label="Enable Java controls" checked={draft.enabled} onCheckedChange={checked => change("enabled", checked)} />
          } />
          <fieldset disabled={!draft.enabled} className="admin-fieldset">
            <div className="form-grid">
              <Field label="Minimum Java major" hint="Use 0 for the server or platform default.">
                <Input type="number" min={0} max={999} step={1} required value={Number.isNaN(draft.required_major) ? "" : draft.required_major} onChange={(e) => change("required_major", e.target.valueAsNumber)} />
              </Field>
              <Field label="Automatic Java major" hint="Leave empty to use the minimum or platform default. Explicit server runtime choices still follow the minimum.">
                <Input type="number" min={Math.max(8, draft.required_major || 8)} max={999} step={1} value={draft.default_major ?? ""} onChange={(e) => change("default_major", e.target.value === "" ? undefined : e.target.valueAsNumber)} />
              </Field>
              <Field label="Required distribution" hint="Leave empty to allow any registered distribution.">
                <Input maxLength={80} value={draft.required_distribution} onChange={(e) => change("required_distribution", e.target.value)} />
              </Field>
              <Field label="Memory flags">
                <Select value={draft.memory_mode} onChange={(e) => {
                  const mode = e.target.value as JavaEggConfig["memory_mode"];
                  change("memory_mode", mode);
                  if (mode === "command") change("legacy_startup", undefined);
                }}>
                  <option value="command">Java command</option>
                  <option value="argfile">JVM argument file</option>
                </Select>
              </Field>
              {draft.memory_mode === "argfile" && (
                <Field label="Legacy Java startup" hint="Optional direct java -jar command for Java8 or older. Modern runtimes keep the normal argument-file startup. The server validates this command.">
                  <Input maxLength={4096} value={draft.legacy_startup ?? ""} onChange={(e) => change("legacy_startup", e.target.value === "" ? undefined : e.target.value)} />
                </Field>
              )}
              {draft.memory_mode === "argfile" && (
                <Field label="JVM argument file" hint="Java9 or later reads this file. Java8 needs the optional direct JAR startup above.">
                  <Input required maxLength={128} value={draft.args_file} onChange={(e) => change("args_file", e.target.value)} />
                </Field>
              )}
            </div>
            <Field label="Default JVM arguments" hint="Heap flags are generated from the server's memory settings. Leave -Xms and -Xmx out of these arguments.">
              <Textarea className="admin-code-input" rows={3} maxLength={16384} spellCheck={false} value={draft.jvm_args} onChange={(e) => change("jvm_args", e.target.value)} />
            </Field>
            <p className="muted">Command mode applies flags to a Java startup command. For a custom startup script, use an argument file that the script reads.</p>
          </fieldset>
          <div className="actions admin-form-actions"><Button type="submit">{busy ? "Saving..." : "Save Java settings"}</Button></div>
        </fieldset>
      </form>
    </Panel>
  );
}
