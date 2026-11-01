import {Link} from 'react-router-dom';
import {useAPI,Button} from '../lib';
import {Disclosure,DisclosureTrigger} from '../ui/Disclosure';
import {ResourceSummary,ResourceMetric} from '../ui/ResourceSummary';
import {can,date,items,useServer,value} from './common';
import {managedSteamServer} from './gameSetupModel';
import {backupProtection} from './serverProtection';
import './serverInsights.css';

// Backup records live on Backups; the dashboard reads only installed software.
type BackupRequest={data:any;error:string;loading:boolean;reload:()=>void};
export default function ServerInsights({section='software',backupRequest,embedded=false}:{section?:'software'|'backups';backupRequest?:BackupRequest;embedded?:boolean}){
 const {base,permissions,server}=useServer();
 const backupRead=section==='backups'&&can(permissions,'backup.read'),scheduleRead=section==='backups'&&can(permissions,'schedule.read');
 const steamRead=!server.is_installing&&server.status!=='installing'&&section==='software'&&can(permissions,'startup.read')&&managedSteamServer(server);
 const backupFallback=useAPI(backupRead&&!backupRequest?`${base}/backups`:null);
 const backups=backupRequest||backupFallback;
 const schedules=useAPI(scheduleRead?`${base}/schedules?include=tasks`:null);
 const steam=useAPI(steamRead?`${base}/steam`:null);
 const latest=backups.error?null:backups.data?.meta?.storage?.latest_successful_backup;
 const protection=backupProtection(items(schedules.data));
 const software=steam.error?null:value(steam.data);
 const path=`/server/${encodeURIComponent(server.identifier||server.uuid)}`;
 if(!backupRead&&!scheduleRead&&!steamRead)return null;
 const metrics=<>
   {backupRead&&<ResourceMetric label="Last successful backup" value={backups.error?'Unavailable':backups.loading&&!backups.data?'Checking...':latest?date(latest.completed_at):'None recorded'} note={<><span>{latest?.name||''}</span></>}/>}
   {scheduleRead&&<ResourceMetric label="Scheduled backups" value={schedules.error?'Unavailable':schedules.loading&&!schedules.data?'Checking...':protection.count?`${protection.count} enabled`:'Off'} note={<><span>{!schedules.error&&protection.next?`Next: ${date(protection.next)}`:''}</span>{!schedules.error&&protection.onlineOnly&&<span>Only when online</span>}<Link to={`${path}/schedules`}>View schedules</Link></>}/>}
   {steamRead&&<ResourceMetric label="Installed Steam build" value={steam.error?'Unavailable':steam.loading&&!steam.data?'Checking...':software?.installed_build||'Not verified'} note={<><span>{software?.latest_build?`${software.update_available?'Update available':'Latest known build'}: ${software.latest_build}`:'Available build not checked.'}</span><span>{software?.last_checked_at?`Checked ${date(software.last_checked_at)}`:'No successful update check recorded.'}</span></>}/>}
 </>;
 if(embedded)return metrics;
 return <section className="server-insights" aria-label={section==='backups'?'Backup protection':'Installed software'}>
  <ResourceSummary label={section==='backups'?'Backup protection':'Installed software'}>
   {metrics}
  </ResourceSummary>
  <Disclosure><DisclosureTrigger>About these readings</DisclosureTrigger><div className="server-insights-detail"><p>{section==='backups'?'Backup status covers retained panel backups. Schedules can be enabled while runs fail.':'Steam build numbers come from maintenance records; configured game versions and loaders are not proof of installed files.'}</p><Button variant="secondary" disabled={backups.loading||schedules.loading||steam.loading} onClick={()=>{if(backupRead)backups.reload();if(scheduleRead)schedules.reload();if(steamRead)steam.reload()}}>Refresh records</Button><span>Refreshing records does not start a backup or an update check.</span></div></Disclosure>
 </section>;
}
