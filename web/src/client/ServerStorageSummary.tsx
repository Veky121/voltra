import {useAPI} from '../lib';
import {Card,CardHeader,CardTitle,CardContent} from '../components/ui/card';
import {Disclosure,DisclosureTrigger} from '../ui/Disclosure';
import {ResourceSummary,ResourceMetric} from '../ui/ResourceSummary';
import {formatBytesGB} from '../resourceUnits';
import {can,useServer} from './common';
import {useServerTelemetry} from './ServerDashboard';
import {reportedStorage} from './fileMetadata';
import {backupStorage,storageTotals,storageLimit} from './serverStorage';
import './serverStorage.css';

// Backups passes its existing paginated response; other pages use the existing
// live backup subscription. The API summary always covers every retained page.
export default function ServerStorageSummary({backupResponse,backupError='',compact=false,strip=false}:{backupResponse?:any;backupError?:string;compact?:boolean;strip?:boolean}) {
  const {server,permissions,base}=useServer(),telemetry=useServerTelemetry();
  const readable=can(permissions,'backup.read');
  const request=useAPI(readable&&backupResponse===undefined?`${base}/backups`:null);
  const error=backupResponse===undefined?request.error:backupError;
  const response=backupResponse===undefined?request.data:backupResponse;
  const backups=readable&&!error?backupStorage(response?.meta?.storage):null;
  const files=can(permissions,'control.console')?reportedStorage(telemetry.resources,telemetry.updated,telemetry.error):null;
  const totals=storageTotals(files,backups);
  const fileLimit=typeof server.limits?.disk==='number'?server.limits.disk*1024**2:undefined;
  const count=backups?response?.meta?.backup_count:undefined;
  const countLimit=server.feature_limits?.backups;
  const fileState=storageLimit(files,fileLimit),backupState=storageLimit(count,countLimit,'disabled');
  const size=(value:number|null)=>value===null?'Unavailable':formatBytesGB(value);
  if(strip)return <section className="file-storage-strip" aria-label="Storage usage"><ResourceSummary label="File storage">
    <ResourceMetric label="Files" value={<>{size(files)}{fileLimit!==undefined&&fileLimit>0&&<small> / {formatBytesGB(fileLimit)}</small>}</>} percent={fileState.percent} note={['warning','full'].includes(fileState.level)?<span className={`storage-limit storage-limit-${fileState.level}`}>{fileState.message}</span>:null}/>
    <ResourceMetric label="Backups" value={size(backups?.total_bytes??null)} percent={backupState.percent} note={<span className={`storage-limit storage-limit-${backupState.level}`}>{backups?`${count??'?'} / ${countLimit??'?'} slots${backupState.message?` \u00b7 ${backupState.message}`:''}`:!readable?'Access required':'Unavailable'}</span>}/>
    <ResourceMetric label="Total" value={size(totals.recorded)} note={totals.incomplete?'Incomplete backup sizes':null}/>
  </ResourceSummary></section>;
  if(compact)return <Card className="dashboard-panel shadcn-card storage-card" role="region" aria-label="Storage">
    <CardHeader className="dashboard-panel-heading"><CardTitle><div className="chart-heading"><h2>Storage</h2><p className="chart-reading"><strong>{size(totals.recorded)}</strong><span> total</span></p></div></CardTitle></CardHeader>
    <CardContent className="storage-card-body">
      <ResourceMetric label="Game files" value={<>{size(files)}{fileLimit!==undefined&&fileLimit>0&&<small> / {formatBytesGB(fileLimit)}</small>}</>} percent={fileState.percent}
        note={fileState.level==='normal'?null:<span className={`storage-limit storage-limit-${fileState.level}`}>{fileState.message}</span>}/>
      <ResourceMetric label="Panel backups" value={size(backups?.total_bytes??null)} percent={backupState.percent}
        note={backups?<><span className={`storage-limit storage-limit-${backupState.level}`}>{count??'?'} / {countLimit??'?'} slots{backupState.message?` · ${backupState.message}`:''}</span></>:<span>{!readable?'Backup access required.':error||response?'Backup sizes unavailable.':'Waiting for backup sizes.'}</span>}/>
      <Disclosure className="storage-card-details"><DisclosureTrigger>Details</DisclosureTrigger><div>
        <p>{backups?`${formatBytesGB(backups.local_bytes)} local backups, ${formatBytesGB(backups.remote_bytes)} remote${backups.other_bytes>0?`, ${formatBytesGB(backups.other_bytes)} other`: ''}.`:'Backup sizes unavailable.'}</p>
        <p>Game files include mods, worlds, logs and in-game saves. Panel backups are separate from the game-file limit.</p>
        {totals.local!==null&&<p>{formatBytesGB(totals.local)} in game files and local backups.</p>}
        {totals.incomplete&&<p>Sizes incomplete: {backups?.pending_count} in progress, {backups?.failed_count} failed. Total excludes unreported backup data.</p>}
        <p>Usage updates periodically. Host free space, external mounts and databases are not measured.</p>
      </div></Disclosure>
    </CardContent>
  </Card>;
  return <section className="server-storage-summary" aria-label="Storage breakdown">
    <ResourceSummary label="Server storage and backups">
      <ResourceMetric label="Game files" value={<>{size(files)}{fileLimit!==undefined&&fileLimit>0&&<small> / {formatBytesGB(fileLimit)}</small>}</>} percent={fileState.percent}
        note={<><span>Includes mods, worlds, logs and in-game saves in the server folder.</span><span className={`storage-limit storage-limit-${fileState.level}`}>{fileState.message}</span></>}/>
      <ResourceMetric label="Panel backups" value={size(backups?.total_bytes??null)} percent={backupState.percent}
        note={backups?<><span>{formatBytesGB(backups.local_bytes)} local · {formatBytesGB(backups.remote_bytes)} remote{backups.other_bytes>0?` · ${formatBytesGB(backups.other_bytes)} other`:''}</span><span>{count??'Unknown'} / {countLimit??'unknown'} backup slots</span><span className={`storage-limit storage-limit-${backupState.level}`}>{backupState.message}</span>{totals.incomplete&&<span>Sizes incomplete: {backups.pending_count} in progress, {backups.failed_count} failed.</span>}</>:<span>{!readable?'Backup access required.':error||response?'Backup sizes unavailable.':'Waiting for backup sizes.'}</span>}/>
      <ResourceMetric label="Recorded total" value={size(totals.recorded)}
        note={<><span>{totals.local!==null?`${formatBytesGB(totals.local)} in game files and local backups.`:'Game files plus panel backups.'}</span><span>Backups are separate from the game-file limit.{totals.incomplete?' Total excludes unreported backup data.':''}</span></>}/>
    </ResourceSummary>
    <p className="storage-scope-note">File usage updates periodically. Host free space, external mounts and databases are not measured here.</p>
  </section>;
}
