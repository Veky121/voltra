import type {ComponentProps} from 'react';
import {Switch} from '../ui/Settings';
import './gameSwitch.css';

export function GameSwitch(props: ComponentProps<typeof Switch>) {
  return <Switch {...props} className={`game-switch-input ${props.className || ''}`}/>;
}
