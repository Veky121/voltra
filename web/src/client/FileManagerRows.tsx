import {useEffect,useState,type RefObject} from 'react';
import {createPortal} from 'react-dom';
import type {IApi} from '@svar-ui/react-filemanager';
import {Icon} from '../Icons';
import {managerDOMPath,plainFileClick} from './fileManagerModel';

// SVAR owns the virtualized rows and selection store. This small presentation
// adapter adds app-owned accessible controls without replacing its data model.
type Slot={cell:HTMLElement;id:string;panel:0|1;key:number};

export default function FileManagerRows({host,manager,selected,onOpen,onMenu}:{
  host:RefObject<HTMLDivElement|null>;manager:RefObject<IApi|null>;selected:string[];onOpen:(id:string)=>void;onMenu:(id:string,anchor:HTMLButtonElement)=>void;
}){
  const [slots,setSlots]=useState<Slot[]>([]);
  useEffect(()=>{
    const root=host.current;if(!root)return;
    const keys=new WeakMap<HTMLElement,number>();let nextKey=0;
    const scan=()=>{
      const next:Slot[]=[];
      for(const cell of root.querySelectorAll<HTMLElement>('.wx-name-cell')){
        const row=cell.closest<HTMLElement>('[role="row"][data-id]');
        const id=managerDOMPath(row?.getAttribute('data-id')??null);
        if(!id)continue;
        cell.classList.add('fm-row-enhanced');
        if(!keys.has(cell))keys.set(cell,++nextKey);
        next.push({cell,id,panel:row?.closest('[data-panel="1"]')?1:0,key:keys.get(cell)!});
      }
      setSlots(old=>old.length===next.length&&old.every((slot,i)=>slot.cell===next[i].cell&&slot.id===next[i].id&&slot.panel===next[i].panel)?old:next);
    };
    scan();const observer=new MutationObserver(scan);
    observer.observe(root,{childList:true,subtree:true,attributes:true,attributeFilter:['data-id']});
    return()=>{observer.disconnect();for(const cell of root.querySelectorAll('.fm-row-enhanced'))cell.classList.remove('fm-row-enhanced')};
  },[host]);
  return slots.map(slot=>{
    const api=manager.current,file=api?.getFile(slot.id),parent=slot.id==='/wx-filemanager-parent-link';
    if(!parent&&!file)return null;
    const name=parent?'Back to parent folder':file!.name;
    const checked=slot.panel===(api?.getState().activePanel||0)?selected.includes(slot.id):!!api?.getState().panels?.[slot.panel]?.selected?.includes(slot.id);
    async function activate(){if(api?.getState().activePanel!==slot.panel)await api?.exec('set-active-panel',{panel:slot.panel})}
    async function select(toggle:boolean,range=false){await activate();await api?.exec('select-file',{id:slot.id,toggle,range,panel:slot.panel})}
    return createPortal(<div className={`fm-entry-content${file?.type==='folder'?' is-folder':''}${parent?' is-parent':''}`} onKeyDownCapture={event=>{if(event.key==='Enter'||event.key===' ')event.stopPropagation()}}>
      {!parent&&<input type="checkbox" className="fm-entry-check" aria-label={`Select ${name}`} checked={checked}
        onClickCapture={event=>{event.stopPropagation();void select(true)}} onDoubleClickCapture={event=>event.stopPropagation()}
        onChange={()=>{}}/>}
      <button type="button" className="fm-entry-open" title={name} disabled={!parent&&!file} onClickCapture={async event=>{
        event.stopPropagation();
        if(!plainFileClick(event)){void select(event.ctrlKey||event.metaKey,event.shiftKey);return}
        await activate();
        onOpen(slot.id);
      }} onDoubleClickCapture={event=>{event.preventDefault();event.stopPropagation()}}>
        <Icon name={parent?'back':file?.type==='folder'?'files':'file'}/><span>{name}</span>
      </button>
      {!parent&&<button type="button" className="fm-entry-menu" aria-label={`Options for ${name}`} title={`Options for ${name}`} aria-haspopup="menu" onClickCapture={async event=>{
        event.stopPropagation();const anchor=event.currentTarget;await activate();onMenu(slot.id,anchor);
      }} onDoubleClickCapture={event=>event.stopPropagation()}><Icon name="more"/></button>}
    </div>,slot.cell,`${slot.key}:${slot.id}`);
  });
}
