import "./minecraftSetup.css";
import './games-ui.css';
import {useEffect, useId, useRef} from "react";
import type {ReactNode} from "react";
import {Button} from "../lib";

export function MinecraftDialog({title, onClose, children}: {title: string; onClose: () => void; children: ReactNode}) {
  const ref = useRef<HTMLDialogElement>(null);
  const heading = useId();
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement;
    dialog?.showModal();
    return () => {dialog?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus();};
  }, []);
  return <dialog ref={ref} className="mc-dialog games-ui" aria-labelledby={heading} onCancel={e => {e.preventDefault(); onClose();}} onClick={e => {
    if (e.target !== e.currentTarget) return;
    const bounds = e.currentTarget.getBoundingClientRect();
    if (e.clientX < bounds.left || e.clientX > bounds.right || e.clientY < bounds.top || e.clientY > bounds.bottom) onClose();
  }}>
    <header><h2 id={heading}>{title}</h2><Button variant="secondary" aria-label="Close dialog" onClick={onClose}>×</Button></header>
    {children}
  </dialog>;
}
