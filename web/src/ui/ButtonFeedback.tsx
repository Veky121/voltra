import type {ReactNode} from 'react';
import {Check,LoaderCircle} from 'lucide-react';
import './buttonFeedback.css';

export function ButtonFeedback({state,children}:{state:'idle'|'pending'|'success';children:ReactNode}){
 return <span className="button-feedback-icon" data-state={state} aria-hidden="true">
  {state==='pending'?<LoaderCircle className="button-feedback-spinner"/>:state==='success'?<Check className="button-feedback-check"/>:children}
 </span>;
}
