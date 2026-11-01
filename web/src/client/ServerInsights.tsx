import {Link} from 'react-router-dom';
import {useAPI,Button} from '../lib';
import {Disclosure,DisclosureTrigger} from '../ui/Disclosure';
import {ResourceSummary,ResourceMetric} from '../ui/ResourceSummary';
import {can,date,items,useServer,value} from './common';
import {managedSteamServer} from './gameSetupModel';
import {backupProtection} from './serverProtection';
import './serverInsights.css';

// Dashboard-only summaries reuse cached, permission-checked reads. No fan-out on fleet cards.
export default function ServerInsights(){
 const {base,permissions,server}=useServer();
 const backupRead=can(permissions,'backup.read'),scheduleRead=can(permissions,'schedule.read');
 const steamRead=can(permissions,'startup.read')&&managedSteamServer(server);
 const backups=useAPI(backupRead?`${base}/backups`:null);
 const schedules=useAPI(scheduleRead?`${base}/schedules?include=tasks`:null);
 const steam=useAPI(steamRead?`${base}/steam`:null);
 const latest=backups.error?null:backups.data?.meta?.storage?.latest_successful_backup;
 const protection=backupProtection(items(schedules.data));
 const software=steam.error?null:value(steam.data);
 const path=`/server/${encodeURIComponent(server.identifier||server.uuid)}`;
 if(!backupRead&&!scheduleRead&&!steamRead)return null;
 return <section className="server-insights" aria-label="Protection and installed software">
  <ResourceSummary label="Protection and installed software">
   {backupRead&&<ResourceMetric label="Latest successful backup" value={backups.error?'Unavailable':backups.loading&&!backups.data?'Checking...':latest?date(latest.completed_at):'None recorded'} note={<><span>{latest?.name||'Panel backups only. In-game saves are separate.'}</span><Link to={`${path}/backups`}>View backups</Link></>}/>}
   {scheduleRead&&<ResourceMetric label="Scheduled backups" value={schedules.error?'Unavailable':schedules.loading&&!schedules.data?'Checking...':protection.count?`${protection.count} enabled`:'Not enabled'} note={<><span>{!schedules.error&&protection.next?`Next run: ${date(protection.next)}`:'An enabled schedule does not confirm a successful backup.'}</span>{!schedules.error&&protection.onlineOnly&&<span>Runs only while the server is online.</span>}<Link to={`${path}/schedules`}>View schedules</Link></>}/>}
   {steamRead&&<ResourceMetric label="Installed Steam build" value={steam.error?'Unavailable':steam.loading&&!steam.data?'Checking...':software?.installed_build||'Not verified'} note={<><span>{software?.latest_build?`${software.update_available?'Update available':'Latest known build'}: ${software.latest_build}`:'Available build not checked.'}</span><span>{software?.last_checked_at?`Checked ${date(software.last_checked_at)}`:'No successful update check recorded.'}</span></>}/>}
  </ResourceSummary>
  <Disclosure><DisclosureTrigger>About these readings</DisclosureTrigger><div className="server-insights-detail"><p>Backup status covers retained panel backups. Schedules can be enabled while runs fail. Steam build numbers come from maintenance records; configured game versions and loaders are not proof of installed files.</p><Button variant="secondary" disabled={backups.loading||schedules.loading||steam.loading} onClick={()=>{if(backupRead)backups.reload();if(scheduleRead)schedules.reload();if(steamRead)steam.reload()}}>Refresh records</Button><span>Refreshing records does not start a backup or an update check.</span></div></Disclosure>
 </section>;
}
