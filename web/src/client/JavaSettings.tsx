import {gbToMiB, miBToGB} from "../resourceUnits.ts";
import './games-ui.css';
import {SettingsRow, Switch} from '../ui/Settings';
import { useEffect, useState } from "react";
import { Button, Card, Input, Select, Textarea, api, unwrap, useAPI } from "../lib";
import { Notice, PageError, useAction } from "./common";

type JavaConfig = {
  enabled?: boolean;
  runtime_id?: string;
  required_major?: number;
  required_distribution?: string;
  xms_mib?: number;
  xmx_mib?: number;
  extra_args?: string;
};
type JavaRuntime = { id: string; name: string; major: number; distribution: string; image: string; enabled: boolean };
type JavaSettingsData = {
  config: JavaConfig;
  egg: { enabled?: boolean; required_major?: number; default_major?: number; required_distribution?: string; jvm_args?: string; memory_mode?: string; args_file?: string; legacy_startup?: string };
  runtimes: JavaRuntime[];
  effective: { runtime_id?: string; image?: string; major?: number; xms_mib?: number; xmx_mib?: number; reserved_mib?: number; jvm_args?: string };
  can_update: boolean;
  can_change_runtime?: boolean;
  effective_error?: string;
};
type Draft = {
  runtime_id: string;
  required_major: string;
  required_distribution: string;
  xms: string;
  xmx: string;
  automatic: boolean;
  extra_args: string;
};
export function draftFrom(config: JavaConfig): Draft {
  return {
    runtime_id: config.runtime_id || "auto",
    required_major: String(config.required_major || 0),
    required_distribution: config.required_distribution || "",
    xms: String(miBToGB(config.xms_mib ?? 256)),
    xmx: config.xmx_mib ? String(miBToGB(config.xmx_mib)) : "1",
    automatic: !config.xmx_mib,
    extra_args: config.extra_args || "",
  };
}
export function toMiB(gib: string): number {
  if (!gib.trim()) throw new Error("Enter a heap size in GB.");
  const mib = gbToMiB(gib);
  if (!Number.isSafeInteger(mib) || mib <= 0) throw new Error("Enter a positive heap size in GB.");
  return mib;
}

export function JavaSettings({ base, memoryMiB, canChangeRuntime = true, onSaved }: {
  base: string;
  memoryMiB?: number;
  canChangeRuntime?: boolean;
  onSaved: () => void;
}) {
  const query = useAPI(`${base}/java`);
  const data = query.data ? unwrap(query.data) as JavaSettingsData : null;
  const [draft, setDraft] = useState<Draft>(() => draftFrom({}));
  const action = useAction();
  useEffect(() => {
    if (data) setDraft(draftFrom({ ...data.config, xms_mib: data.config?.xms_mib || data.effective?.xms_mib || 256 }));
  }, [query.data]);
  const change = <K extends keyof Draft>(key: K, next: Draft[K]) => {
    setDraft((old) => ({ ...old, [key]: next }));
    action.setSuccess("");
  };
  if (query.error) return <Card className="games-ui java-settings"><h3>Java settings</h3><PageError error={query.error} /><Button variant="secondary" onClick={query.reload}>Retry Java settings</Button></Card>;
  if (!data || (!data.config?.enabled && !data.egg?.enabled)) return null;

  const effective = data.effective || {};
  const runtimeList = data.runtimes || [];
  const selected = runtimeList.find((runtime) => runtime.id === draft.runtime_id);
  const editable = data.can_update && !action.busy && !query.loading;
  const runtimeEditable = canChangeRuntime && data.can_change_runtime !== false;
  const limit = Number(memoryMiB || 0);
  const previewXms = gbToMiB(draft.xms);
  const previewXmx = draft.automatic
    ? limit > 0 && effective.reserved_mib != null ? limit - effective.reserved_mib : undefined
    : gbToMiB(draft.xmx);
  const validPreview = Number.isSafeInteger(previewXms) && previewXms > 0 && Number.isSafeInteger(previewXmx) && Number(previewXmx) > 0;
  const flags = validPreview ? [
    `-Xms${previewXms}M`,
    `-Xmx${previewXmx}M`,
    data.egg?.jvm_args?.trim(),
    draft.extra_args.trim(),
  ].filter(Boolean).join(" ") : "Set valid heap sizes to preview JVM flags.";
  return (
    <Card className="games-ui java-settings">
      <h3>Java runtime and memory</h3>
      <Notice action={action} />
      <PageError error={data.effective_error || ""} />
      {!data.can_update && <p className="muted">You can view Java settings. Updating them requires startup permissions.</p>}
      <p className="muted">
        {limit > 0 ? `The container limit is ${miBToGB(limit)} GB. ` : ""}
        The heap is only part of Java's memory use. Leave room for threads, native memory and the server process.
        {effective.reserved_mib != null ? ` Automatic heap keeps ${miBToGB(effective.reserved_mib)} GB outside the heap.` : ""}
      </p>
      <form onSubmit={(event) => {
        event.preventDefault();
        if (!data.can_update) return;
        void action.run(async () => {
          const xms = toMiB(draft.xms);
          const xmx = draft.automatic ? 0 : toMiB(draft.xmx);
          if (xmx && xms > xmx) throw new Error("Initial heap cannot exceed maximum heap.");
          const major = Number(draft.required_major);
          if (!draft.required_major.trim() || !Number.isSafeInteger(major) || major < 0) throw new Error("Java major must be a whole number, or 0 to use the egg default.");
          return api(`${base}/java`, {
            method: "PUT",
            body: JSON.stringify({
              enabled: true,
              runtime_id: draft.runtime_id,
              required_major: major,
              required_distribution: draft.required_distribution.trim(),
              xms_mib: xms,
              xmx_mib: xmx,
              extra_args: draft.extra_args,
            }),
          });
        }, () => {
          action.setSuccess("Java settings saved. Restart the server to apply them.");
          query.reload();
          onSaved();
        });
      }}>
        <fieldset disabled={!editable} className="java-settings-fields">
          <div className="java-settings-group">
            <SettingsRow label="Java runtime" description={runtimeEditable ? "Automatic selects a registered runtime matching the required version and distribution." : "Changing the runtime image also requires Docker image permission."} control={
              <Select aria-label="Java runtime" value={draft.runtime_id} disabled={!runtimeEditable} onChange={(e) => change("runtime_id", e.target.value)}>
                <option value="auto">Automatic</option>
                {draft.runtime_id !== "auto" && (!selected || !selected.enabled) && <option value={draft.runtime_id}>{selected?.name || draft.runtime_id} / unavailable</option>}
                {runtimeList.filter((runtime) => runtime.enabled).map((runtime) => <option key={runtime.id} value={runtime.id}>{runtime.name} / Java {runtime.major} / {runtime.distribution}</option>)}
              </Select>}/>
            <SettingsRow label="Required Java major" description={`Use 0 for the automatic default${data.egg?.default_major || data.egg?.required_major ? `, Java ${data.egg.default_major || data.egg.required_major}` : ""}. Automatic selection uses this exact version.${data.egg?.default_major && data.egg?.required_major ? ` Explicit runtime choices must meet the Java ${data.egg.required_major} minimum.` : ""}`} control={
              <Input aria-label="Required Java major" type="number" min={0} max={999} step={1} required value={draft.required_major} onChange={(e) => change("required_major", e.target.value)} />}/>
            <SettingsRow label="Required distribution" description={data.egg?.required_distribution ? `Leave empty to use ${data.egg.required_distribution} from the egg.` : "Leave empty to allow any registered distribution."} control={
              <Input aria-label="Required distribution" maxLength={80} value={draft.required_distribution} onChange={(e) => change("required_distribution", e.target.value)} />}/>
            <SettingsRow label="Initial heap / GB" description="Sets -Xms. Enter the initial heap size in GB." control={
              <Input aria-label="Initial heap / GB" type="number" min={1 / 1024} step="any" required value={draft.xms} onChange={(e) => change("xms", e.target.value)} />}/>
            <SettingsRow label="Automatic maximum heap" description="The panel reserves memory outside the heap. Unlimited containers need an explicit maximum." control={
              <Switch aria-label="Automatic maximum heap" checked={draft.automatic} onCheckedChange={checked => change("automatic", checked)} />}/>
            {!draft.automatic && <SettingsRow label="Maximum heap / GB" description="Sets -Xmx. The backend checks the container limit and memory reserve." control={
              <Input aria-label="Maximum heap / GB" type="number" min={1 / 1024} step="any" required value={draft.xmx} onChange={(e) => change("xmx", e.target.value)} />}/>}
            <SettingsRow label="Extra JVM arguments" description="Heap sizes are managed above. Do not add heap or memory percentage flags here." control={
              <Textarea aria-label="Extra JVM arguments" rows={3} maxLength={16384} spellCheck={false} value={draft.extra_args} onChange={(e) => change("extra_args", e.target.value)} />}/>
          </div>
          {data.can_update && <div className="java-settings-actions"><Button type="submit">{action.busy ? "Saving..." : "Save Java settings"}</Button></div>}
        </fieldset>
      </form>
      <div className="java-settings-preview"><p className="muted">Generated flags preview{data.egg?.memory_mode === "argfile" ? effective.major != null && effective.major <= 8 && data.egg.legacy_startup ? " for the direct Java startup" : ` for ${data.egg.args_file || "the JVM argument file"}` : ""}</p>
      <pre>{flags}</pre></div>
      {effective.image && <p className="muted java-settings-runtime">Saved runtime: Java {effective.major}, <code>{effective.runtime_id}</code><br /><code>{effective.image}</code></p>}
    </Card>
  );
}

