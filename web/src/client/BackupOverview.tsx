import {Button,useAPI} from '../lib';
import {can,date,items,useServer} from './common';
import {backupProtection} from './serverProtection';
import {backupStorage} from './serverStorage';
import {formatBytesGB} from '../resourceUnits';

export function backupDisplayName(name:string) {
  return /^Scheduled backup \d+ at \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(name) ? 'Scheduled backup' : name;
}

export function backupOriginLabel(origin?:{type?:string;created_by?:string;schedule_name?:string}) {
  if(origin?.type==='manual')return origin.created_by?`Manual by ${origin.created_by}`:'Manual';
  if(origin?.type==='scheduled')return origin.schedule_name?`Scheduled: ${origin.schedule_name}`:'Scheduled';
  return 'Unknown origin';
}

export function backupCreated(value:string) {
  const created=new Date(value);
  if(!value||!Number.isFinite(created.getTime()))return {time:'Unknown time',date:'Unknown date'};
  return {
    time:created.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit',hourCycle:'h23'}),
    date:created.toLocaleDateString(undefined,{day:'numeric',month:'long',year:'numeric'}),
  };
}

export function BackupOverview({response,error}:{response:any;error:string}) {
  const {base,server,permissions}=useServer();
  const readable=can(permissions,'schedule.read');
  const schedules=useAPI(readable?`${base}/schedules?include=tasks`:null);
  const protection=backupProtection(items(schedules.data));
  const storage=!error?backupStorage(response?.meta?.storage):null;
  const count=!error?response?.meta?.backup_count:undefined;
  const limit=server.feature_limits?.backups;
  const full=typeof count==='number'&&typeof limit==='number'&&limit>0&&count>=limit;
  return <div className="backup-overview">
    <div className="backup-summary">
      <span>{typeof count==='number'?`${count}${typeof limit==='number'?` / ${limit}`:''} backups`:error?'Usage unavailable':'Loading usage…'}</span>
      {storage && <span>{formatBytesGB(storage.total_bytes)}{storage.pending_count>0||storage.failed_count>0?' recorded':''}</span>}
      {readable && <>
        <span>{schedules.error?'Schedule unavailable':!schedules.data?'Loading schedule…':protection.next?`Next backup: ${date(protection.next)}`:protection.count?'Next backup pending':'No scheduled backups'}</span>
        {!schedules.error&&protection.onlineOnly&&<span>Only when online</span>}
        {schedules.error&&<Button variant="secondary" onClick={schedules.reload}>Retry schedules</Button>}
      </>}
    </div>
    {limit===0 && <p className="backup-limit-note">Backups are disabled for this server.</p>}
    {full && <p className="backup-limit-note">Backup limit reached. Delete an unlocked backup to create one manually.{readable&&!schedules.error&&protection.count>0?' Scheduled backups replace the oldest unlocked backup.':''}</p>}
  </div>;
}
