import {Field, Input, Select} from '../lib';
import type {SetupNode} from './gameSetupModel';

// Game flows share the same controls and accessibility behavior. These wrappers
// add setup-specific units and availability without owning the page layout.
export function GameNameField({value, onChange}: {value: string; onChange: (value: string) => void}) {
  return <Field label="Server name"><Input required maxLength={100} autoComplete="off" value={value} onChange={event => onChange(event.target.value)}/></Field>;
}

export function GameMemoryField({value, onChange, minimum, maximum, describedBy}: {value: string; onChange: (value: string) => void; minimum: number; maximum: number; describedBy?: string}) {
  return <Field label="Memory (GiB)" hint={`Minimum ${minimum / 1024} GiB`}><Input type="number" required min={minimum / 1024} max={maximum / 1024} step={1 / 1024} value={value} aria-describedby={describedBy} onChange={event => onChange(event.target.value)}/></Field>;
}

export function GameNodeField({value, onChange, nodes, automatic = false}: {value: string; onChange: (value: string) => void; nodes: SetupNode[]; automatic?: boolean}) {
  return <Field label="Node"><Select value={value} required={!automatic} onChange={event => onChange(event.target.value)}>{automatic ? <option value="">Choose automatically</option> : !nodes.length && <option value="">No compatible nodes</option>}{nodes.map(node => <option key={node.id} value={node.id} disabled={node.setup_available === false || (node.free_allocations !== undefined && node.free_allocations < 1)}>{node.name}{node.unavailable_reason ? ` · ${node.unavailable_reason}` : node.free_allocations !== undefined && node.free_allocations < 1 ? ' · No available ports' : ''}</option>)}</Select></Field>;
}

