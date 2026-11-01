import {createContext,useContext,useEffect,useState,useSyncExternalStore,type ReactNode} from 'react';
import {Link} from 'react-router-dom';
import {Bell,Download,Trash2,X,CheckCircle2,AlertCircle} from 'lucide-react';
import {Button} from '../components/ui/button';
import {IconButton} from '../ui/IconButton';
import {Sheet,SheetContent,SheetHeader,SheetTitle,SheetDescription} from '../components/ui/sheet';
import {Toaster,toast} from '../components/ui/toast';
import {notificationSnapshot,subscribeNotifications,observeNotifications,markNotificationsRead,dismissNotification,clearNotifications,exportNotificationLog} from './store';
import './notifications.css';

const NotificationContext=createContext(()=>{});
export function NotificationBell(){
 const open=useContext(NotificationContext),entries=useSyncExternalStore(subscribeNotifications,notificationSnapshot,notificationSnapshot);
 const unread=entries.filter(e=>!e.read).length;
 const label=unread?`Notifications, ${unread} unread`:'Notifications';
 return <IconButton className="notification-bell" onClick={open} title={label} aria-label={label}><Bell/>{unread>0&&<span className="notification-unread" aria-hidden="true"/>}</IconButton>;
}
export function NotificationLayer({children}:{children:ReactNode}){
 const [open,setOpen]=useState(false),entries=useSyncExternalStore(subscribeNotifications,notificationSnapshot,notificationSnapshot);
 useEffect(()=>observeNotifications(event=>{
  if(event.kind==='clear'){toast.close();setOpen(false);return}
  if(event.kind!=='add'||open)return;
  const item=event.entry;
  toast.add({id:item.id,type:'error',title:item.title,description:item.message.slice(0,220),timeout:6000,actionProps:{children:'View',onClick:()=>{setOpen(true);toast.close(item.id)}}});
 }),[open]);
 useEffect(()=>{if(open)toast.close()},[open]);
 useEffect(()=>{if(open&&entries.some(e=>!e.read))markNotificationsRead()},[open,entries]);
 function download(){
  const url=URL.createObjectURL(new Blob([exportNotificationLog()],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download='voltra-errors.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 return <NotificationContext.Provider value={()=>setOpen(true)}><Toaster limit={3} timeout={6000}>{children}
  <Sheet open={open} onOpenChange={setOpen}><SheetContent className="notification-history">
   <SheetHeader><SheetTitle>Notifications</SheetTitle><SheetDescription>Errors from this session. Kept as you move between pages.</SheetDescription></SheetHeader>
   <div className="notification-toolbar"><span>{entries.length} {entries.length===1?'issue':'issues'}</span><Button variant="outline" disabled={!entries.length} onClick={download}><Download/>Export log</Button><Button variant="ghost" disabled={!entries.length} onClick={clearNotifications}><Trash2/>Clear all</Button></div>
   <div className="notification-list">{!entries.length?<p className="notification-empty">No errors recorded.</p>:entries.map(entry=><article key={entry.id} className="notification-entry" data-notification-id={entry.id}>
    <div className="notification-entry-title">{entry.resolved?<CheckCircle2 className="notification-resolved"/>:<AlertCircle className="notification-error"/>}<strong>{entry.title}</strong><Button variant="ghost" size="icon-sm" aria-label="Dismiss notification" onClick={()=>{dismissNotification(entry.id);toast.close(entry.id)}}><X/></Button></div>
    <p className="notification-message">{entry.message}</p>
    <div className="notification-meta"><time dateTime={new Date(entry.lastAt).toISOString()} title={new Date(entry.firstAt).toLocaleString()}>{new Date(entry.lastAt).toLocaleTimeString()}</time><span>{entry.source.split('/').pop()?.replace(/\.(tsx?|jsx?)$/,'').replace(/([a-z])([A-Z])/g,'$1 $2')}</span>{entry.count>1&&<span>{entry.count} occurrences</span>}{entry.resolved&&<span>Recovered</span>}</div>
    {entry.page&&<Link to={entry.page} onClick={()=>setOpen(false)}>Open {entry.page==='/'?'overview':entry.page.replace(/^\//,'')}</Link>}
    {entry.endpoint&&<details><summary>Request details</summary><code>{entry.method} {entry.endpoint}{entry.status?` · ${entry.status}`:''}</code></details>}
   </article>)}</div>
  </SheetContent></Sheet>
 </Toaster></NotificationContext.Provider>;
}
