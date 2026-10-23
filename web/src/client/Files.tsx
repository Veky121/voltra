import {Component,lazy,Suspense,type ReactNode} from 'react';
import {useSearchParams} from 'react-router-dom';
const FileManager=lazy(()=>import('./FileManager'));
const FilesV0=lazy(()=>import('./FilesV0'));
class ManagerBoundary extends Component<{children:ReactNode;onV0:()=>void},{failed:boolean}>{
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true}}
  render(){return this.state.failed?<div role="alert" className="error"><p>The file manager could not open.</p><button type="button" onClick={this.props.onV0}>Open file manager v0</button><button type="button" onClick={()=>location.reload()}>Reload</button></div>:this.props.children}
}
export default function Files(){
  const [query,setQuery]=useSearchParams();
  if(query.get('manager')==='v0')return <><div className="fm-version"><span>File manager v0</span><button type="button" onClick={()=>{const next=new URLSearchParams(query);next.delete('manager');setQuery(next)}}>Use new manager</button></div><Suspense fallback={<p role="status">Loading file manager v0…</p>}><FilesV0/></Suspense></>;
  return <ManagerBoundary onV0={()=>{const next=new URLSearchParams(query);next.set('manager','v0');setQuery(next)}}><Suspense fallback={<p role="status">Loading file manager…</p>}><FileManager/></Suspense></ManagerBoundary>;
}
