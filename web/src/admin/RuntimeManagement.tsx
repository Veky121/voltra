import {Feedback} from '../notifications';
import {useEffect, useState} from 'react';
import {api, Button, Field, Select, rows, useAPI} from '../lib';
import {Heading, ErrorMessage} from './shared';
import {SettingsRow, SettingsSection, Switch} from '../ui/Settings';
import {usePendingSetting} from '../client/PendingSettings';
import {useDiscardSettings} from '../client/PendingSettings';
import {confirmAction} from '../ui/ConfirmAction';
import {RefreshCw} from 'lucide-react';
import './runtime-management.css';

type ImageState = {reference:string; approved_id:string; candidate_id:string; previous_id:string; last_checked_at?:string; next_check_at?:string; error?:string; busy:boolean; schedule_enabled:boolean};
type ImageStatus = {version:number; check_interval_seconds:number; images:ImageState[]};
type SteamStatus = {supported:boolean; scope:string; helper_image:string; version:string; version_observed_at?:string; last_attempt_at?:string; last_checked_at?:string; next_check_at?:string; last_error?:string; busy:boolean; initialized:boolean; schedule_enabled:boolean; recovery_required:boolean};

function at(value?:string) {
  if (!value || value.startsWith('0001-')) return 'Not yet';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString(undefined, {month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'});
}
function shortID(value:string) { return value ? value.slice(0, 19) : 'None'; }
function checkable(ref:string) { return !ref.startsWith('~') && !ref.startsWith('sha256:') && !ref.includes('@sha256:'); }

export default function RuntimeManagement() {
  const nodes = useAPI('/api/admin/nodes');
  const [node, setNode] = useState('');
  const discard = useDiscardSettings();
  const list = nodes.data ? rows(nodes.data) : [];
  useEffect(() => {
    if (!nodes.data) return;
    if (!list.some(n => String(n.id) === node)) setNode(list.length ? String(list[0].id) : '');
  }, [nodes.data, node]);
  return <div className="admin-management-page management-ui runtime-management">
    <Heading title="Runtime management" />
    <ErrorMessage error={nodes.error} />
    {nodes.error && <Button variant="secondary" onClick={nodes.reload}>Retry nodes</Button>}
    <Field label="Node"><Select value={node} disabled={nodes.loading || !list.length} onChange={event => {const next=event.target.value; void discard().then(allowed=>{if(allowed)setNode(next)});}}>
      {!list.length && <option value="">{nodes.loading ? 'Loading nodes…' : 'No nodes available'}</option>}
      {list.map(n => <option key={n.id} value={String(n.id)}>{n.name}</option>)}
    </Select></Field>
    {node && <NodeRuntime key={node} node={node} name={String(list.find(n => String(n.id) === node)?.name || 'Node')} maintenance={Boolean(list.find(n => String(n.id) === node)?.maintenance_mode)} />}
  </div>;
}

function NodeRuntime({node, name, maintenance}:{node:string; name:string; maintenance:boolean}) {
  const base = `/api/admin/nodes/${node}/runtime`;
  const images = useAPI<ImageStatus>(`${base}/images`);
  const steam = useAPI<SteamStatus>(`${base}/steamcmd`);
  const [pending, setPending] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  // Poll only a healthy service; a disconnected node retains an explicit retry.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      if (!images.error) images.reload();
      if (!steam.error) steam.reload();
    }, 10000);
    return () => window.clearInterval(timer);
  }, [images.reload, steam.reload, images.error, steam.error]);
  useEffect(() => { if (!notice) return; const timer=window.setTimeout(()=>setNotice(''),8000); return()=>window.clearTimeout(timer); }, [notice]);

  async function act(kind:'images'|'steamcmd', action:string, image?:ImageState) {
    const expected = action === 'approve' ? image?.candidate_id : action === 'rollback' ? image?.previous_id : undefined;
    const label = action === 'approve' ? 'Approve image' : action === 'rollback' ? 'Roll back image' : kind === 'images' ? 'Check and download' : 'Check/update SteamCMD';
    const description = kind === 'steamcmd'
      ? `Check and update the SteamCMD metadata client on ${name}? ${steam.data?.initialized ? 'Your schedule setting is preserved.' : 'This enables daily client checks.'} Game installations and account sessions stay separate.`
      : action === 'check'
      ? `Check ${image?.reference} on ${name} and download any new image for review? This can use disk space and bandwidth.`
      : `Use ${shortID(expected || '')} for ${image?.reference} on ${name}? Future container creation will use this image. Running servers will not restart.`;
    if (!await confirmAction({title:label, description, confirmLabel:label})) return;
    setPending(`${kind}:${image?.reference || ''}`); setError(''); setNotice('');
    try {
      await api(`${base}/${kind}`, {method:'POST', body:JSON.stringify({action, ...(image ? {reference:image.reference} : {}), ...(expected ? {expected_id:expected} : {})})});
      setNotice(action === 'check' ? 'Check accepted. Refresh status to see its outcome.' : 'Image selection updated.');
      if (kind === 'images') images.reload(); else steam.reload();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setPending(''); }
  }

  const disabled = maintenance || !!pending;
  return <>
    {maintenance && <p className="muted">This node is in maintenance mode. Runtime changes are unavailable.</p>}
    <ErrorMessage error={error} />
    {notice && <><Feedback tone="warning" message={<>{notice}</>}/></>}
    <SettingsSection title="Container images" action={<Button variant="secondary" aria-label="Refresh images" title="Refresh images" disabled={images.loading} onClick={images.reload}><RefreshCw size={14} aria-hidden="true" /></Button>}>
      {images.error && <SettingsRow label="Images unavailable" control={null}><ErrorMessage error={images.error} /></SettingsRow>}
      {!images.data && images.loading && <SettingsRow label={<span role="status">Loading images…</span>} control={null} />}
      {images.data && <>
        {!images.data.images.length && <SettingsRow label="No images yet" description="Images appear after a server start or install." control={null} />}
        {images.data.images.map(image => <SettingsRow key={image.reference} label={image.reference} description={image.busy ? 'Checking…' : image.candidate_id && image.candidate_id !== image.approved_id ? 'Update ready to approve' : 'Approved'}
          info={<><p>Updates need approval. Running servers keep their current image.</p><p>Last check: {at(image.last_checked_at)} · Next: {image.schedule_enabled ? at(image.next_check_at) : 'Off'}</p><p>Approved: <code>{image.approved_id || 'None'}</code></p><p>Candidate: <code>{image.candidate_id || 'None'}</code></p><p>Previous: <code>{image.previous_id || 'None'}</code></p></>}
          infoLabel={`Image versions for ${image.reference}`}
          control={<div className="actions">
            {checkable(image.reference) && <Button variant="secondary" disabled={disabled || !!images.error || image.busy} onClick={()=>void act('images','check',image)}>Check updates</Button>}
            {!!image.candidate_id && image.candidate_id !== image.approved_id && <Button disabled={disabled || !!images.error || image.busy} onClick={()=>void act('images','approve',image)}>Approve</Button>}
            {!!image.previous_id && <Button variant="secondary" disabled={disabled || !!images.error || image.busy} onClick={()=>void act('images','rollback',image)}>Roll back</Button>}
          </div>}>
          {checkable(image.reference) && <ScheduleToggle endpoint={`${base}/images`} reference={image.reference} enabled={image.schedule_enabled} blocked={disabled || !!images.error || image.busy} reload={images.reload} />}
          <ErrorMessage error={image.error || ''} />
        </SettingsRow>)}
      </>}
    </SettingsSection>
    <SettingsSection title="SteamCMD" action={<Button variant="secondary" aria-label="Refresh SteamCMD" title="Refresh SteamCMD" disabled={steam.loading} onClick={steam.reload}><RefreshCw size={14} aria-hidden="true" /></Button>}>
      {steam.error && <SettingsRow label="SteamCMD unavailable" control={null}><ErrorMessage error={steam.error} /></SettingsRow>}
      {!steam.data && steam.loading && <SettingsRow label={<span role="status">Loading SteamCMD…</span>} control={null} />}
      {steam.data && <>
        <SettingsRow label={steam.data.version ? `Version ${steam.data.version}` : 'Not checked yet'} description={steam.data.busy ? 'Checking for updates…' : steam.data.last_checked_at ? `Checked ${at(steam.data.last_checked_at)}` : 'Run a check to get started.'}
          infoLabel="SteamCMD details"
          info={<><p>Checks update the shared SteamCMD client. Game files and logins stay separate.</p><p>Helper image: <code>{steam.data.helper_image}</code></p><p>Version observed: {at(steam.data.version_observed_at)} · Last attempt: {at(steam.data.last_attempt_at)}</p></>}
          control={<Button disabled={disabled || !!steam.error || !steam.data.supported || steam.data.busy} onClick={()=>void act('steamcmd','check')}>{steam.data.busy ? 'Checking…' : 'Check updates'}</Button>}>
          {steam.data.last_error && <ErrorMessage error={steam.data.last_error} />}
        </SettingsRow>
        <ScheduleToggle endpoint={`${base}/steamcmd`} enabled={steam.data.schedule_enabled} blocked={disabled || !!steam.error || !steam.data.supported || !steam.data.initialized || steam.data.recovery_required} reload={steam.reload} row description={steam.data.schedule_enabled ? `Next check ${at(steam.data.next_check_at)}` : undefined} />
      </>}
    </SettingsSection>
  </>;
}

function ScheduleToggle({endpoint,reference,enabled,blocked,reload,row=false,description}:{endpoint:string;reference?:string;enabled:boolean;blocked:boolean;reload:()=>void;row?:boolean;description?:string}) {
  const [draft,setDraft]=useState(enabled), [baseline,setBaseline]=useState(enabled), [saving,setSaving]=useState(false);
  const dirty=draft!==baseline;
  useEffect(()=>{if(!dirty){setDraft(enabled);setBaseline(enabled)}},[enabled]);
  usePendingSetting(`runtime-schedule:${endpoint}:${reference || 'metadata'}`,dirty,{
    blocked:blocked || saving,
    save:async()=>{setSaving(true);try{await api(endpoint,{method:'POST',body:JSON.stringify({action:'schedule',enabled:draft,...(reference?{reference}:{})})});setBaseline(draft)}finally{setSaving(false)}},
    discard:()=>{setDraft(enabled);setBaseline(enabled)},
    afterSave:reload,
  });
  const toggle=<Switch aria-label={reference ? `Daily checks for ${reference}` : 'Daily checks'} checked={draft} disabled={blocked || saving} onCheckedChange={setDraft} />;
  return row ? <SettingsRow label="Daily checks" description={description} control={toggle} /> : <label className="actions">{toggle}Daily checks</label>;
}
