import {useState,useLayoutEffect,useRef, type ReactNode} from 'react';
import {Dialog,DialogContent,DialogHeader,DialogTitle} from '../components/ui/dialog';
import {OverlayPortalContext} from './OverlayPortal';
import './overlays.css';

export function Modal({title,onClose,children}:{title:string;onClose:()=>void;children:ReactNode}) {
  const [open,setOpen]=useState(true);
  const [container,setContainer]=useState<HTMLDivElement|null>(null);
  const nestedEscape=useRef(false);
  useLayoutEffect(()=>{
    const capture=(event:KeyboardEvent)=>{
      if(event.key!=='Escape')return;
      nestedEscape.current=!!container?.querySelector('[data-slot="select-trigger"][data-popup-open],[data-slot="dropdown-menu-trigger"][data-popup-open],[data-slot="combobox-trigger"][data-popup-open]');
    };
    document.addEventListener('keydown',capture,true);
    return()=>document.removeEventListener('keydown',capture,true);
  },[container]);
  return <Dialog open={open} onOpenChangeComplete={next=>{if(!next)onClose()}} onOpenChange={(open,details)=>{if(!open){if(details.reason==='escape-key'&&nestedEscape.current){details.cancel();return}setOpen(false)}}}>
    <DialogContent ref={setContainer} className="voltra-dialog" aria-describedby={undefined}>
      <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
      <OverlayPortalContext.Provider value={container}>{children}</OverlayPortalContext.Provider>
    </DialogContent>
  </Dialog>;
}
