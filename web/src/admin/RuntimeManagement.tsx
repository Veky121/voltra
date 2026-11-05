import {useEffect, useState} from 'react';
import {api, Button, Field, Select, rows, useAPI} from '../lib';
import {Heading, ErrorMessage} from './shared';
import {SettingsRow, SettingsSection, Switch} from '../ui/Settings';
import {usePendingSetting} from '../client/PendingSettings';
import {useDiscardSettings} from '../client/PendingSettings';
import {confirmAction} from '../ui/ConfirmAction';

type ImageState = {reference:string; approved_id:string; candidate_id:string; previous_id:string; last_checked_at?:string; next_check_at?:string; error?:string; busy:boolean; schedule_enabled:boolean};
type ImageStatus = {version:number; check_interval_seconds:number; images:ImageState[]};
type SteamStatus = {supported:boolean; scope:string; helper_image:string; version:string; version_observed_at?:string; last_attempt_at?:string; last_checked_at?:string; next_check_at?:string; last_error?:string; busy:boolean; initialized:boolean; schedule_enabled:boolean; recovery_required:boolean};

function at(value?:string) {
  if (!value || value.startsWith('0001-')) return 'Not yet';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString();
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
  return <div className="admin-management-page management-ui">
    <Heading title="Runtime management" />
    <p className="muted">Manage cached container images and SteamCMD on each node.</p>
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
    {maintenance && <p role="status">This node is in maintenance mode. Runtime changes are unavailable.</p>}
    <ErrorMessage error={error} />
    {notice && <p role="status">{notice}</p>}
    <SettingsSection title="Container images" action={<Button variant="secondary" disabled={images.loading} onClick={images.reload}>Refresh images</Button>}>
      <ErrorMessage error={images.error} />
      {!images.data && images.loading && <p role="status">Loading image status…</p>}
      {images.data && <>
        <p className="muted">Enabled checks run daily and stage updates for approval. Cached starts use the approved image. Previous versions are kept for rollback.</p>
        {!images.data.images.length && <p>No managed images yet. Images appear when this node prepares a server or installer.</p>}
        {images.data.images.map(image => <SettingsRow key={image.reference} label={image.reference} description={image.busy ? 'Image operation in progress.' : image.candidate_id && image.candidate_id !== image.approved_id ? 'Downloaded update ready for review.' : 'Approved image selected.'}
          info={<><p>Approved: <code>{image.approved_id || 'None'}</code></p><p>Candidate: <code>{image.candidate_id || 'None'}</code></p><p>Previous: <code>{image.previous_id || 'None'}</code></p></>}
          infoLabel={`Image versions for ${image.reference}`}
          control={<div className="actions">
            <Button variant="secondary" disabled={disabled || !!images.error || image.busy || !checkable(image.reference)} onClick={()=>void act('images','check',image)}>Check and download</Button>
            <Button disabled={disabled || !!images.error || image.busy || !image.candidate_id || image.candidate_id === image.approved_id} onClick={()=>void act('images','approve',image)}>Approve</Button>
            <Button variant="secondary" disabled={disabled || !!images.error || image.busy || !image.previous_id} onClick={()=>void act('images','rollback',image)}>Roll back</Button>
          </div>}>
          <p className="muted">Last successful check: {at(image.last_checked_at)} · Next check: {image.schedule_enabled ? at(image.next_check_at) : 'Disabled'}</p>
          {checkable(image.reference) ? <ScheduleToggle endpoint={`${base}/images`} reference={image.reference} enabled={image.schedule_enabled} blocked={disabled || !!images.error || image.busy} reload={images.reload} /> : <p className="muted">This image is pinned or local. Automatic update checks are unavailable.</p>}
          <ErrorMessage error={image.error || ''} />
        </SettingsRow>)}
      </>}
    </SettingsSection>
    <SettingsSection title="SteamCMD" action={<Button variant="secondary" disabled={steam.loading} onClick={steam.reload}>Refresh SteamCMD</Button>}>
      <ErrorMessage error={steam.error} />
      {!steam.data && steam.loading && <p role="status">Loading SteamCMD status…</p>}
      {steam.data && <SettingsRow label="Metadata client" description={steam.data.busy ? 'SteamCMD check/update in progress.' : `Last observed client version: ${steam.data.version || 'Not yet observed'}.`}
        info={<><p>This is the shared metadata client. Game maintenance keeps separate caches and account sessions. The first check enables daily checks. SteamCMD may update itself during those checks.</p><p>Helper image: <code>{steam.data.helper_image}</code></p><p>Version observed: {at(steam.data.version_observed_at)}</p><p>Last attempt: {at(steam.data.last_attempt_at)}</p></>}
        control={<Button disabled={disabled || !!steam.error || !steam.data.supported || steam.data.busy} onClick={()=>void act('steamcmd','check')}>Check/update now</Button>}>
        <p className="muted">Last successful check: {at(steam.data.last_checked_at)} · Next check: {steam.data.schedule_enabled ? at(steam.data.next_check_at) : 'Disabled'}</p>
        <ScheduleToggle endpoint={`${base}/steamcmd`} enabled={steam.data.schedule_enabled} blocked={disabled || !!steam.error || !steam.data.supported || !steam.data.initialized || steam.data.recovery_required} reload={steam.reload} />
        <ErrorMessage error={steam.data.last_error || ''} />
      </SettingsRow>}
    </SettingsSection>
  </>;
}

function ScheduleToggle({endpoint,reference,enabled,blocked,reload}:{endpoint:string;reference?:string;enabled:boolean;blocked:boolean;reload:()=>void}) {
  const [draft,setDraft]=useState(enabled), [baseline,setBaseline]=useState(enabled), [saving,setSaving]=useState(false);
  const dirty=draft!==baseline;
  useEffect(()=>{if(!dirty){setDraft(enabled);setBaseline(enabled)}},[enabled]);
  usePendingSetting(`runtime-schedule:${endpoint}:${reference || 'metadata'}`,dirty,{
    blocked:blocked || saving,
    save:async()=>{setSaving(true);try{await api(endpoint,{method:'POST',body:JSON.stringify({action:'schedule',enabled:draft,...(reference?{reference}:{})})});setBaseline(draft)}finally{setSaving(false)}},
    discard:()=>{setDraft(enabled);setBaseline(enabled)},
    afterSave:reload,
  });
  return <label className="actions"><Switch checked={draft} disabled={blocked || saving} onCheckedChange={setDraft} />Daily checks</label>;
}
