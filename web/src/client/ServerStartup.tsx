import {GameSwitch} from './GameSwitch';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { api, Button, Card, Input, Select, useAPI } from '../lib';
import { can, items, json, PageError, useServer, value } from './common';
import { JavaSettings } from './JavaSettings';
import { commandPreview, secretVariable, variableCanReset, variableControl, variableEditable, variableProblem, variableValue, variableWrite, startupVariableSection } from './startupSettingsModel';
import type { StartupMeta, StartupVariable, VariableIntent, VariableWrite } from './startupSettingsModel';
import './startupSettings.css';

function FS25Forwarding({base}: {base: string}) {
 const [message,setMessage] = useState('');
 const [busy,setBusy] = useState(false);
 return <div><Button disabled={busy} onClick={async () => { setBusy(true); try { const result = await api(`${base}/startup/fs25-forward`,{method:'POST'}); const routes = result.attributes.forwarding.routes || []; setMessage(routes.map((route: any) => route.public_host ? `${route.public_host}:${route.public_port} (${route.status})` : route.detail).join(' ? ')); } catch { setMessage('Could not configure forwarding. Check the node gateway setup and your network permissions.'); } finally { setBusy(false); } }}>Forward web dashboard</Button>{message && <p role="status">{message}</p>}</div>;
}

type VariableProps = {
  variable: StartupVariable;
  permitted: boolean;
  onSave: (payload: VariableWrite) => Promise<StartupVariable>;
  onDirty: (key: string, dirty: boolean) => void;
};

export function StartupVariableField({ variable, permitted, onSave, onDirty }: VariableProps) {
  const { base } = useServer();
  const [revealed, setRevealed] = useState<string | null>(null);
  useEffect(() => { setRevealed(null); }, [base, variable.env_variable]);
  const baseline = variableValue(variable);
  const previous = useRef(baseline);
  const [draft, setDraft] = useState(baseline);
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const secret = secretVariable(variable);
  const editable = variableEditable(variable, permitted);
  const control = variableControl(variable);
  const dirty = secret ? draft.length > 0 : draft !== baseline;
  const problem = dirty ? variableProblem(variable, draft) : '';
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
      setRevealed(null);
      setDraft(variableValue(saved));
      setSuccess(intent === 'reset' ? 'Template default restored. Applies next start.' : 'Saved. Applies next start.');
    } catch (cause) {
      // Validation responses can echo submitted values. Keep secret errors value-free.
      setError(secret ? 'Could not save this secret. Check its rules and your permissions, then retry.' : cause instanceof Error ? cause.message : 'Could not save this setting.');
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }

  return <form className={`startup-variable${dirty ? ' is-dirty' : ''}`} aria-label={label} aria-busy={busy} onSubmit={event => { event.preventDefault(); void save('save'); }}>
    <div className="startup-variable-heading">
      <label htmlFor={id}>{label}</label>
      <div className="startup-badges">
        <span className="badge">{editable ? 'Editable' : 'Read-only'}</span>
        {variable.is_overridden !== undefined && <span className="badge">{variable.is_overridden ? 'Server override' : 'Template default'}</span>}
        {dirty && <span className="startup-pending">Unsaved</span>}
      </div>
    </div>
    {variable.description && <p className="muted startup-description" id={`${id}-description`}>{variable.description}</p>}
    <div className="startup-control-row">
      {control.boolean ? <GameSwitch id={id} aria-label={label} checked={draft === '1' || draft === 'true'} disabled={!editable || busy} onCheckedChange={checked => {setDraft(control.options?.includes('true') ? String(checked) : checked ? '1' : '0'); setSuccess(''); setError('');}}/> : control.options ? <Select id={id} name={variable.env_variable} value={draft} disabled={!editable || busy} aria-describedby={`${id}-help`} onChange={event => { setDraft(event.target.value); setSuccess(''); setError(''); }}>
        {!control.options.includes(draft) && <option value={draft}>{draft || 'Choose a value'}</option>}
        {!control.required && draft !== '' && <option value="">Empty</option>}
        {control.options.map(option => <option key={option} value={option}>{control.boolean ? option === '1' ? 'Enabled' : 'Disabled' : option}</option>)}
      </Select> : <Input id={id} name={variable.env_variable} type={control.type} value={draft} disabled={!editable || busy}
        min={control.min} max={control.max} step={control.step} minLength={control.minLength} maxLength={control.maxLength}
        required={control.required && !secret} autoComplete={secret ? 'new-password' : 'off'} spellCheck={false}
        placeholder={secret ? configured ? 'Configured. Leave blank to keep unchanged.' : 'Leave blank to keep unchanged.' : undefined}
        aria-describedby={`${id}-help${variable.description ? ` ${id}-description` : ''}`} aria-invalid={!!problem}
        onChange={event => { setDraft(event.target.value); setSuccess(''); setError(''); }} />}
      {secret && permitted && <Button variant="secondary" disabled={busy} onClick={async () => { if (revealed !== null) { setRevealed(null); return; } try { const result = await api(`${base}/startup/variable/${encodeURIComponent(variable.env_variable)}/reveal`); setRevealed(String(result.attributes.value)); } catch { setError("Could not show this value. Check your permissions."); } }}>{revealed === null ? "Show saved value" : "Hide saved value"}</Button>}
      {editable && <Button type="submit" disabled={busy || !dirty || !!problem}>{busy ? 'Saving...' : secret ? 'Save value' : 'Save'}</Button>}
    </div>
    {revealed !== null && <output aria-label={`${label} saved value`}>{revealed || "(empty)"}</output>}
    <div id={`${id}-help`} className="startup-field-help muted">
      {secret ? <span>Value hidden{configured !== undefined ? configured ? ' · Configured' : ' · Not configured' : ''}. Blank leaves it unchanged.</span>
        : <span>Template default: <code>{String(variable.default_value ?? '') || '(empty)'}</code></span>}
      {problem && <span className="startup-validation">{problem}</span>}
    </div>
    {editable && <div className="startup-field-actions">
      {dirty && <Button variant="secondary" disabled={busy} onClick={() => { setDraft(baseline); setError(''); setSuccess(''); }}>Discard draft</Button>}
      {secret && !control.required && configured !== false && <Button variant="secondary" disabled={busy} onClick={() => { void save('clear'); }}>Clear value</Button>}
      {variableCanReset(variable) && <Button variant="secondary" disabled={busy} onClick={() => { void save('reset'); }}>Reset to template default</Button>}
    </div>}
    {error && <p role="alert" className="error">{error}</p>}
    {success && <p role="status" className="success">{success}</p>}
    <details className="startup-field-details"><summary>Field details</summary><p><code>{variable.env_variable}</code></p><p className="muted">Validation rules: {secret ? 'Checked by the server. Secret rule values are hidden.' : variable.rules || 'No additional rules.'}</p></details>
  </form>;
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
  const farming = ['WEB_PASSWORD', 'WEB_PORT', 'GAME_PASSWORD'].every(key => (items(query.data) as StartupVariable[]).some(variable => variable.env_variable === key));
  const licenceFields = new Set(['GAME_SERIAL','DLC_PRODUCT_KEY','AUTO_DOWNLOAD','DOWNLOAD_DLC']);
  const renderVariable = (variable:StartupVariable) => <StartupVariableField key={variable.env_variable} variable={variable} permitted={updateAllowed} onDirty={onDirty} onSave={async payload => {
    const response = await api(`${base}/startup/variable`, json('PUT', payload));
    const updated = value(response) as StartupVariable;
    if (!updated || updated.env_variable !== variable.env_variable) throw new Error('The server did not confirm the saved setting. Reload startup settings to verify it.');
    setSaved(current => ({ ...current, [variable.env_variable]: updated }));
    if (response.meta) setSavedMeta(response.meta);
    query.reload();
    return updated;
  }}/>;
  const OptionsGroup = section === 'runtime' ? 'section' : Card;
  const options = <>
    {farming && section === 'game' && can(permissions, 'allocation.update') && <FS25Forwarding base={base}/>}
    {farming && <OptionsGroup className="startup-variables"><h3>Game licence and DLC</h3><p className="muted">Game and DLC licences are supplied by the administrator. Contact your administrator to add or change a DLC licence.</p><div className="startup-variable-grid">{variables.filter(variable=>licenceFields.has(variable.env_variable)&&!['GAME_SERIAL','DLC_PRODUCT_KEY'].includes(variable.env_variable)).map(renderVariable)}</div></OptionsGroup>}
    <OptionsGroup className="startup-variables"><h3>{section === 'game' ? 'Game options' : 'Installation & startup options'}</h3>
      {!variables.length && <p className="muted">No additional {section === 'game' ? 'game' : 'runtime'} options for this template.</p>}
      <div className="startup-variable-grid">{variables.filter(variable=>!farming || !licenceFields.has(variable.env_variable)).map(renderVariable)}</div>
    </OptionsGroup>
  </>;
  return <section className="startup-settings games-ui">
    {section === 'game' && <header className="startup-heading"><div><h2>Additional game options</h2><p className="muted">Saved changes apply the next time the server starts. Saving does not restart or reinstall it.</p></div></header>}
    <PageError error={query.error} />
    {section === 'game' && <div className="startup-save-note" role="status">{pending ? `${pending} unsaved ${pending === 1 ? 'field' : 'fields'}. Save each field separately.` : 'Each field saves separately.'}{!updateAllowed && ' You have read-only access to variables.'}</div>}
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
  return <StartupContent key={`${base}:${section}`} section={section} administrator={administrator} showCommandPreview={showCommandPreview} runtimeCommand={runtimeCommand} onDirtyChange={onDirtyChange} />;
}

