import {settingDescription} from './settingDescription';
import {PendingSettings, usePendingSetting} from './PendingSettings';
import {GameSwitch} from './GameSwitch';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { api, Button, Card, Input, Select, useAPI } from '../lib';
import { can, items, json, PageError, useServer, value } from './common';
import { JavaSettings } from './JavaSettings';
import { commandPreview, secretVariable, variableControl, variableEditable, variableProblem, variableValue, variableWrite, startupVariableSection } from './startupSettingsModel';
import type { StartupMeta, StartupVariable, VariableIntent, VariableWrite } from './startupSettingsModel';
import './startupSettings.css';

type VariableProps = {
  variable: StartupVariable;
  permitted: boolean;
  onSave: (payload: VariableWrite) => Promise<StartupVariable>;
  onDirty: (key: string, dirty: boolean) => void;
};

export function StartupVariableField({ variable, permitted, onSave, onDirty }: VariableProps) {
  const baseline = variableValue(variable);
  const previous = useRef(baseline);
  const [draft, setDraft] = useState(baseline);
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [clear, setClear] = useState(false);
  const secret = secretVariable(variable);
  const editable = variableEditable(variable, permitted);
  const control = variableControl(variable);
  const dirty = clear || (secret ? draft.length > 0 : draft !== baseline);
  const problem = dirty && !clear ? variableProblem(variable, draft) : '';
  const configured = variable.secret_configured ?? variable.configured;
  const label = variable.name || variable.env_variable;
  const id = `startup-${variable.env_variable}`;

  useEffect(() => {
    // A sibling save or Java refresh must not discard this field's draft.
    const oldBaseline = previous.current;
    setDraft(current => current === oldBaseline ? baseline : current);
    previous.current = baseline;
  }, [baseline]);
  useEffect(() => {
    onDirty(variable.env_variable, dirty);
    return () => onDirty(variable.env_variable, false);
  }, [variable.env_variable, dirty, onDirty]);

  async function save(intent: VariableIntent) {
    if (locked.current || !editable) return;
    setError('');
    setSuccess('');
    try {
      const payload = variableWrite(variable, draft, intent, permitted);
      if (!payload) return;
      locked.current = true;
      setBusy(true);
      const saved = await onSave(payload);
      setDraft(variableValue(saved)); setClear(false);

    } catch (cause) {
      // Validation responses can echo submitted values. Keep secret errors value-free.
      setError(secret ? 'Could not save this value.' : cause instanceof Error ? cause.message : 'Could not save this setting.');
      throw cause;
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }

  usePendingSetting(variable.env_variable, dirty, {blocked: !!problem || !editable || busy, save: () => save(clear ? 'clear' : 'save'), discard: () => {setDraft(baseline); setClear(false); setError('');}});
  return <div className={`startup-variable${dirty ? ' is-dirty' : ''}`} aria-label={label} aria-busy={busy}>
    <div className="startup-variable-heading">
      <label htmlFor={id}>{label}</label><code className="startup-variable-key">{variable.env_variable}</code>
      <div className="startup-badges">
        {!editable && <span className="badge">Read-only</span>}
        {dirty && <span className="startup-pending">Unsaved</span>}
      </div>
    </div>
    {variable.description && <p className="muted startup-description">{settingDescription(variable.description)}</p>}
    <div className="startup-control-row">
      {control.boolean ? <GameSwitch id={id} aria-label={label} checked={draft === '1' || draft === 'true'} disabled={!editable || busy} onCheckedChange={checked => {setDraft(control.options?.includes('true') ? String(checked) : checked ? '1' : '0'); setSuccess(''); setError('');}}/> : control.options ? <Select id={id} name={variable.env_variable} value={draft} disabled={!editable || busy} aria-describedby={problem ? `${id}-help` : undefined} onChange={event => { setDraft(event.target.value); setSuccess(''); setError(''); }}>
        {!control.options.includes(draft) && <option value={draft}>{draft || 'Choose a value'}</option>}
        {!control.required && draft !== '' && <option value="">Empty</option>}
        {control.options.map(option => <option key={option} value={option}>{control.boolean ? option === '1' ? 'Enabled' : 'Disabled' : option}</option>)}
      </Select> : <Input id={id} name={variable.env_variable} type={control.type} value={draft} disabled={!editable || busy || clear}
        min={control.min} max={control.max} step={control.step} minLength={control.minLength} maxLength={control.maxLength}
        required={control.required && !secret} autoComplete={secret ? 'new-password' : 'off'} spellCheck={false}
        placeholder={secret ? configured ? 'Configured. Leave blank to keep unchanged.' : 'Leave blank to keep unchanged.' : undefined}
        aria-describedby={problem ? `${id}-help` : undefined} aria-invalid={!!problem}
        onChange={event => { setDraft(event.target.value); setSuccess(''); setError(''); }} />}
    </div>
    {secret && editable && !control.required && configured !== false && <label className="startup-field-help"><input type="checkbox" checked={clear} disabled={busy} onChange={event => {setClear(event.target.checked); setDraft('');}}/> Clear saved value</label>}
    {problem && <p id={`${id}-help`} className="startup-validation" role="alert">{problem}</p>}
    {error && <p role="alert" className="error">{error}</p>}
    {success && <p role="status" className="success">{success}</p>}
    <details className="startup-field-details"><summary>Details</summary><p>Rules: {variable.rules || 'None'}</p><p>Default: {secret ? 'Hidden' : String(variable.default_value ?? '') || '(empty)'}</p></details>
  </div>;

}

function RuntimeImage({ base, image, images, permitted, customAllowed, onDirtyChange, onSaved }: {
  base: string; image: string; images: Record<string, string>; permitted: boolean; customAllowed: boolean; onDirtyChange: (dirty: boolean) => void; onSaved: (image: string) => void;
}) {
  const [draft, setDraft] = useState(image);
  const previous = useRef(image);
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  useEffect(() => { const oldImage = previous.current; setDraft(current => current === oldImage ? image : current); previous.current = image; }, [image]);
  const choices = Object.entries(images);
  const dirty = draft !== image;
  useEffect(() => {onDirtyChange(dirty); return () => onDirtyChange(false);}, [dirty, onDirtyChange]);
  return <section className="startup-advanced">
    <h3>Runtime image{dirty ? ' · Unsaved' : ''}</h3>
    <p className="muted">The container image applies next start. Saving does not reinstall the server.</p>
    <form aria-busy={busy} onSubmit={event => {
      event.preventDefault();
      if (!permitted || !dirty || !draft.trim() || locked.current) return;
      locked.current = true; setBusy(true); setError(''); setSuccess('');
      void api(`${base}/settings/docker-image`, json('PUT', { docker_image: draft })).then(() => {
        onSaved(draft); setSuccess('Runtime image saved. Applies next start.');
      }).catch(cause => setError(cause instanceof Error ? cause.message : 'Could not save the image.')).finally(() => { locked.current = false; setBusy(false); });
    }}>
      <label className="field"><span>Runtime image{!permitted ? ' · Read-only' : ''}</span>
        {customAllowed ? <Input value={draft} disabled={!permitted || busy} onChange={event => {setDraft(event.target.value); setSuccess('');}}/> : choices.length ? <Select value={draft} disabled={!permitted || busy} onChange={event => { setDraft(event.target.value); setSuccess(''); }}>
          {!choices.some(([, value]) => value === draft) && <option value={draft}>{draft || 'Choose an image'}</option>}
          {choices.map(([name, image]) => <option key={name} value={image}>{name} · {image}</option>)}
        </Select> : <Input value={draft} disabled={!permitted || busy} onChange={event => { setDraft(event.target.value); setSuccess(''); }} />}
      </label>
      {permitted && <div className="startup-field-actions"><Button type="submit" disabled={busy || !dirty || !draft.trim()}>{busy ? 'Saving...' : 'Save image'}</Button>{dirty && <Button variant="secondary" disabled={busy} onClick={() => setDraft(image)}>Discard draft</Button>}</div>}
    </form>
    <PageError error={error} />{success && <p className="success" role="status">{success}</p>}
  </section>;
}

type SettingsSection = 'game' | 'runtime';
type SettingsProps = {section: SettingsSection; administrator?: boolean; showCommandPreview?: boolean; runtimeCommand?: ReactNode; onDirtyChange?: (dirty: boolean) => void};

function StartupContent({section, administrator = false, showCommandPreview = true, runtimeCommand, onDirtyChange}: SettingsProps) {
  const { base, permissions, reload, server } = useServer();
  const permitted = can(permissions, 'startup.read');
  const query = useAPI(permitted ? `${base}/startup` : null);
  const [saved, setSaved] = useState<Record<string, StartupVariable>>({});
  const [savedMeta, setSavedMeta] = useState<StartupMeta | null>(null);
  const [savedImage, setSavedImage] = useState<string | null>(null);
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const onDirty = useRef((key: string, pending: boolean) => setDirty(current => current[key] === pending ? current : { ...current, [key]: pending })).current;
  const imageDirty = useRef((pending: boolean) => onDirty('__runtime_image', pending)).current;
  useEffect(() => { setSaved({}); setSavedMeta(null); }, [query.data]);
  const pending = Object.values(dirty).filter(Boolean).length;
  useEffect(() => { onDirtyChange?.(pending > 0); return () => onDirtyChange?.(false); }, [pending, onDirtyChange]);
  useEffect(() => { if (!pending) return; const warn = (event: BeforeUnloadEvent) => {event.preventDefault(); event.returnValue = '';}; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, [pending]);
  if (!permitted && section === 'game') return null;
  if (!permitted) return <section className="startup-settings games-ui"><h2>{section === 'game' ? 'Additional game options' : 'Runtime'}</h2><p>You do not have permission to view startup settings.</p></section>;
  if (!query.data) return <section className="startup-settings games-ui"><h2>{section === 'game' ? 'Additional game options' : 'Runtime'}</h2>{query.loading ? <p role="status">Loading startup settings...</p> : <><PageError error={query.error} /><Button variant="secondary" onClick={query.reload}>Retry</Button></>}</section>;
  const variables = (items(query.data) as StartupVariable[]).map(variable => saved[variable.env_variable] || variable).filter(variable => startupVariableSection(variable) === section);
  const meta: StartupMeta = { ...(query.data.meta || {}), ...savedMeta };
  const updateAllowed = can(permissions, 'startup.update');
  const imageAllowed = can(permissions, 'startup.docker-image');
  const licenceFields = new Set(['GAME_SERIAL', 'DLC_PRODUCT_KEY']);
  const renderVariable = (variable:StartupVariable) => <StartupVariableField key={variable.env_variable} variable={variable} permitted={updateAllowed} onDirty={onDirty} onSave={async payload => {
    const response = await api(`${base}/startup/variable`, json('PUT', payload));
    const updated = value(response) as StartupVariable;
    if (!updated || updated.env_variable !== variable.env_variable) throw new Error('The server did not confirm the saved setting. Reload startup settings to verify it.');
    setSaved(current => ({ ...current, [variable.env_variable]: updated }));
    if (response.meta) setSavedMeta(response.meta);
    return updated;
  }}/>;
  const OptionsGroup = section === 'runtime' ? 'section' : Card;
  const options = <>
    <OptionsGroup className="startup-variables"><h3>{section === 'game' ? 'Game options' : 'Installation & startup options'}</h3>
      {!variables.length && <p className="muted">No additional {section === 'game' ? 'game' : 'runtime'} options for this template.</p>}
      <div className="startup-variable-grid">{variables.filter(variable=>!licenceFields.has(variable.env_variable)).map(renderVariable)}</div>
    </OptionsGroup>
  </>;
  return <section className="startup-settings games-ui">
    <PageError error={query.error} />
    {section === 'runtime' ? <Card className="startup-runtime-card">
      {runtimeCommand}
      {showCommandPreview && <section className="startup-preview"><h3>Startup command</h3><p className="muted">Preview of saved settings. Secret values are hidden. Unsaved drafts are excluded.</p><pre>{commandPreview(meta, (items(query.data) as StartupVariable[]).map(variable => saved[variable.env_variable] || variable))}</pre></section>}
      {!meta.java_managed && <RuntimeImage base={base} image={savedImage ?? server.docker_image ?? server.image ?? ''} images={meta.docker_images || {}} permitted={imageAllowed} customAllowed={administrator} onDirtyChange={imageDirty} onSaved={image => { setSavedImage(image); reload(); }} />}
      <JavaSettings key={base} base={base} memoryMiB={server.limits?.memory ?? server.memory} canChangeRuntime={imageAllowed} onSaved={() => { query.reload(); reload(); }} />
      {options}
    </Card> : options}
  </section>;
}

export default function ServerStartup({section = 'runtime', administrator = false, showCommandPreview = true, runtimeCommand, onDirtyChange}: Partial<SettingsProps>) {
  const { base } = useServer();
  return <PendingSettings><StartupContent key={`${base}:${section}`} section={section} administrator={administrator} showCommandPreview={showCommandPreview} runtimeCommand={runtimeCommand} onDirtyChange={onDirtyChange} /></PendingSettings>;
}

