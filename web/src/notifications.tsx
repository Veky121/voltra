import './notifications.css';
import { createContext, isValidElement, useContext, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import {Bell,CheckCircle2,Info,TriangleAlert,X} from 'lucide-react';
import { createPortal } from 'react-dom';
import { notifications } from './notificationEvents';
import type { NotificationEvent, NotificationTone } from './notificationEvents';
export { notifications } from './notificationEvents';

export const FeedbackDialogContext = createContext<(() => void) | null>(null);
export function notify(message: string, tone: NotificationTone = 'info') {
  return notifications.publish({ message, tone });
}
function text(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(text).join(' ');
  if (isValidElement<{ children?: ReactNode }>(node)) return text(node.props.children);
  return '';
}
/** Adapter for state-based screens. Stable messages emit once, not on every poll. */
export function Feedback({ message, tone = 'info', title, eventKey, id: descriptionId }: {
  message?: ReactNode; tone?: NotificationTone; title?: string; eventKey?: string; id?: string;
}) {
  const content = text(message).replace(/\s+/g, ' ').trim();
  const key = eventKey ?? `feedback:${location.pathname}:${tone}:${content}`;
  const previousKey=useRef<string|undefined>(undefined);
  const close = useContext(FeedbackDialogContext);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if(previousKey.current&&previousKey.current!==key)notifications.resolve(previousKey.current);
    previousKey.current=key;
    if (!content) { notifications.resolve(key); return; }
    notifications.publish({ key, message: content, tone, title });
    if (tone === 'error') closeRef.current?.();
  }, [content, tone, title, key]);
  return descriptionId ? <span id={descriptionId} className="sr-only">{content}</span> : null;
}

function Island({ entry, pending, showHistory }: { entry: NotificationEvent; pending: number; showHistory: () => void }) {
  const bar = useRef<HTMLDivElement>(null);
  const paused = useRef(new Set<string>());
  useEffect(() => {
    const duration = Math.max(2000, entry.durationMs ?? (entry.tone === 'error' ? 12000 : 6500));
    let remaining = duration, previous = performance.now(), frame = 0;
    const visibility = () => {
      if (document.hidden) paused.current.add('hidden'); else paused.current.delete('hidden');
      previous = performance.now();
    };
    visibility();
    document.addEventListener('visibilitychange', visibility);
    const tick = (now: number) => {
      if (!paused.current.size) remaining -= now - previous;
      previous = now;
      if (bar.current) bar.current.style.transform = `scaleX(${Math.max(0, remaining / duration)})`;
      if (remaining <= 0) notifications.dismiss(entry.id); else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); document.removeEventListener('visibilitychange', visibility); };
  }, [entry.id, entry.revision, entry.durationMs, entry.tone]);
  return <section className={`notification notification-${entry.tone}`} tabIndex={0}
    aria-label="Notification. Hover, focus or hold to pause dismissal."
    onPointerEnter={event => { if (event.pointerType === 'mouse') paused.current.add('hover'); }}
    onPointerLeave={() => paused.current.delete('hover')}
    onPointerDown={event => { if ((event.target as HTMLElement).closest('button')) return; paused.current.add('hold'); event.currentTarget.setPointerCapture(event.pointerId); }}
    onPointerUp={() => paused.current.delete('hold')}
    onPointerCancel={() => paused.current.delete('hold')}
    onLostPointerCapture={() => paused.current.delete('hold')}
    onFocus={event => { if ((event.target as HTMLElement).matches(':focus-visible')) paused.current.add('focus'); }}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) paused.current.delete('focus'); }}>
    <span className="notification-icon" aria-hidden="true">{entry.tone === 'success' ? '✓' : entry.tone === 'info' ? 'i' : '!'}</span>
    <div className="notification-content" role={entry.tone === 'error' ? 'alert' : 'status'}>
      <strong>{entry.title}</strong><p>{entry.message}</p>
      {entry.progress !== undefined && <progress aria-label="Operation progress" value={Math.max(0, Math.min(1, entry.progress))} max={1} />}
    </div>
    <div className="notification-controls">
      <button type="button" className="notification-close" aria-label="Dismiss notification" onClick={() => notifications.dismiss(entry.id)}>×</button>
      {pending > 0 && <button type="button" className="notification-more" onClick={showHistory} aria-label={`${pending} more notifications`}>+{pending}</button>}
    </div>
    <div className="notification-track" aria-hidden="true"><div ref={bar} /></div>
  </section>;
}

export function Notifications() {
  const { events, activeId } = useSyncExternalStore(notifications.subscribe, notifications.getSnapshot);
  const [open, setOpen] = useState(false);
  const [container,setContainer] = useState<HTMLElement>(document.body);
  const layer=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const sync=()=>{
      const dialogs=Array.from(document.querySelectorAll<HTMLElement>('dialog[open],[role="dialog"][data-open],[role="alertdialog"][data-open]'));
      setContainer(dialogs.at(-1)??document.body);
    };
    sync();
    const observer=new MutationObserver(sync);
    observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['open','data-open']});
    return()=>observer.disconnect();
  },[]);
  useEffect(()=>{
    const element=layer.current;
    if(element&&typeof element.showPopover==='function'&&!element.matches(':popover-open'))element.showPopover();
  },[container]);
  useEffect(()=>{
    const clear=()=>{notifications.clear();setOpen(false)};
    window.addEventListener('panel-auth-changed',clear);
    window.addEventListener('desktop-session-rejected',clear);
    return()=>{window.removeEventListener('panel-auth-changed',clear);window.removeEventListener('desktop-session-rejected',clear)};
  },[]);
  const active = events.find(event => event.id === activeId);
  const pending = events.filter(event => !event.dismissed && event.id !== activeId).length;
  return <>
    {createPortal(<div ref={layer} popover="manual" className="notification-layer">
      {events.length>0&&<div className="notification-history"><button type="button" className="text-button" aria-label="Notification history" aria-expanded={open} onClick={() => setOpen(!open)}><Bell/> {events.length}</button></div>}
      {active && <Island key={active.id} entry={active} pending={pending} showHistory={() => setOpen(true)} />}
      {open && <section aria-label="Notification history" className="notification-history-panel">
        <div className="toolbar"><strong>Recent notifications</strong><button className="text-button" onClick={() => notifications.clear()}>Clear</button><button className="text-button" onClick={() => setOpen(false)}>Close</button></div>
        {!events.length && <p className="muted">No notifications this session.</p>}
        {[...events].reverse().map(entry => <div className="notification-history-item" key={entry.id}><strong>{entry.title}</strong><p className={entry.tone === 'error' ? 'danger' : ''}>{entry.message}</p><small className="muted">{entry.time} · {entry.path}</small></div>)}
      </section>}
    </div>, container)}
  </>;
}
