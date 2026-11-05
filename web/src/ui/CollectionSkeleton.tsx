import {Skeleton} from '../components/ui/skeleton';
import {Card} from '../components/ui/card';
import './collectionSkeleton.css';
import '../client/backups.css';
import '../client/scheduleRows.css';
import '../client/operations-ui.css';

export type CollectionSkeletonLayout='rows'|'cards'|'files'|'schedules'|'users'|'databases'|'activity';
export function SkeletonLine({width=120,small=false}:{width?:number|string;small?:boolean}) {
  return <Skeleton className={`skeleton-line${small?' skeleton-line-small':''}`} style={{width,maxWidth:'100%'}}/>;
}
export function SkeletonControl({wide=false,tall=false}:{wide?:boolean;tall?:boolean}) {
  return <div className={`skeleton-control${wide?' skeleton-control-wide':''}${tall?' skeleton-control-tall':''}`}><SkeletonLine width={wide?'38%':48} small/></div>;
}
function BackupPlaceholder(){return <Card className="backup-card" aria-hidden="true">
  <div className="backup-card-heading"><div className="backup-card-title"><SkeletonLine width="64%"/><div className="backup-card-feedback"><SkeletonLine width="44%" small/></div></div><div className="backup-card-status"><SkeletonLine width={64} small/></div></div>
  <div className="backup-card-footer"><div className="backup-created"><span className="backup-meta-label">Created</span><time><SkeletonLine width={42}/><SkeletonLine width={112} small/></time></div><div className="backup-card-size"><span className="backup-meta-label">Size</span><SkeletonLine width={48}/></div><div className="backup-card-actions">{[0,1,2,3].map(i=><SkeletonControl key={i}/>)}</div></div>
</Card>}
function SchedulePlaceholder(){return <div className="schedule-entry" aria-hidden="true"><div className="schedule-line"><div className="schedule-open"><span className="schedule-icon"><SkeletonLine width={16}/></span><span className="schedule-identity"><SkeletonLine width={150}/><SkeletonLine width={72} small/></span><span className="schedule-when"><SkeletonLine width={110} small/></span><span className="schedule-state"><SkeletonLine width={48} small/></span><span className="schedule-arrow"/></div><div className="actions schedule-row-actions"><SkeletonControl/><SkeletonControl/><SkeletonControl/></div></div></div>}
function FilePlaceholder(){return <div className="file-skeleton-row" aria-hidden="true"><span className="file-skeleton-name"><Skeleton className="file-skeleton-check"/><Skeleton className="file-skeleton-icon"/><SkeletonLine width={156}/></span><span className="explorer-metadata"><span><SkeletonLine width={110} small/></span><span><SkeletonLine width={60} small/></span><span className="explorer-size"><SkeletonLine width={40} small/></span></span><span className="explorer-action-space"/></div>}

export function CollectionSkeleton({label='Loading',layout='rows',count=3}:{label?:string;layout?:CollectionSkeletonLayout;count?:number}){
  const list=Array.from({length:count},(_,i)=>i);
  return <div className={`collection-skeleton server-skeleton collection-skeleton-${layout}`} role="status" aria-label={label} aria-busy="true">
    <span className="button-feedback-sr">{label}</span>
    {layout==='cards'?<div className="backups-page"><div className="backup-cards">{list.map(i=><BackupPlaceholder key={i}/>)}</div></div>:
     layout==='schedules'?<div className="schedule-list">{list.map(i=><SchedulePlaceholder key={i}/>)}</div>:
     layout==='files'?list.map(i=><FilePlaceholder key={i}/>):
     layout==='users'?<div className="operations-page"><div className="grid grid-2">{list.map(i=><Card className="operations-record" key={i} aria-hidden="true"><h3><SkeletonLine width={138}/></h3><div className="skeleton-record-description"><SkeletonLine width="75%" small/></div><div className="actions operations-record-actions"><SkeletonControl/><SkeletonControl/></div></Card>)}</div></div>:
     layout==='databases'?<div className="grid grid-2">{list.map(i=><div className="settings-section" data-settings-section="" key={i} aria-hidden="true"><div className="settings-section-heading"><SkeletonLine width={130}/></div><Card className="settings-group" data-settings-group="">{['Host','Username','Connections from','Password'].map(name=><div className="settings-row" data-settings-row="" key={name}><div className="settings-row-layout"><span>{name}</span><SkeletonControl wide/></div></div>)}</Card></div>)}</div>:
     layout==='activity'?<div className="table-wrap operations-table" aria-hidden="true"><table className="table"><thead><tr>{['Event','Actor','IP address','When','Details'].map(name=><th key={name}>{name}</th>)}</tr></thead><tbody>{list.map(i=><tr key={i}>{[180,72,90,114,65].map((width,j)=><td key={j}><SkeletonLine width={width} small/>{j===0&&<SkeletonLine width={120} small/>}</td>)}</tr>)}</tbody></table></div>:
     <div className="skeleton-plain-list">{list.map(i=><div key={i} aria-hidden="true"><SkeletonLine width="40%"/><SkeletonLine width="26%" small/></div>)}</div>}
  </div>;
}
