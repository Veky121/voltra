import {useEffect,useRef} from 'react';

export function SidebarWidthHandle({width,onChange}:{width:number;onChange:(width:number)=>void}){
 const drag=useRef<{x:number;width:number}|null>(null);
 const clamp=(value:number)=>Math.round(Math.max(220,Math.min(420,window.innerWidth-480,value)));
 useEffect(()=>{
  const resize=()=>{const next=clamp(width);if(next!==width)onChange(next)};
  resize();window.addEventListener('resize',resize);
  return()=>window.removeEventListener('resize',resize);
 },[width,onChange]);
 return <div className="voltra-sidebar-width-handle" role="separator" aria-label="Sidebar width" aria-orientation="vertical" aria-valuemin={220} aria-valuemax={420} aria-valuenow={width} aria-controls="main-content" tabIndex={0} title="Drag to resize sidebar. Double-click to reset."
  onPointerDown={event=>{if(event.button!==0)return;event.preventDefault();drag.current={x:event.clientX,width};event.currentTarget.setPointerCapture(event.pointerId)}}
  onPointerMove={event=>{if(drag.current)onChange(clamp(drag.current.width+event.clientX-drag.current.x))}}
  onPointerUp={event=>{drag.current=null;if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId)}}
  onPointerCancel={()=>{if(drag.current)onChange(drag.current.width);drag.current=null}}
  onLostPointerCapture={()=>{drag.current=null}}
  onDoubleClick={()=>onChange(260)}
  onKeyDown={event=>{if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();onChange(clamp(width+(event.key==='ArrowLeft'?-10:10)))}else if(event.key==='Home'||event.key==='End'){event.preventDefault();onChange(clamp(event.key==='Home'?220:420))}}}
 />;
}
