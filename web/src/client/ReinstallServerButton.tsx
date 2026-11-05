import {useEffect,useRef,useState} from 'react';
import {api,Button,Modal,useAPI} from '../lib';
import {can,Check,Notice,json,useAction,value} from './common';
import {reinstallWithBackup} from './reinstall';
export function ReinstallServerButton({server:record,permissions=['*'],onDone}:{server:any;permissions?:string[];onDone:()=>void}){
 const base=`/api/client/servers/${record.uuid||record.identifier||record.id}`;
  const [reinstallOpen, setReinstallOpen] = useState(false);
  const [backupFirst, setBackupFirst] = useState(true);
  const [reinstallStage, setReinstallStage] = useState('');
  const reinstallAbort = useRef<AbortController | null>(null);
  useEffect(() => () => {reinstallAbort.current?.abort();}, [base]);


 const r=useAPI(reinstallOpen?base:null);
 const server={...record,...value(r.data)};
 const fs25=Array.isArray(server.egg_features)&&server.egg_features.includes('voltra_fs25');
 const a=useAction();
 return <>            <Button
              variant="danger"
              disabled={a.busy}
              onClick={() => {setBackupFirst(true);setReinstallStage('');a.setError('');setReinstallOpen(true);}}
            >
              Reinstall server
            </Button>      {reinstallOpen && <Modal title={`Reinstall ${server.name}?`} onClose={() => {if(reinstallStage === 'Requesting reinstall?')return;reinstallAbort.current?.abort();setReinstallOpen(false);}}>
        <Notice action={a}/>
        {r.loading ? <p role="status">Loading backup options...</p> : <><p>{fs25 ? 'Stops the server, updates FS25 first, then enabled DLCs. Starts the server automatically after the updates finish.' : 'Stops the server and runs its installation script, which may overwrite files.'}</p>
        <Check label={fs25 ? "Back up saves, settings and licences" : "Create a backup before reinstalling"} checked={backupFirst} onChange={setBackupFirst} disabled={a.busy}/>
        {backupFirst && <p className="settings-note">{fs25 ? "Includes current saves, player data, settings and licences. Excludes game files, mods, DLCs, caches and old save backups." : "Backs up server files using the existing backup exclusions."} Saved in Backups as Reinstall Backup with the date and time.</p>}
        {backupFirst && !can(permissions, 'backup.create') && <p role="alert">You do not have permission to create backups. Ask the server owner, or switch off the backup option to continue without one.</p>}
        {backupFirst && can(permissions, 'backup.create') && !can(permissions, 'backup.read') && <p role="alert">You need permission to view backups so Voltra can confirm the backup succeeded.</p>}
        </>}
        {reinstallStage && <p role="status" aria-live="polite">{reinstallStage}</p>}
        <div className="settings-actions">
          <Button variant="secondary" disabled={reinstallStage === 'Requesting reinstall?'} onClick={() => {reinstallAbort.current?.abort();setReinstallOpen(false);}}>{a.busy ? 'Cancel reinstall' : 'Cancel'}</Button>
          <Button variant="danger" disabled={a.busy || r.loading || !!r.error || (backupFirst && (!can(permissions,'backup.create') || !can(permissions,'backup.read')))} onClick={() => {
            const controller = new AbortController(); reinstallAbort.current = controller;
            void a.run(() => reinstallWithBackup(backupFirst, {
              signal: controller.signal,
              stage: setReinstallStage,
              wait: () => new Promise(resolve => setTimeout(resolve, 2000)),
              createBackup: async name => value(await api(`${base}/backups`, json('POST', {name, ...(fs25 ? {scope:'reinstall_data'} : {})}))),
              readBackup: async uuid => value(await api(`${base}/backups/${uuid}`)),
              reinstall: uuid => api(`${base}/settings/reinstall`, json('POST', {create_backup: backupFirst, backup_uuid: uuid})),
            }), () => {setReinstallOpen(false);onDone();a.setSuccess('Reinstallation requested.');}).finally(() => setReinstallStage(''));
          }}>{a.busy ? 'Please wait...' : backupFirst ? 'Back up and reinstall' : 'Reinstall without backup'}</Button>
        </div>
      </Modal>}</>;
}
