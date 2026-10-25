import type {ReactNode} from 'react';
import {DropdownMenu,DropdownMenuContent} from '../components/ui/dropdown-menu';
import './fileMenu.css';

export default function FileMenu({anchor,label,onClose,children}:{anchor:HTMLButtonElement;label:string;onClose:(restoreFocus?:boolean)=>void;children:ReactNode}){
 return <DropdownMenu open modal={false} onOpenChange={(open,details)=>{if(!open)onClose(details.event.type==='keydown'&&(details.event as KeyboardEvent).key==='Escape')}}>
  <DropdownMenuContent anchor={anchor} align="end" sideOffset={6} id="file-options-menu" aria-label={label} className="voltra-dropdown file-options-menu" finalFocus={false}>{children}</DropdownMenuContent>
 </DropdownMenu>;
}
