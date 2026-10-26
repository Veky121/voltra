import {Children, Fragment, isValidElement, useEffect, useRef, useState, type ReactNode, type SelectHTMLAttributes} from 'react';
import {Select as SelectRoot, SelectTrigger, SelectValue, SelectContent, SelectItem, SelectGroup, SelectLabel} from '../components/ui/select';
import {useOverlayPortalContainer} from './OverlayPortal';

type Option = {value:string;label:ReactNode;disabled:boolean;group?:string};
function optionsFrom(children:ReactNode, group?:string, disabled=false):Option[]{
 return Children.toArray(children).flatMap(child=>{
  if(!isValidElement<{children?:ReactNode;value?:string|number;disabled?:boolean;label?:string}>(child))return [];
  if(child.type===Fragment)return optionsFrom(child.props.children,group,disabled);
  if(child.type==='optgroup')return optionsFrom(child.props.children,child.props.label,disabled||!!child.props.disabled);
  if(child.type!=='option')return [];
  return [{value:String(child.props.value??child.props.children??''),label:child.props.children,disabled:disabled||!!child.props.disabled,group}];
 });
}

// Keep native form submission, validation and ChangeEvent semantics for legacy
// consumers. Only the shadcn trigger and popup are exposed to assistive technology.
export function Select({children,value,defaultValue,multiple=false,onChange,className='',id,disabled,required,form,name,onInvalid,...props}:SelectHTMLAttributes<HTMLSelectElement>){
 const native=useRef<HTMLSelectElement>(null),trigger=useRef<HTMLButtonElement>(null);
 const [portalContainer,setPortalContainer]=useState<HTMLElement|null>(null);
 const dialogContainer=useOverlayPortalContainer();
 const options=optionsFrom(children);
 const [local,setLocal]=useState(()=>defaultValue??(multiple?[]:options[0]?.value??''));
 const [invalid,setInvalid]=useState(false);
 const raw=value??local;
 const current=multiple?(Array.isArray(raw)?raw.map(String):[]):String(raw);
 useEffect(()=>{const owner=native.current?.form;if(!owner)return;const reset=()=>{setLocal(defaultValue??(multiple?[]:options[0]?.value??''));setInvalid(false)};owner.addEventListener('reset',reset);return()=>owner.removeEventListener('reset',reset)},[defaultValue,multiple,options[0]?.value]);
 function change(next:string|string[]|null){
  const element=native.current;if(!element)return;
  const values=Array.isArray(next)?next:[next??''];
  for(const option of element.options)option.selected=values.includes(option.value);
  setLocal(multiple?values:values[0]);setInvalid(false);
  element.dispatchEvent(new Event('change',{bubbles:true}));
 }
 const renderOption=(option:Option,index:number)=><SelectItem key={option.value+':'+index} value={option.value} disabled={option.disabled}>{option.label}</SelectItem>;
 const groups=Array.from(new Set(options.map(option=>option.group)));
 return <span className="ui-select-field">
  <SelectRoot<string,boolean> value={current} multiple={multiple} disabled={disabled} modal={dialogContainer||portalContainer?false:undefined} onValueChange={change} onOpenChange={open=>{
   // Native modal dialogs occupy the browser's top layer. Their menus must be
   // descendants too; a body portal stays behind the dialog at any z-index.
   if(open)setPortalContainer(trigger.current?.closest('dialog')??null);
  }} items={options.map(({value,label})=>({value,label}))}>
   <SelectTrigger {...props as React.ComponentProps<typeof SelectTrigger>} ref={trigger} id={id} className={`ui-select ${className}`} disabled={disabled} aria-required={required||undefined} aria-invalid={invalid||props['aria-invalid']}>
    <SelectValue>{()=>{const selected=options.filter(option=>Array.isArray(current)?current.includes(option.value):option.value===current);return multiple?(selected.length?selected.map(option=>option.label).map((label,index)=><Fragment key={index}>{index>0?', ':''}{label}</Fragment>):'Select options'):selected[0]?.label??''}}</SelectValue>
   </SelectTrigger>
   <SelectContent portalContainer={portalContainer} className="ui-select-popup" align="start" alignItemWithTrigger={false}>{groups.map(group=>group===undefined?options.filter(option=>option.group===undefined).map(renderOption):<SelectGroup key={group}><SelectLabel>{group}</SelectLabel>{options.filter(option=>option.group===group).map(renderOption)}</SelectGroup>)}</SelectContent>
  </SelectRoot>
  <select ref={native} className="ui-select-native" tabIndex={-1} aria-hidden="true" disabled={disabled} required={required} form={form} name={name} multiple={multiple} value={value} defaultValue={value===undefined?defaultValue:undefined} onChange={event=>{if(value===undefined)setLocal(multiple?Array.from(event.target.selectedOptions,option=>option.value):event.target.value);onChange?.(event)}} onInvalid={event=>{event.preventDefault();setInvalid(true);trigger.current?.focus();onInvalid?.(event)}}>{children}</select>
 </span>;
}
