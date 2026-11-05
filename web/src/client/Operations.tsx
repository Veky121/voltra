import {ReinstallServerButton} from './ReinstallServerButton';
import PortConnections from './PortConnections';
import {usePendingSetting} from './PendingSettings';
import {BackupOverview, backupDisplayName, backupOriginLabel, backupCreated} from './BackupOverview';
import {LockKeyhole} from 'lucide-react';
import './backups.css';
import './powerProgress.css';
import {confirmAction} from '../ui/ConfirmAction';
import { useEffect, useRef, useState, type ReactNode } from "react";
import { JavaSettings } from "./JavaSettings";
import {SettingsRow,SettingsSection} from '../ui/Settings';
import {Link} from 'react-router-dom';
import {
  api,
  useAPI,
  Button,
  Input,
  Textarea,
  Select,
  Field,
  Card,
  Modal,
} from "../lib";
import {
  bytes,
  can,
  Check,
  date,
  download,
  items,
  json,
  Notice,
  PageError,
  Pager,
  ServerPageTitle,
  useAction,
  useServer,
  value,
} from "./common";

function BackupStateBadge({pending,successful}:{pending:boolean;successful:boolean}) {
  const wasPending=useRef(pending);
  const [created,setCreated]=useState(false);
  useEffect(()=>{
    if(pending){wasPending.current=true;setCreated(false);return;}
    if(!wasPending.current)return;
    wasPending.current=false;
    if(!successful)return;
    setCreated(true);
    const timer=setTimeout(()=>setCreated(false),5000);
    return ()=>clearTimeout(timer);
  },[pending,successful]);
  const label=pending?'In progress':!successful?'Failed':created?'Created':'';
  return <span role="status" aria-hidden={!label} style={{visibility:label?'visible':'hidden'}}
    className={`badge ${pending?'operations-status-pending':!successful?'operations-status-error':'operations-status-success'}`}>{label||'Created'}</span>;
}

export function Backups() {
  const { base, permissions } = useServer();
  const [page, setPage] = useState(1);
  const r = useAPI(`${base}/backups?page=${page}&per_page=20`);
  const [activeAction,setActiveAction]=useState<{id:string;label:string}|null>(null);
  const [feedback,setFeedback]=useState<{id:string;message:string;failed:boolean}|null>(null);
  const a = useAction();
  const [open, setOpen] = useState(false),
    [name, setName] = useState(""),
    [ignored, setIgnored] = useState(""),
    [locked, setLocked] = useState(false),
    [restore, setRestore] = useState<any>(null),
    [truncate, setTruncate] = useState(false);
  useEffect(() => {
    const t = setInterval(r.reload, 10000);
    return () => clearInterval(t);
  }, [base, page]);
  useEffect(()=>{
    if(!feedback)return;
    const timer=setTimeout(()=>setFeedback(null),5000);
    return ()=>clearTimeout(timer);
  },[feedback]);
  const runBackup=(id:string,label:string,success:string,fn:()=>Promise<any>,done?:()=>void)=>a.run(async()=>{
    setActiveAction({id,label});
    setFeedback(null);
    try {
      const result=await fn();
      setFeedback({id,message:success,failed:false});
      done?.();
      return result;
    } catch(error) {
      setFeedback({id,message:error instanceof Error?error.message:'Action failed. Try again.',failed:true});
      throw error;
    } finally {
      setActiveAction(null);
    }
  });
  const perform = (id: string, action: string, body?: any, method = "POST") =>
    runBackup(id,action==='restore'?'Requesting restore...':action==='lock'?'Updating lock...':'Deleting backup...',
      action==='restore'?'Restore requested':action==='lock'?'Lock updated':'Backup deleted',
      ()=>api(`${base}/backups/${id}${action ? "/" + action : ""}`,json(method,body)),
      ()=>{r.reload();setRestore(null);if(method==='DELETE')a.setSuccess('Backup deleted.');});
  return (
    <section className="operations-page backups-page">
      <div className="toolbar server-page-toolbar">
        <div className="server-page-title"><h2>Backups</h2></div>
        {can(permissions, "backup.create") && (
          <Button onClick={() => setOpen(true)}>Create backup</Button>
        )}
      </div>
      <BackupOverview response={r.data} error={r.error}/>
      <PageError error={r.error} />
      {r.error && <Button variant="secondary" onClick={r.reload}>Retry</Button>}
      {r.loading && !r.data && <p role="status">Loading backups...</p>}
      <div className="backup-cards" role="list" aria-label="Backups">
        {items(r.data).map((b) => {
          const created=backupCreated(b.created_at);
          const active=activeAction?.id===b.uuid?activeAction:null;
          const result=feedback?.id===b.uuid?feedback:null;
          const pending=!b.completed_at;
          return <Card key={b.uuid} className="backup-card" role="listitem"
            data-backup-active={active||pending?'':undefined}
            data-backup-state={active?'action':pending?'creating':b.is_successful?'completed':'failed'}
            aria-busy={!!active||pending}>
            <div className="backup-card-heading">
              <div className="backup-card-title">
                <h3 title={backupDisplayName(b.name)}>{backupDisplayName(b.name)}</h3>
                <p className={`backup-card-feedback ${result?.failed?'backup-card-error':''}`} role="status" title={active?.label||result?.message||backupOriginLabel(b.origin)}>{active?.label||(pending?'Creating backup...':result?.message)||backupOriginLabel(b.origin)}</p>
              </div>
              <div className="backup-card-status">
                <span className="backup-lock-indicator" style={{visibility:b.is_locked?'visible':'hidden'}} aria-hidden={!b.is_locked}><LockKeyhole size={14} aria-hidden="true"/>Locked</span>
                <BackupStateBadge pending={pending} successful={!!b.is_successful}/>
              </div>
            </div>
            <div className="backup-card-footer">
              <div className="backup-created">
                <span className="backup-meta-label">Created</span>
                <time dateTime={b.created_at}><strong>{created.time}</strong><span>{created.date}</span></time>
              </div>
              <div className="backup-card-size"><span className="backup-meta-label">Size</span><strong>{b.completed_at?bytes(b.bytes):'Pending'}</strong></div>
              <div className="backup-card-actions">
                {can(permissions,'backup.download') && <Button variant="secondary" disabled={a.busy||!b.is_successful} onClick={()=>runBackup(b.uuid,'Preparing download...','Download started',()=>download(`${base}/backups/${b.uuid}/download`))}>Download</Button>}
                {can(permissions,'backup.restore') && <Button variant="secondary" disabled={a.busy||!b.is_successful} onClick={()=>{setRestore(b);setTruncate(false)}}>Restore</Button>}
                {can(permissions,'backup.delete') && <>
                  <Button variant="secondary" disabled={a.busy} onClick={()=>perform(b.uuid,'lock')}>{b.is_locked?'Unlock':'Lock'}</Button>
                  <Button variant="danger" disabled={a.busy||b.is_locked} onClick={async()=>{
                    if(await confirmAction({title:'Delete backup?',description:`Permanently delete backup ${b.name}?`,confirmLabel:'Delete',danger:true}))perform(b.uuid,'',undefined,'DELETE');
                  }}>Delete</Button>
                </>}
              </div>
            </div>
          </Card>;
        })}
      </div>
      {!r.loading && !r.error && !items(r.data).length && (
        <Card className="operations-empty">No backups have been created.</Card>
      )}
      <Pager data={r.data} page={page} setPage={setPage} />
      {open && (
        <Modal title="Create backup" onClose={() => setOpen(false)}>
          <Notice action={a} />
          <form
            onSubmit={(e) => {
              e.preventDefault();
              a.run(
                () =>
                  api(
                    `${base}/backups`,
                    json("POST", { name, ignored, is_locked: locked })
                  ),
                () => {
                  setOpen(false);
                  setName("");
                  r.reload();
                }
              );
            }}
          >
            <Field label="Name (optional)">
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field
              label="Ignored files"
              hint="One file or glob per line. Leave empty to use .pteroignore."
            >
              <Textarea
                rows={5}
                value={ignored}
                onChange={(e) => setIgnored(e.target.value)}
              />
            </Field>
            <Check
              label="Lock backup against deletion"
              checked={locked}
              onChange={setLocked}
            />
            <Button type="submit" disabled={a.busy}>
              Start backup
            </Button>
          </form>
        </Modal>
      )}
      {restore && (
        <Modal
          title={`Restore ${restore.name}`}
          onClose={() => setRestore(null)}
        >
          <Notice action={a} />
          <p className="operations-warning">
            The server will stop. Existing files may be overwritten by this
            backup.
          </p>
          <Check
            label="Delete all existing files before restoring"
            checked={truncate}
            onChange={setTruncate}
          />
          <Button
            variant="danger"
            disabled={a.busy}
            onClick={() => perform(restore.uuid, "restore", { truncate })}
          >
            Restore backup
          </Button>
        </Modal>
      )}
    </section>
  );
}

export function Network() {
 return <PortConnections/>;
}

function Variable({
  variable,
  onSave,
  busy,
  editable,
}: {
  variable: any;
  onSave: (key: string, val: string) => void;
  busy: boolean;
  editable: boolean;
}) {
  const [v, setV] = useState(
    String(
      variable.server_value ??
        variable.variable_value ??
        variable.default_value ??
        ""
    )
  );
  useEffect(
    () =>
      setV(
        String(
          variable.server_value ??
            variable.variable_value ??
            variable.default_value ??
            ""
        )
      ),
    [variable.server_value, variable.variable_value]
  );
  return (
    <Card>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave(variable.env_variable, v);
        }}
      >
        <Field
          label={variable.name || variable.env_variable}
          hint={variable.description}
        >
          <Input
            value={v}
            disabled={
              !editable ||
              (!variable.is_editable && variable.is_editable !== undefined) ||
              variable.user_editable === false
            }
            onChange={(e) => setV(e.target.value)}
          />
        </Field>
        <p className="muted">
          <code>{variable.env_variable}</code> · {variable.rules}
        </p>
        {editable &&
          variable.is_editable !== false &&
          variable.user_editable !== false && (
            <Button type="submit" disabled={busy}>
              Save variable
            </Button>
          )}
      </form>
    </Card>
  );
}
export function Startup() {
  const { base, permissions, reload, server } = useServer();
  const r = useAPI(`${base}/startup`);
  const a = useAction();
  const [image, setImage] = useState(server.docker_image || server.image || "");
  const meta = r.data?.meta || value(r.data) || {};
  const images = meta.docker_images || {};
  return (
    <section>
      <h2>Startup configuration</h2>
      {can(permissions, "startup.read") && (
        <JavaSettings key={base} base={base} memoryMiB={server.limits?.memory ?? server.memory} canChangeRuntime={can(permissions, "startup.docker-image")} onSaved={() => { r.reload(); reload(); }} />
      )}
      <Notice action={a} />
      <PageError error={r.error} />
      <Card>
        <h3>Startup command</h3>
        <pre>{meta.startup_command || server.invocation || server.startup}</pre>
        <p className="muted">Changes take effect when the server restarts.</p>
      </Card>
      {!meta.java_managed && <Card>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            a.run(
              () =>
                api(
                  `${base}/settings/docker-image`,
                  json("PUT", { docker_image: image })
                ),
              () => {
                r.reload();
                reload();
                a.setSuccess("Docker image updated.");
              }
            );
          }}
        >
          <Field label="Docker image">
            {Object.keys(images).length ? (
              <Select
                value={image}
                disabled={!can(permissions, "startup.docker-image")}
                onChange={(e) => setImage(e.target.value)}
              >
                {Object.entries(images).map(([name, v]) => (
                  <option key={String(v)} value={String(v)}>
                    {name} · {String(v)}
                  </option>
                ))}
              </Select>
            ) : (
              <Input
                value={image}
                disabled={!can(permissions, "startup.docker-image")}
                onChange={(e) => setImage(e.target.value)}
              />
            )}
          </Field>
          {can(permissions, "startup.docker-image") && (
            <Button type="submit" disabled={a.busy}>
              Change Docker image
            </Button>
          )}
        </form>
      </Card>}
      <div className="grid grid-2">
        {items(r.data).map((v) => (
          <Variable
            key={v.env_variable}
            variable={v}
            busy={a.busy}
            editable={can(permissions, "startup.update")}
            onSave={(key, val) =>
              a.run(
                () =>
                  api(
                    `${base}/startup/variable`,
                    json("PUT", { key, value: val })
                  ),
                () => {
                  r.reload();
                  a.setSuccess(`${key} updated.`);
                }
              )
            }
          />
        ))}
      </div>
    </section>
  );
}

export function Settings({details,showReinstall=true}:{details?:ReactNode;showReinstall?:boolean}={}) {
  const { base, server, permissions, reload } = useServer();
  const fs25 = Array.isArray(server.egg_features) && server.egg_features.includes('voltra_fs25');
  const account = useAPI("/api/client/account");
  const a = useAction();
  const [name, setName] = useState(server.name || ""),
    [description, setDescription] = useState(server.description || "");
  const user = value(account.data) || {};
  const sftp = server.sftp_details || {};
  const [saving,setSaving]=useState(false),[baseline,setBaseline]=useState({name:server.name||'',description:server.description||''});
  async function saveDetails(){
    setSaving(true);a.setError('');
    try{await api(`${base}/settings/rename`,json('POST',{name,description}));setBaseline({name,description})}
    catch(error){a.setError(error instanceof Error?error.message:String(error));throw error}finally{setSaving(false)}
  }
  usePendingSetting(`details:${base}`,!details&&(name!==baseline.name||description!==baseline.description),{blocked:saving||!name.trim()||!can(permissions,'settings.rename'),save:saveDetails,afterSave:reload,discard:()=>{setName(baseline.name);setDescription(baseline.description);a.setError('')}});
  return (
    <section className="operations-page settings-page server-general-settings">
      <Notice action={a} />
      <div className="server-general-grid">
        {details ?? <SettingsSection title="Panel details">
          <form
            onSubmit={e=>{e.preventDefault();void saveDetails().catch(()=>{})}}
          >
            <SettingsRow label="Panel name" description="Shown only in Voltra." control={
              <Input
                aria-label="Panel name"
                required
                disabled={!can(permissions, "settings.rename")}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            }/>
            <SettingsRow label="Description" control={
              <Textarea
                aria-label="Server description"
                disabled={!can(permissions, "settings.rename")}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            }/>
          </form>
        </SettingsSection>}
        <SettingsSection title="SFTP">
          <SettingsRow label="Address" control={
            <Input
              aria-label="SFTP address"
              readOnly
              value={`sftp://${sftp.ip || server.node}:${sftp.port || 2022}`}
            />
          }/>
          <SettingsRow label="Username" control={
            <Input
              aria-label="SFTP username"
              readOnly
              value={`${user.username || ""}.${server.__deprecated_uuid_short || server.uuid?.slice(0,8) || server.identifier || ""}`}
            />
          }/>
          <div className="settings-actions settings-actions--split"><span className="settings-note"><Link to="/account/sftp">Password</Link> · <Link to="/account/ssh">SSH keys</Link></span>
          {can(permissions, "file.sftp") && (
            <a
              className="button secondary"
              href={`sftp://${encodeURIComponent(
                `${user.username || ""}.${server.__deprecated_uuid_short || server.uuid?.slice(0,8) || server.identifier || ""}`
              )}@${sftp.ip || server.node}:${sftp.port || 2022}`}
            >
              Open client
            </a>
          )}
          </div>
        </SettingsSection>
        <SettingsSection title="Server information">
          <SettingsRow label="Node" control={<span className="settings-value">{server.node}</span>}/>
          <SettingsRow label="UUID" control={<Input aria-label="Server UUID" readOnly value={server.uuid || ""} />}/>
        </SettingsSection>
        {showReinstall && can(permissions, "settings.reinstall") && (
          <SettingsSection title="Reinstall">
            <SettingsRow label="Reinstall server" description={fs25 ? "Updates FS25 first, then DLCs. Keeps saves, mods, settings and licences." : "Stops the server and may overwrite files. Back up first."} control={
            <ReinstallServerButton server={server} permissions={permissions} onDone={reload}/>
            }/>
          </SettingsSection>
        )}
      </div>

    </section>
  );
}
