import type {ReactNode} from 'react';
import {NavLink} from 'react-router-dom';
import {Tabs,TabsList,TabsTrigger} from '../components/ui/tabs';
import {Button} from '../components/ui/button';
import './sectionTabs.css';

export type SectionTab={id:string;label:ReactNode;to?:string;end?:boolean;disabled?:boolean;controls?:string};
type Props={label:string;items:readonly SectionTab[];className?:string;scope?:string;active?:string;onChange?:(id:string)=>void;disabled?:boolean};
export function SectionTabs({label,items,className='',scope='section',active,onChange,disabled=false}:Props){
  if(!onChange)return <nav className={`section-tabs ${className}`} aria-label={label}>{items.map(item=><Button key={item.id} variant="ghost" nativeButton={false} role="link" render={<NavLink to={item.to??'#'} end={item.end}/>} className="section-tab" disabled={disabled||item.disabled}>{item.label}</Button>)}</nav>;
  return <Tabs value={active??null} onValueChange={value=>{if(value!==null)onChange(String(value))}}>
    <TabsList activateOnFocus={false} variant="line" className={`section-tabs ${className}`} aria-label={label}>
      {items.map(item=><TabsTrigger key={item.id} value={item.id} id={`${scope}-tab-${item.id}`} aria-controls={item.controls??`${scope}-panel-${item.id}`} className="section-tab" disabled={disabled||item.disabled}>{item.label}</TabsTrigger>)}
    </TabsList>
  </Tabs>;
}
