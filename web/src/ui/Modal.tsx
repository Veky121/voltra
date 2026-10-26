import {useId, type ReactNode} from 'react';
import {OverlayPortalContext} from './OverlayPortal';
import {useNativeDialog} from './useNativeDialog';
import './overlays.css';

export function Modal({title,onClose,children}:{title:string;onClose:()=>void;children:ReactNode}) {
  const {element,ref,onKeyDown,onKeyDownCapture,cancel} = useNativeDialog();
  const heading = useId();
  return <dialog ref={ref} className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby={heading} onKeyDown={onKeyDown} onKeyDownCapture={onKeyDownCapture}
    onCancel={event=>cancel(event,onClose)}
    onClick={event=>{if(event.target===event.currentTarget)onClose();}}>
    <OverlayPortalContext.Provider value={element}>
      <section className="modal"><header><h2 id={heading}>{title}</h2><button type="button" className="button secondary" aria-label="Close dialog" onClick={onClose}>×</button></header>{children}</section>
    </OverlayPortalContext.Provider>
  </dialog>;
}
