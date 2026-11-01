import './minecraftSetup.css';
import './games-ui.css';
import type {ReactNode} from 'react';
import {Modal} from '../ui/Modal';

export function MinecraftDialog({title,onClose,children}:{title:string;onClose:()=>void;children:ReactNode}){
  return <Modal title={title} onClose={onClose}><div className="games-ui mc-dialog-content">{children}</div></Modal>;
}
