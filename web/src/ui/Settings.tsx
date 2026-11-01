import {Card} from '../components/ui/card';
import {Field} from '../components/ui/field';
import './settingsLayout.css';
import {createContext,useContext,useEffect,useId,useRef,useState,type ComponentProps,type HTMLAttributes,type ReactNode} from 'react';
import {Switch as ShadcnSwitch} from '../components/ui/switch';
import {Button} from '../components/ui/button';
import {Info} from 'lucide-react';

const SettingsLayoutContext=createContext(false);
export function SettingsLayout({children}:{children:ReactNode}){return <SettingsLayoutContext.Provider value={true}>{children}</SettingsLayoutContext.Provider>;}
export function useSettingsLayout(){return useContext(SettingsLayoutContext);}

type SectionProps=Omit<HTMLAttributes<HTMLElement>,'title'>&{title:string;action?:ReactNode;plain?:boolean;children:ReactNode};
export function SettingsSection({title,action,plain=false,children,className='',...props}:SectionProps){
 const heading=useId();
 return <section {...props} data-settings-section="" aria-labelledby={heading} className={`settings-section ${className}`}><header className="settings-section-heading"><h2 id={heading}>{title}</h2>{action}</header><Card data-settings-group={plain?undefined:''} className={plain?'settings-plain':'settings-group'}>{children}</Card></section>;
}
type RowProps=Omit<HTMLAttributes<HTMLDivElement>,'title'>&{label:ReactNode;description?:ReactNode;details?:ReactNode;info?:ReactNode;infoLabel?:string;control:ReactNode;children?:ReactNode;layout?:'inline'|'stacked'};
export function SettingsRow({label,description,details,info,infoLabel='Setting details',control,children,className='',layout='inline',...props}:RowProps){
 const heading=useId(),infoId=useId();
 const [infoOpen,setInfoOpen]=useState(false);
 const labelElement=<span className="settings-row-label" id={heading}>{label}</span>;
 return <div {...props} data-settings-row="" data-settings-layout={layout} role="group" aria-labelledby={heading} className={`settings-row ${className}`}>
  <div className="settings-row-layout">
   <div className="settings-row-copy">
    {info ? <div className="settings-row-heading">
     {labelElement}
     <Button type="button" variant="ghost" size="icon-sm" className="settings-info-toggle" aria-label={infoLabel} aria-expanded={infoOpen} aria-controls={infoId} onClick={()=>setInfoOpen(open=>!open)}><Info aria-hidden="true"/></Button>
    </div> : labelElement}
    {description&&<p className="settings-row-description">{description}</p>}
    {layout!=='stacked'&&details}
   </div>
   <div className="settings-row-control">{control}</div>
  </div>
  {info&&<div id={infoId} className="settings-row-info" hidden={!infoOpen}>{info}</div>}
  {layout==='stacked'&&details&&<div className="settings-row-details">{details}</div>}
  {children&&<div className="settings-row-body">{children}</div>}
 </div>;
}
// Preserve implicit labels for generated forms, including the select adapter.
export function SettingsField({label,description,children,className=''}:{label:ReactNode;description?:ReactNode;children:ReactNode;className?:string}){
 return <Field as="label" data-settings-field="" className={`settings-field ${className}`}><span className="settings-row-copy"><span className="settings-row-label">{label}</span>{description&&<span className="settings-row-description">{description}</span>}</span><span className="settings-field-control">{children}</span></Field>;
}
export function Switch({className='',checked,defaultChecked,inputRef,onCheckedChange,...props}:ComponentProps<typeof ShadcnSwitch>){
 const input=useRef<HTMLInputElement|null>(null),[local,setLocal]=useState(defaultChecked??false);
 useEffect(()=>{const form=input.current?.form;if(!form)return;const reset=()=>{if(checked===undefined)setLocal(defaultChecked??false)};form.addEventListener('reset',reset);return()=>form.removeEventListener('reset',reset)},[checked,defaultChecked,props.form]);
 return <ShadcnSwitch nativeButton render={<button type="button"/>} {...props} inputRef={node=>{input.current=node;if(typeof inputRef==='function')inputRef(node);else if(inputRef)inputRef.current=node}} checked={checked??local} onCheckedChange={(next,details)=>{if(checked===undefined)setLocal(next);onCheckedChange?.(next,details)}} className={`ui-switch ${className}`}/>;
}
