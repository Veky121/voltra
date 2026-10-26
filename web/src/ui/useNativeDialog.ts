import {useLayoutEffect, useRef, useState, type KeyboardEvent, type SyntheticEvent} from 'react';

let scrollLocks = 0;
let previousOverflow = '';

export function useNativeDialog() {
  const [element, ref] = useState<HTMLDialogElement | null>(null);
  const escapeInPopup=useRef(false);
  useLayoutEffect(() => {
    if (!element) return;
    const previous = document.activeElement;
    if (!element.open) element.showModal();
    if (scrollLocks++ === 0) {
      previousOverflow = document.documentElement.style.overflow;
      document.documentElement.style.overflow = 'hidden';
    }
    return () => {
      if (element.open) element.close();
      if (--scrollLocks === 0) document.documentElement.style.overflow = previousOverflow;
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({preventScroll:true});
    };
  }, [element]);
  function onKeyDown(event:KeyboardEvent<HTMLDialogElement>) {
    if(event.key!=='Tab'||event.defaultPrevented||event.target instanceof Element&&event.target.closest('dialog')!==event.currentTarget)return;
    const controls=Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button,a[href],input,select,textarea,summary,[tabindex]')).filter(control=>control.tabIndex>=0&&!control.matches(':disabled,[aria-hidden="true"],[hidden]')&&!control.closest('[inert]')&&control.getClientRects().length>0&&getComputedStyle(control).visibility!=='hidden');
    const first=controls[0],last=controls.at(-1);
    if(!first){event.preventDefault();event.currentTarget.focus();return;}
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  }
  function onKeyDownCapture(event:KeyboardEvent<HTMLDialogElement>) {
    if(event.key==='Escape'&&event.target instanceof Element&&event.target.closest('dialog')===event.currentTarget)
      escapeInPopup.current=Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="listbox"],[role="menu"]')).some(popup=>popup.getClientRects().length>0&&!popup.closest('[hidden],[data-closed]'));
  }
  function cancel(event:SyntheticEvent<HTMLDialogElement>,onClose:()=>void) {
    event.preventDefault();event.stopPropagation();
    if(!escapeInPopup.current)onClose();
    escapeInPopup.current=false;
  }
  return {element, ref, onKeyDown, onKeyDownCapture, cancel};
}
