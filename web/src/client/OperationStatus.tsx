import {useEffect,useState} from 'react';
import {Progress} from '../components/ui/progress';
import {Button} from '../lib';
import {bytes as size} from './common';
import {operationMessages,operationPending,operationRecentlyActive,type OperationEvent} from './operationEvents';
import './operationStatus.css';

export function OperationReports({events,onDismiss}:{events:OperationEvent[];onDismiss:(id:string)=>void}) {
  const [clock,setClock]=useState(Date.now);
  useEffect(()=>{if(!events.some(e=>e.state==='queued'||e.state==='running'))return;const timer=setInterval(()=>setClock(Date.now()),15000);return()=>clearInterval(timer);},[events]);
  if(!events.length)return null;
  return <div className="operation-status-list" aria-label="Reported game operations">{events.map(event=>{
    const info=operationMessages[event.code], active=operationPending(event);
    const stale=active&&!operationRecentlyActive(event,Math.max(clock,Date.now()));
    const percent=event.total && event.bytes!==undefined?Math.min(100,event.bytes/event.total*100):null;
    return <div key={event.id} className="operation-status"><details>
      <summary><span>{info.message}</span><small>{stale?'No recent update':event.state==='completed'?'Completed':event.state==='failed'?'Failed':`Reported ${event.phase}`}{event.bytes!==undefined?` · ${size(event.bytes)}${event.total?` / ${size(event.total)}`:' received'}`:''}</small></summary>
      <div className="operation-status-details">
        {info.recovery&&event.state==='failed'&&<p>{info.recovery}</p>}
        {event.restart_required&&<p>Restart required to apply this change.</p>}
        {active&&<p>Last reported {new Date(event.at).toLocaleString()}. This report does not confirm that the game is ready.</p>}
        {active&&!event.total&&event.bytes!==undefined&&<p>The provider has not supplied a total size.</p>}
        <small>Reported by {event.source} · {event.code} · {event.id}</small>
        {!active&&<Button variant="secondary" onClick={()=>onDismiss(event.id)}>Dismiss</Button>}
      </div>
    </details>{active&&!stale&&<Progress aria-label={info.message} value={percent}/>}</div>;
  })}</div>;
}
