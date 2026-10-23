import {useEffect,useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import {createPortal} from 'react-dom';

export default function FileMenu({anchor,label,onClose,children}:{anchor:HTMLButtonElement;label:string;onClose:(restoreFocus?:boolean)=>void;children:ReactNode}){
  const menu=useRef<HTMLDivElement>(null);
  const [position,setPosition]=useState({left:0,top:0});
  useLayoutEffect(()=>{
    const place=()=>{
      if(!menu.current)return;
      const rect=anchor.getBoundingClientRect(),box=menu.current.getBoundingClientRect();
      setPosition({left:Math.max(12,Math.min(rect.right-box.width,innerWidth-box.width-12)),top:Math.max(12,Math.min(rect.bottom+6+box.height>innerHeight-12?rect.top-box.height-6:rect.bottom+6,innerHeight-box.height-12))});
    };
    place();
    menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    window.addEventListener('resize',place);
    document.addEventListener('scroll',place,true);
    return()=>{window.removeEventListener('resize',place);document.removeEventListener('scroll',place,true)};
  },[anchor]);
  useEffect(()=>{
    const outside=(event:PointerEvent)=>{
      if(!menu.current?.contains(event.target as Node)&&!anchor.contains(event.target as Node))onClose();
    };
    document.addEventListener('pointerdown',outside);
    return()=>document.removeEventListener('pointerdown',outside);
  },[anchor,onClose]);
  return createPortal(<div ref={menu} id="file-options-menu" role="menu" aria-label={label} className="file-options-menu" style={position} onKeyDown={event=>{
    if(event.key==='Escape'||event.key==='Tab'){
      if(event.key==='Escape')event.preventDefault();
      onClose(true);
    }
    if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
      event.preventDefault();
      const options=Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')||[]);
      if(!options.length)return;
      const current=options.indexOf(document.activeElement as HTMLButtonElement);
      const next=event.key==='Home'?0:event.key==='End'?options.length-1:(current+(event.key==='ArrowDown'?1:-1)+options.length)%options.length;
      options[next].focus();
    }
  }}>{children}</div>,document.body);
}
