import {useEffect,useId,useRef,useState,type ComponentProps,type HTMLAttributes,type ReactNode} from 'react';
import {Switch as ShadcnSwitch} from '../components/ui/switch';

type SectionProps=Omit<HTMLAttributes<HTMLElement>,'title'>&{title:string;action?:ReactNode;plain?:boolean;children:ReactNode};
export function SettingsSection({title,action,plain=false,children,className='',...props}:SectionProps){
 const heading=useId();
 return <section {...props} aria-labelledby={heading} className={`settings-section ${className}`}><header className="settings-section-heading"><h2 id={heading}>{title}</h2>{action}</header><div className={plain?'settings-plain':'settings-group'}>{children}</div></section>;
}
type RowProps=Omit<HTMLAttributes<HTMLDivElement>,'title'>&{label:string;description?:ReactNode;control:ReactNode;children?:ReactNode};
export function SettingsRow({label,description,control,children,className='',...props}:RowProps){
 const heading=useId();
 return <div {...props} role="group" aria-labelledby={heading} className={`settings-row ${className}`}><div className="settings-row-layout"><div className="settings-row-copy"><span className="settings-row-label" id={heading}>{label}</span>{description&&<p className="settings-row-description">{description}</p>}</div><div className="settings-row-control">{control}</div></div>{children&&<div className="settings-row-body">{children}</div>}</div>;
}
export function Switch({className='',checked,defaultChecked,inputRef,onCheckedChange,...props}:ComponentProps<typeof ShadcnSwitch>){
 const input=useRef<HTMLInputElement|null>(null),[local,setLocal]=useState(defaultChecked??false);
 useEffect(()=>{const form=input.current?.form;if(!form)return;const reset=()=>{if(checked===undefined)setLocal(defaultChecked??false)};form.addEventListener('reset',reset);return()=>form.removeEventListener('reset',reset)},[checked,defaultChecked,props.form]);
 return <ShadcnSwitch nativeButton render={<button type="button"/>} {...props} inputRef={node=>{input.current=node;if(typeof inputRef==='function')inputRef(node);else if(inputRef)inputRef.current=node}} checked={checked??local} onCheckedChange={(next,details)=>{if(checked===undefined)setLocal(next);onCheckedChange?.(next,details)}} className={`ui-switch ${className}`}/>;
}
