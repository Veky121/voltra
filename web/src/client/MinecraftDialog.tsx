import "./minecraftSetup.css";
import './games-ui.css';
import {useId} from "react";
import type {ReactNode} from "react";
import {Button} from "../lib";
import {OverlayPortalContext} from '../ui/OverlayPortal';
import {useNativeDialog} from '../ui/useNativeDialog';

export function MinecraftDialog({title, onClose, children}: {title: string; onClose: () => void; children: ReactNode}) {
  const {element,ref,onKeyDown,onKeyDownCapture,cancel} = useNativeDialog();
  const heading = useId();
  return <dialog ref={ref} className="mc-dialog games-ui" aria-labelledby={heading} onKeyDown={onKeyDown} onKeyDownCapture={onKeyDownCapture} onCancel={e => cancel(e,onClose)} onClick={e => {
    if (e.target !== e.currentTarget) return;
    const bounds = e.currentTarget.getBoundingClientRect();
    if (e.clientX < bounds.left || e.clientX > bounds.right || e.clientY < bounds.top || e.clientY > bounds.bottom) onClose();
  }}>
    <OverlayPortalContext.Provider value={element}><header><h2 id={heading}>{title}</h2><Button variant="secondary" aria-label="Close dialog" onClick={onClose}>×</Button></header>
    {children}
    </OverlayPortalContext.Provider>
  </dialog>;
}
