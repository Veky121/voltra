import {Feedback} from '../notifications';
import type {ReactNode} from 'react';
import {useAPI} from '../lib';
import {Card,CardHeader,CardTitle,CardContent} from '../components/ui/card';
import {ResourceSummary,ResourceMetric} from '../ui/ResourceSummary';
import {formatBytesGB} from '../resourceUnits';
import {can,useServer} from './common';
import {useServerTelemetry} from './ServerDashboard';
import {reportedStorage} from './fileMetadata';
import {backupStorage,storageTotals,storageLimit} from './serverStorage';
import './serverStorage.css';

// Backups passes its existing paginated response; other pages use the existing
// live backup subscription. The API summary always covers every retained page.
export default function ServerStorageSummary({backupResponse,backupError='',compact=false,strip=false,extra}:{extra?:ReactNode;backupResponse?:any;backupError?:string;compact?:boolean;strip?:boolean}) {
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
  const totalLabel=totals.recorded===null?'Storage breakdown unavailable':`Files ${size(files)}, backups ${size(backups?.total_bytes??null)}. Share of recorded storage, not capacity.`;
  const totalMeter=<div className="resource-meter storage-total-meter" role="img" aria-label={totalLabel} title={totalLabel}>{totals.recorded!==null&&totals.recorded>0&&<><span className="storage-total-files" style={{width:`${files!/totals.recorded*100}%`}}/><span className="storage-total-backups" style={{flex:1}}/></>}</div>;

  if(strip)return <section className="file-storage-strip" aria-label="Storage usage"><ResourceSummary label="File storage">
    <ResourceMetric label="Files" value={<>{size(files)}{fileLimit!==undefined&&fileLimit>0&&<small> / {formatBytesGB(fileLimit)}</small>}</>} percent={fileState.percent} note={['warning','full'].includes(fileState.level)?<Feedback title="File storage" tone="warning" message={fileState.message}/>:null}/>
    <ResourceMetric label="Backups" value={size(backups?.total_bytes??null)} percent={backupState.percent} note={<span className={`storage-limit storage-limit-${backupState.level}`}>{backups?`${count??'?'} / ${countLimit??'?'} slots${backupState.message?` \u00b7 ${backupState.message}`:''}`:!readable?'Access required':'Unavailable'}</span>}/>
    <ResourceMetric label="Total" value={size(totals.recorded)} meter={totalMeter} note={totals.incomplete?'Incomplete backup sizes':null}/>
  </ResourceSummary></section>;
  if(compact)return <Card className="dashboard-panel shadcn-card storage-card" role="region" aria-label="Storage">
    <CardHeader className="dashboard-panel-heading"><CardTitle><div className="chart-heading"><h2>Storage</h2><p className="chart-reading"><strong>{size(totals.recorded)}</strong><span> total</span></p></div></CardTitle></CardHeader>
    <CardContent className="storage-card-body">
      <ResourceMetric label="Game files" value={<>{size(files)}{fileLimit!==undefined&&fileLimit>0&&<small> / {formatBytesGB(fileLimit)}</small>}</>} percent={fileState.percent}
        note={fileState.level==='normal'?null:<Feedback title="File storage" tone="warning" message={fileState.message}/>}/>
      <ResourceMetric label="Backups" value={size(backups?.total_bytes??null)} percent={backupState.percent}
        note={backups?<><span className={`storage-limit storage-limit-${backupState.level}`}>{count??'?'} / {countLimit??'?'} slots{backupState.message?` · ${backupState.message}`:''}</span></>:<span>{!readable?'Backup access required.':error||response?'Backup sizes unavailable.':'Waiting for backup sizes.'}</span>}/>
    </CardContent>
  </Card>;
  return <section className="server-storage-summary" aria-label="Storage breakdown">
    <ResourceSummary label="Server storage and backups">
      <ResourceMetric label="Game files" value={<>{size(files)}{fileLimit!==undefined&&fileLimit>0&&<small> / {formatBytesGB(fileLimit)}</small>}</>} percent={fileState.percent}
        note={<><Feedback title="File storage" tone="warning" message={fileState.message}/></>}/>
      <ResourceMetric label="Backups" value={size(backups?.total_bytes??null)} percent={backupState.percent}
        note={backups?<><span>{formatBytesGB(backups.local_bytes)} local · {formatBytesGB(backups.remote_bytes)} remote{backups.other_bytes>0?` · ${formatBytesGB(backups.other_bytes)} other`:''}</span><span>{count??'Unknown'} / {countLimit??'unknown'} slots</span><Feedback title="Backup storage" tone="warning" message={backupState.message}/>{totals.incomplete&&<span>Sizes incomplete: {backups.pending_count} in progress, {backups.failed_count} failed.</span>}</>:<span>{!readable?'Backup access required.':error||response?'Backup sizes unavailable.':'Waiting for backup sizes.'}</span>}/>
      <ResourceMetric label="Total" value={size(totals.recorded)} meter={totalMeter}
        note={totals.incomplete?'Partial total ? some backup sizes unavailable':'Files + backups'}/>

      {extra}
    </ResourceSummary>

  </section>;
}
