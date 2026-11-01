import type {ComponentProps} from 'react';
import {Button} from '../components/ui/button';

// Native page buttons default to submit; lib.Button deliberately defaults to button.
export function ActionButton({type='submit',className='',...props}:ComponentProps<'button'>){
  const variant=/(?:^|\s)danger(?:\s|$)/.test(className)?'destructive':/(?:^|\s)secondary(?:\s|$)/.test(className)?'secondary':/(?:^|\s)button(?:\s|$)/.test(className)?'default':'ghost';
  return <Button type={type} variant={variant} className={`scn:h-auto ${className}`} {...props}/>;
}
