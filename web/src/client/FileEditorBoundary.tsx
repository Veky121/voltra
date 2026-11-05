import {Component,type ReactNode} from 'react';
import {Textarea} from '../lib';

type Props={path:string;content:string;readOnly:boolean;onChange:(text:string)=>void;onSave:()=>void;children:ReactNode};
// Keep the document and its draft mounted if syntax support or a lazy editor
// chunk fails. Both file managers use this boundary around their shared editor.
export default class FileEditorBoundary extends Component<Props,{failed:boolean}>{
 state={failed:false};
 static getDerivedStateFromError(){return {failed:true}}

 render(){
  if(!this.state.failed)return this.props.children;
  return <div className="file-basic-editor"><p role="alert">The code editor could not load. Your text is available in the basic editor below.</p><Textarea aria-label={`Edit ${this.props.path}`} value={this.props.content} readOnly={this.props.readOnly} spellCheck={false} onChange={event=>this.props.onChange(event.target.value)} onKeyDown={event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();this.props.onSave()}}}/></div>;
 }
}
