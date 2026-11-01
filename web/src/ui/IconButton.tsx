import type {ComponentProps} from 'react';
import {Button} from '../components/ui/button';
import {Tooltip,TooltipTrigger,TooltipContent} from '../components/ui/tooltip';

export function IconButton({title,children,...props}:ComponentProps<'button'>){
  const label=title||props['aria-label'];
  const control=<Button variant="ghost" size="icon-sm" type="button" {...props}>{children}</Button>;
  return label?<Tooltip><TooltipTrigger render={control} data-slot="button"/><TooltipContent>{label}</TooltipContent></Tooltip>:control;
}
