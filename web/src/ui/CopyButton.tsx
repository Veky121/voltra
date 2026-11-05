import {notify} from '../notifications';
import {useEffect,useRef,useState,type ComponentProps} from 'react';
import {Copy} from 'lucide-react';
import {ActionButton} from './ActionButton';
import {ButtonFeedback} from './ButtonFeedback';
import {useTransientMessage} from '../hooks/useTransientMessage';

type Props=Omit<ComponentProps<'button'>,'onClick'|'value'> & {value:string;onCopyError?:(message:string)=>void};
export function CopyButton({value,onCopyError,children=value,className='',disabled,...props}:Props){
 const [busy,setBusy]=useState(false),[copied,setCopied]=useTransientMessage(2000);
 const active=useRef(true),inFlight=useRef(false);
 useEffect(()=>{active.current=true;return()=>{active.current=false}},[]);
 async function copy(){
  if(inFlight.current)return;

  inFlight.current=true;setBusy(true);setCopied('');
  try{await navigator.clipboard.writeText(value);if(active.current){setCopied('Copied');onCopyError?.('')}}
  catch{const message='Copy unavailable. Select and copy the address manually.';if(active.current){if(onCopyError)onCopyError(message);else notify(message,'error')}}
  finally{inFlight.current=false;if(active.current)setBusy(false)}
 }
 const state=busy?'pending':copied?'success':'idle';
 return <ActionButton {...props} aria-label={props['aria-label']||value} type="button" className={`copy-button ${className}`} disabled={disabled||busy} aria-busy={busy} data-feedback={state} onClick={()=>void copy()}>
  <ButtonFeedback state={state}><Copy/></ButtonFeedback><span className="copy-button-value">{children}</span>
  <span className="button-feedback-sr" role="status">{busy?'Copying':copied}</span>
 </ActionButton>;
}
