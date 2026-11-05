import {Feedback} from '../notifications';
import {ServerPageSkeleton} from '../ui/ServerPageSkeleton';
import {Component,lazy,Suspense,type ReactNode} from 'react';
import {useSearchParams} from 'react-router-dom';
import './files-ui.css';
const FileManager=lazy(()=>import('./FileManager'));
const FilesV0=lazy(()=>import('./FilesV0'));
class ManagerBoundary extends Component<{children:ReactNode;onV0:()=>void},{failed:boolean}>{
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true}}
  render(){return this.state.failed?<><Feedback tone="error" message={<><p>The file manager could not open.</p></>}/><button type="button" className="button secondary" onClick={this.props.onV0}>Open file manager v0</button><button type="button" className="button secondary" onClick={()=>location.reload()}>Reload</button></>:this.props.children}
}
export default function Files(){
  const [query,setQuery]=useSearchParams();
  if(query.get('manager')==='v0')return <><div className="fm-version"><span>File manager v0</span><button type="button" className="button secondary" onClick={()=>{const next=new URLSearchParams(query);next.delete('manager');setQuery(next)}}>Use new manager</button></div><Suspense fallback={<ServerPageSkeleton path="/server/current/files"/>}><FilesV0/></Suspense></>;
  return <ManagerBoundary onV0={()=>{const next=new URLSearchParams(query);next.set('manager','v0');setQuery(next)}}><Suspense fallback={<ServerPageSkeleton path="/server/current/files"/>}><FileManager/></Suspense></ManagerBoundary>;
}
