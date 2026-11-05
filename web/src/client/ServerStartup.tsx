import {Feedback} from '../notifications';
import {SettingsSkeleton} from '../ui/SettingsSkeleton';
import {Checkbox} from '../components/ui/checkbox';
import {SettingsSection as PreferenceSection, SettingsRow} from '../ui/Settings';
import {settingDescription} from './settingDescription';
import {PendingSettings, usePendingSetting} from './PendingSettings';
import {GameSwitch} from './GameSwitch';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { api, Button, Input, Select, useAPI } from '../lib';
import { can, items, json, PageError, useServer, value } from './common';
import { JavaSettings } from './JavaSettings';
import { commandPreview, secretVariable, variableCanReset, variableControl, variableEditable, variableProblem, variableValue, variableWrite, startupVariableSection } from './startupSettingsModel';
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
  const [reset, setReset] = useState(false);
  const secret = secretVariable(variable);
  const editable = variableEditable(variable, permitted);
  const control = variableControl(variable);
  const dirty = reset || clear || (secret ? draft.length > 0 : draft !== baseline);
  const problem = dirty && !clear && !reset ? variableProblem(variable, draft) : '';
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
      setDraft(variableValue(saved)); setClear(false); setReset(false);

    } catch (cause) {
      // Validation responses can echo submitted values. Keep secret errors value-free.
      setError(secret ? 'Could not save this value.' : cause instanceof Error ? cause.message : 'Could not save this setting.');
      throw cause;
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }

  usePendingSetting(variable.env_variable, dirty, {summary:label, applies:'Next start',blocked: !!problem || !editable || busy, save: () => save(reset ? 'reset' : clear ? 'clear' : 'save'), discard: () => {setDraft(baseline); setClear(false); setReset(false); setError('');}});
  return <SettingsRow className={`startup-variable${dirty ? ' is-dirty' : ''}`} aria-label={label} aria-busy={busy} label={<span className="startup-variable-heading">
      <label htmlFor={id}>{label}</label>
      <span className="startup-badges">
        {!editable && <span className="badge">Read-only</span>}
        {dirty && <span className="startup-pending">Unsaved</span>}
      </span>
    </span>} description={variable.description ? settingDescription(variable.description) : undefined} control={<>
      {control.boolean ? <GameSwitch id={id} aria-label={label} checked={draft === '1' || draft === 'true'} disabled={!editable || busy || reset} onCheckedChange={checked => {setDraft(control.options?.includes('true') ? String(checked) : checked ? '1' : '0'); setSuccess(''); setError('');}}/> : control.options ? <Select id={id} name={variable.env_variable} value={draft} disabled={!editable || busy || reset} aria-describedby={problem ? `${id}-help` : undefined} onChange={event => { setDraft(event.target.value); setSuccess(''); setError(''); }}>
        {!control.options.includes(draft) && <option value={draft}>{draft || 'Choose a value'}</option>}
        {!control.required && draft !== '' && <option value="">Empty</option>}
        {control.options.map(option => <option key={option} value={option}>{control.boolean ? option === '1' ? 'Enabled' : 'Disabled' : option}</option>)}
      </Select> : <Input id={id} name={variable.env_variable} type={control.type} value={draft} disabled={!editable || busy || clear || reset}
        min={control.min} max={control.max} step={control.step} minLength={control.minLength} maxLength={control.maxLength}
        required={control.required && !secret} autoComplete={secret ? 'new-password' : 'off'} spellCheck={false}
        placeholder={secret ? configured ? 'Saved. Leave blank to keep.' : 'Not configured' : undefined}
        aria-describedby={problem ? `${id}-help` : undefined} aria-invalid={!!problem}
        onChange={event => { setDraft(event.target.value); setSuccess(''); setError(''); }} />}
      {secret && editable && !control.required && configured !== false && <label className="startup-field-help"><Checkbox checked={clear} disabled={busy} onCheckedChange={checked => {setClear(checked); setDraft('');}}/> Clear saved value</label>}
    </>}>
    {(reset || clear || problem || error || success) ? <>
    {reset && <p role="status" className="startup-field-help">Reset pending. Save to use the template default.</p>}
    {clear && <p role="status" className="startup-field-help">Saved value will be cleared on save.</p>}
    {problem && <Feedback tone="error" id={`${id}-help`} message={<>{problem}</>}/>}
    {error && <Feedback tone="error" message={<>{error}</>}/>}
    {success && <Feedback tone="success" message={<>{success}</>}/>}
    </> : null}
  </SettingsRow>;

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
  const [savedImage,setSavedImage]=useState(image);
  const dirty = draft !== savedImage;
  useEffect(() => {onDirtyChange(dirty); return () => onDirtyChange(false);}, [dirty, onDirtyChange]);
  async function saveImage(){
    if(!permitted||!dirty||!draft.trim()||locked.current)return;
    locked.current=true;setBusy(true);setError('');setSuccess('');
    try{await api(`${base}/settings/docker-image`,json('PUT',{docker_image:draft}));setSavedImage(draft);setSuccess('Saved. Applies on the next start.')}
    catch(error){setError(error instanceof Error?error.message:String(error));throw error}finally{locked.current=false;setBusy(false)}
  }
  usePendingSetting(`image:${base}`,dirty,{summary:'Runtime image',applies:'Next start',blocked:busy||!permitted||!draft.trim(),save:saveImage,afterSave:()=>onSaved(draft),discard:()=>{setDraft(savedImage);setError('')}});
  return <PreferenceSection title="Runtime image" className="startup-advanced">
    <p className="settings-section-note">Applies on the next start. Saving does not reinstall.</p>
    <form aria-busy={busy} onSubmit={event=>{event.preventDefault();void saveImage().catch(()=>{})}}>
      <label className="field"><span>Runtime image{!permitted ? ' · Read-only' : ''}</span>
        {customAllowed ? <Input value={draft} disabled={!permitted || busy} onChange={event => {setDraft(event.target.value); setSuccess('');}}/> : choices.length ? <Select value={draft} disabled={!permitted || busy} onChange={event => { setDraft(event.target.value); setSuccess(''); }}>
          {!choices.some(([, value]) => value === draft) && <option value={draft}>{draft || 'Choose an image'}</option>}
          {choices.map(([name, image]) => <option key={name} value={image}>{name} · {image}</option>)}
        </Select> : <Input value={draft} disabled={!permitted || busy} onChange={event => { setDraft(event.target.value); setSuccess(''); }} />}
      </label>

    </form>
    <PageError error={error} />{success && <Feedback tone="success" message={<>{success}</>}/>}
  </PreferenceSection>;
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
  if (!query.data) return <section className="startup-settings games-ui"><h2>{section === 'game' ? 'Additional game options' : 'Runtime'}</h2>{query.loading ? <SettingsSkeleton label="Loading startup settings"/> : <><PageError error={query.error} /><Button variant="secondary" onClick={query.reload}>Retry</Button></>}</section>;
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
  const visibleVariables = variables.filter(variable=>!licenceFields.has(variable.env_variable));
  const options = visibleVariables.length ? <>
    <PreferenceSection className="startup-variables" title={section === 'game' ? 'Game options' : 'Installation & startup options'}>
      <div className="game-properties-grid">{visibleVariables.map(renderVariable)}</div>
    </PreferenceSection>
  </> : null;
  return <section className="startup-settings games-ui">
    <PageError error={query.error} />
    {section === 'runtime' ? <div className="startup-runtime-sections">
      {runtimeCommand}
      {showCommandPreview && <PreferenceSection title="Startup command" className="startup-preview"><p className="settings-section-note">Saved settings only. Secret values are hidden.</p><pre>{commandPreview(meta, (items(query.data) as StartupVariable[]).map(variable => saved[variable.env_variable] || variable))}</pre></PreferenceSection>}
      {!meta.java_managed && <RuntimeImage base={base} image={savedImage ?? server.docker_image ?? server.image ?? ''} images={meta.docker_images || {}} permitted={imageAllowed} customAllowed={administrator} onDirtyChange={imageDirty} onSaved={image => { setSavedImage(image); reload(); }} />}
      <JavaSettings key={base} base={base} memoryMiB={server.limits?.memory ?? server.memory} canChangeRuntime={imageAllowed} onSaved={() => { query.reload(); reload(); }} />
      {options}
    </div> : options}
  </section>;
}

export default function ServerStartup({section = 'runtime', administrator = false, showCommandPreview = true, runtimeCommand, onDirtyChange}: Partial<SettingsProps>) {
  const { base } = useServer();
  return <PendingSettings><StartupContent key={`${base}:${section}`} section={section} administrator={administrator} showCommandPreview={showCommandPreview} runtimeCommand={runtimeCommand} onDirtyChange={onDirtyChange} /></PendingSettings>;
}

