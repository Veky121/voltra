import {useErrorState} from '../notifications/useErrorState';
import {saveSettingChanges} from './saveSettingChanges';
import {createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode} from 'react';
import {Button} from '../lib';
import './startupSettings.css';
import {useBlocker} from 'react-router-dom';
import {confirmAction} from '../ui/ConfirmAction';

type Change = {blocked: boolean; save: () => Promise<void>; discard: () => void; afterSave?:()=>void};
const PendingContext = createContext<((key: string, change?: Change) => void) | null>(null);
const GuardContext = createContext<()=>Promise<boolean>>(async()=>true);
export const useDiscardSettings=()=>useContext(GuardContext);
export function usePendingSetting(key: string, dirty: boolean, change: Change) {
  const register = useContext(PendingContext);
  const latest = useRef(change); latest.current = change;
  useEffect(() => {
    register?.(key, dirty ? {blocked: change.blocked, save: () => latest.current.save(), discard: () => latest.current.discard(),afterSave:()=>latest.current.afterSave?.()} : undefined);
    return () => register?.(key);
  }, [register, key, dirty, change.blocked]);
  return !!register;
}
export function PendingSettings({children}: {children: ReactNode}) {
  const parent = useContext(PendingContext);
  return parent ? <>{children}</> : <PendingSettingsOwner>{children}</PendingSettingsOwner>;
}
function PendingSettingsOwner({children}: {children: ReactNode}) {
  const [changes, setChanges] = useState<Record<string, Change>>({});
  const [busy, setBusy] = useState(false), [error, setError] = useErrorState('client/PendingSettings.tsx');
  const locked = useRef(false);
  const register = useCallback((key: string, change?: Change) => setChanges(current => {
    if (!change && !current[key]) return current;
    const next = {...current}; if (change) next[key] = change; else delete next[key]; return next;
  }), []);
  const pending = Object.values(changes);
  const blocker=useBlocker(pending.length>0);
  const discard=useCallback(async()=>{
    if(locked.current)return false;
    const current=Object.values(changes);
    if(!current.length)return true;
    if(!await confirmAction({title:'Discard unsaved changes?',description:'Your changes on this page have not been saved.',confirmLabel:'Discard changes'}))return false;
    for(const change of current)change.discard();setError('');return true;
  },[changes]);
  const leaving=useRef(false);
  const currentBlocker=useRef(blocker);currentBlocker.current=blocker;
  useEffect(()=>{
    const reset=()=>{setChanges({});setError('');if(currentBlocker.current.state==='blocked')currentBlocker.current.reset()};
    window.addEventListener('panel-auth-changed',reset);window.addEventListener('desktop-session-rejected',reset);
    return()=>{window.removeEventListener('panel-auth-changed',reset);window.removeEventListener('desktop-session-rejected',reset)};
  },[]);
  useEffect(()=>{
    if(blocker.state==='unblocked'){leaving.current=false;return}
    if(blocker.state!=='blocked'||leaving.current)return;
    leaving.current=true;
    void discard().then(accepted=>{
      const current=currentBlocker.current;
      if(current.state!=='blocked'||current.location.key!==blocker.location.key)return;
      if(accepted)current.proceed();else current.reset();
    });
  },[blocker,discard]);
  useEffect(() => {
    if (!pending.length) return;
    const warn = (event: BeforeUnloadEvent) => {event.preventDefault(); event.returnValue = '';};
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [pending.length]);
  return <PendingContext.Provider value={register}><GuardContext.Provider value={discard}>{children}{pending.length > 0 && <div className="settings-pending-bar" role="region" aria-label="Unsaved settings" aria-busy={busy}>
    <span>{error || 'Unsaved changes'}</span>
    <Button disabled={busy || pending.some(change => change.blocked)} onClick={async () => {
      if (locked.current) return; locked.current = true; setBusy(true); setError('');
      try {await saveSettingChanges(pending);}
      catch {setError('Some changes could not be saved. Check the highlighted settings.');}
      finally {locked.current = false; setBusy(false);}
    }}>{busy ? 'Saving...' : 'Save'}</Button>
    <Button variant="secondary" disabled={busy} onClick={() => {for (const change of pending) change.discard(); setError('');}}>Discard</Button>
  </div>}</GuardContext.Provider></PendingContext.Provider>;
}
