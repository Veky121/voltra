import {Skeleton} from '../components/ui/skeleton';
import {CollectionSkeleton,SkeletonLine,SkeletonControl,type CollectionSkeletonLayout} from './CollectionSkeleton';
import {SettingsSkeleton} from './SettingsSkeleton';
import './serverPageSkeleton.css';
import './sectionTabs.css';
import '../client/serverPageHeader.css';
import '../client/serverAdminTools.css';
import '../client/fileWorkspace.css';
import '../client/fileManager.css';
import '../client/fileMetadata.css';

export function TextPanelSkeleton({label='Loading console'}:{label?:string}) {
  return <div className="text-panel-skeleton server-skeleton" role="status" aria-label={label} aria-busy="true"><span className="button-feedback-sr">{label}</span><div aria-hidden="true">{[64,42,78,53,69,36].map((width,index)=><Skeleton key={index} style={{width:`${width}%`}}/>)}</div></div>;
}
const runtimeTabs=[['general','General'],['network','Network'],['runtime','Startup'],['limits','Resources'],['mounts','Mounts'],['configuration','Advanced'],['manage','Transfer']];
export function ServerPageSkeleton({path}:{path:string}) {
  const url=new URL(path,'http://panel.local');
  const section=url.pathname.replace(/^\/server\/[^/]+\/?/,'').split('/')[0];
  const runtime=['runtime','admin-tools'].includes(section);
  const settings=runtime||['settings','startup','network','quick-setup','steam'].includes(section);
  const tab=url.searchParams.get('tab')||'general';
  if(!section||section==='console')return <TextPanelSkeleton/>;
  if(settings)return <div className="server-admin-tools settings-responsive server-skeleton">
    <div className="section-tabs server-settings-tabs" aria-hidden="true" inert>{(runtime?runtimeTabs:[[section,section==='steam'?'Updates & repair':'Game Config']]).map(([id,name])=><span key={id} className={`section-tab${(runtime?tab===id:true)?' active':''}`}>{name}</span>)}</div>
    <SettingsSkeleton variant={runtime&&tab==='general'?'general':'rows'} title={runtime&&tab!=='general'?runtimeTabs.find(([id])=>id===tab)?.[1]:undefined}/>
  </div>;
  if(section==='files')return <section className="fm-workspace server-skeleton">
    <div className="fm-storage" aria-hidden="true"><span>Storage</span><SkeletonLine width={130} small/><span><SkeletonLine width={140} small/></span></div>
    <header className="fm-heading server-page-toolbar" aria-hidden="true"><div className="fm-actions">{['Refresh','New folder','New file','Upload files','Upload folder','From URL'].map(name=><span key={name} className="skeleton-action-label">{name}</span>)}</div></header>
    <aside className="file-explorer has-metadata"><div className="file-explorer-header" aria-hidden="true"><span>Explorer</span></div><div className="file-explorer-search" aria-hidden="true"><SkeletonControl wide/></div><div className="file-explorer-tree"><div className="explorer-columns" aria-hidden="true"><span>Name</span><span className="explorer-metadata"><span>Date modified</span><span>Type</span><span className="explorer-size">Size</span></span><span className="explorer-action-space"/></div><div className="file-skeleton-root" aria-hidden="true">/ home / container</div><CollectionSkeleton layout="files" label="Loading files" count={6}/></div></aside>
  </section>;
  const title=section==='backups'?'Backups':section==='schedules'?'Schedules':section==='users'?'Server users':section==='activity'?'Activity':section==='content'?'Mods & plugins':'Databases';
  const layout:CollectionSkeletonLayout=section==='backups'?'cards':section==='schedules'?'schedules':section==='users'?'users':section==='activity'?'activity':section==='databases'?'databases':'rows';
  return <section className={`operations-page ${section==='backups'?'backups-page':''} server-skeleton`}>
    <div className="toolbar server-page-toolbar" aria-hidden="true"><h2>{title}</h2>{section!=='activity'&&<SkeletonControl/>}{section!=='backups'&&<SkeletonControl/>}</div>
    {section==='backups'&&<div className="backup-overview" aria-hidden="true"><div className="backup-summary"><SkeletonLine width={100} small/><SkeletonLine width={70} small/><SkeletonLine width={145} small/></div></div>}
    {section==='activity'&&<div className="toolbar operations-filters" aria-hidden="true"><SkeletonControl/><SkeletonControl/></div>}
    <CollectionSkeleton label={`Loading ${title.toLowerCase()}`} layout={layout} count={layout==='cards'||layout==='users'?2:3}/>
  </section>;
}
