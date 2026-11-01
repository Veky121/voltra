import {useEffect,useState,type ReactNode} from 'react';
import {Link} from 'react-router-dom';
import {Button} from '../lib';
import {Progress} from '../components/ui/progress';
import {bytes,can} from './common';
import {RemoteTransferContext,useRemoteTransferQueue} from './useRemoteTransfers';
import {transferActive,transferRecentlyActive,transferProgress,type RemoteTransfer} from './remoteTransferModel';
import {OperationReports} from './OperationStatus';
import {operationPending,operationRecentlyActive} from './operationEvents';
import './serverTransfers.css';

const noChange=()=>{};
export function ServerTransfers({base,permissions,children}:{base:string;permissions:string[];children:ReactNode}) {
  const queue=useRemoteTransferQueue(base,permissions,noChange);
  return <RemoteTransferContext.Provider value={queue}>{children}{(can(permissions,'file.read')||can(permissions,'file.create')||can(permissions,'websocket.connect'))&&<TransferDock key={`${base}:${permissions.join(',')}`} base={base} queue={queue}/>}</RemoteTransferContext.Provider>;
}

function TransferDock({base,queue}:{base:string;queue:ReturnType<typeof useRemoteTransferQueue>}) {
  const [expanded,setExpanded]=useState(false),[dismissed,setDismissed]=useState<Set<string>>(()=>new Set());
  const [clock,setClock]=useState(Date.now);
  useEffect(()=>{if(!queue.operations.some(operationPending)&&!queue.transfers.some(transferActive))return;const timer=setInterval(()=>setClock(Date.now()),15000);return()=>clearInterval(timer)},[queue.operations,queue.transfers]);
  const visible=queue.transfers.filter(entry=>transferActive(entry)||!dismissed.has(entry.identifier));
  const operations=queue.operations.filter(entry=>operationPending(entry)||!dismissed.has(`operation:${entry.id}`));
  const active=visible.filter(entry=>transferRecentlyActive(entry,Math.max(clock,Date.now()))).length+operations.filter(entry=>operationRecentlyActive(entry,Math.max(clock,Date.now()))).length;
  const count=visible.length+operations.length;
  useEffect(()=>{if(active)setExpanded(true)},[active]);
  if(!count&&!queue.error)return null;
  const filesPath=`/server/${encodeURIComponent(base.split('/').pop()||'')}/files`;
  return <section className="server-transfer-dock" aria-label="Server transfers">
    <div className="server-transfer-heading">
      <Button variant="secondary" aria-expanded={expanded} aria-controls="server-transfer-list" onClick={()=>setExpanded(value=>!value)}>
        {active>0&&<span className="server-transfer-pulse" aria-hidden="true"/>}
        Transfers <span>{queue.error&&!count?'Progress unavailable':active?`${active} active`:`${count} recent`}</span><span>{expanded?'Hide':'Show'}</span>
      </Button>
      {(visible.some(entry=>!transferActive(entry))||operations.some(entry=>!operationPending(entry)))&&<Button variant="secondary" onClick={()=>setDismissed(current=>new Set([...current,...visible.filter(entry=>!transferActive(entry)).map(entry=>entry.identifier),...operations.filter(entry=>!operationPending(entry)).map(entry=>`operation:${entry.id}`)]))}>Clear finished</Button>}
    </div>
    {expanded&&<div id="server-transfer-list" className="server-transfer-list">
      <p className="server-transfer-help">Transfers and reported game tasks for this server, including other users. Server downloads continue when you change pages.</p>
      {queue.error&&<div className="server-transfer-refresh" role="status">Progress could not be refreshed. Values below may be out of date. <Button variant="secondary" onClick={()=>void queue.reload()}>Check again</Button></div>}
      {visible.map(entry=><TransferRow key={entry.identifier} entry={entry} clock={Math.max(clock,Date.now())} filesPath={filesPath} dismiss={()=>setDismissed(current=>new Set([...current,entry.identifier]))}/>)}
      <OperationReports events={operations} onDismiss={id=>setDismissed(current=>new Set([...current,`operation:${id}`]))}/>
    </div>}
  </section>;
}

function TransferRow({entry,clock,filesPath,dismiss}:{entry:RemoteTransfer;clock:number;filesPath:string;dismiss:()=>void}) {
  const percent=transferProgress(entry),active=transferActive(entry),recent=transferRecentlyActive(entry,clock);
  const labels={queued:'Queued',downloading:'Downloading',uploading:'Uploading',awaiting_save:'Awaiting save',saving:'Saving to server',extracting:'Extracting',complete:'Saved to server',failed:entry.kind==='upload'?'Upload failed':'Download failed'};
  const received=Number.isFinite(entry.received_bytes)&&entry.received_bytes!>=0?bytes(entry.received_bytes!):null;
  const total=entry.size_known&&Number.isFinite(entry.total_bytes)&&entry.total_bytes!>=0?bytes(entry.total_bytes!):null;
  return <article className={`server-transfer-row is-${entry.state}`}>
    <div className="server-transfer-title"><strong>{entry.name}</strong><span>{active&&!recent?'No recent update':labels[entry.state]}{percent!==null&&recent?` ${Math.floor(percent)}%`:''}</span></div>
    <div className="server-transfer-meta"><span>To {entry.directory}</span><span>{received?`${received}${total?` of ${total}`:' received'}`:total?`${total} total`:''}{!total&&active?' · Total size unavailable':''}</span></div>
    {recent&&<Progress className={percent===null?'server-transfer-indeterminate':''} value={percent} aria-label={`${labels[entry.state]} ${entry.name}`} />}
    {active&&!recent&&<small>Upload paused or disconnected. Resume it from Files.</small>}
    {entry.state==='queued'&&<small>Waiting for the node to begin the download.</small>}
    {entry.state==='awaiting_save'&&<small>All bytes received. Waiting for the uploader to finish saving the file.</small>}
    {entry.state==='failed'&&<p className="server-transfer-failure">{entry.error||'The node could not complete this download. Check the source and available disk space, then start it again from Files.'}</p>}
    {!active&&<div className="server-transfer-actions"><Link to={`${filesPath}?directory=${encodeURIComponent(entry.directory)}`}>{entry.state==='failed'?'Open Files to retry':'Open folder'}</Link><Button variant="secondary" onClick={dismiss}>Dismiss</Button></div>}
  </article>;
}
