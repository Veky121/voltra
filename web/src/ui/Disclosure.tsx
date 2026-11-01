import {Children,isValidElement,useState,type ComponentProps} from 'react';
import {ChevronDown} from 'lucide-react';
import {Collapsible,CollapsibleTrigger,CollapsibleContent} from '../components/ui/collapsible';
import {Button} from '../components/ui/button';

export function DisclosureTrigger({children,...props}:ComponentProps<'button'>){
  return <CollapsibleTrigger render={<Button variant="ghost"/>} {...props} data-slot="button" data-voltra-disclosure-trigger=""><ChevronDown size={14} aria-hidden="true"/>{children}</CollapsibleTrigger>;
}
export function Disclosure({children,className='',open:controlled,defaultOpen=false,onOpenChange,...props}:Omit<ComponentProps<'div'>,'onToggle'> & {open?:boolean;defaultOpen?:boolean;onOpenChange?:(open:boolean)=>void}){
  const [open,setOpen]=useState(defaultOpen);
  const items=Children.toArray(children),trigger=items.find(child=>isValidElement(child)&&child.type===DisclosureTrigger);
  return <Collapsible open={controlled??open} onOpenChange={next=>{setOpen(next);onOpenChange?.(next)}} {...props} data-slot="disclosure" className={className} onInvalidCapture={()=>{setOpen(true);onOpenChange?.(true)}}>
    {trigger}<CollapsibleContent keepMounted>{items.filter(child=>child!==trigger)}</CollapsibleContent>
  </Collapsible>;
}
