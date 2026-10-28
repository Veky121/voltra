import {miBToGB} from "../resourceUnits.ts";
import './games-ui.css';
import {Field, Input, Select} from '../lib';
import type {SetupNode} from './gameSetupModel';
import {gameNodeAvailable} from './gamePortsModel';
import type {GameAgreement} from './gameTemplateModel';

export function GameAgreementField({agreement, value, onChange}: {agreement: GameAgreement; value: string; onChange: (value: string) => void}) {
  return <div className="field game-agreement games-ui">
    <details><summary>Read publisher terms</summary><p className="muted">{agreement.effective_date ? `Effective ${agreement.effective_date}` : `Reviewed ${agreement.reviewed_date}`}</p><pre tabIndex={0} aria-label={agreement.title}>{agreement.text}</pre></details>
    <Field label={agreement.title}><Select value={value === agreement.accept_value ? value : '0'} onChange={event => onChange(event.target.value)}><option value="0">Not agreed</option><option value={agreement.accept_value}>I agree to these publisher terms</option></Select></Field>
  </div>;
}

// Game flows share the same controls and accessibility behavior. These wrappers
// add setup-specific units and availability without owning the page layout.
export function GameNameField({value, onChange}: {value: string; onChange: (value: string) => void}) {
  return <Field label="Server name"><Input id="game-server-name" required maxLength={100} autoComplete="off" value={value} onChange={event => onChange(event.target.value)}/></Field>;
}

export function GameMemoryField({value, onChange, minimum, maximum, describedBy}: {value: string; onChange: (value: string) => void; minimum: number; maximum: number; describedBy?: string}) {
  return <Field label="Memory (GB)" hint={`Minimum ${miBToGB(minimum)} GB`}><Input id="game-server-memory" type="number" required min={miBToGB(minimum)} max={miBToGB(maximum)} step="any" value={value} aria-describedby={describedBy} onChange={event => onChange(event.target.value)}/></Field>;
}

export function GameNodeField({value, onChange, nodes, automatic = false}: {value: string; onChange: (value: string) => void; nodes: SetupNode[]; automatic?: boolean}) {
  return <Field label="Host machine"><Select id="game-server-node" value={value} required={!automatic} onChange={event => onChange(event.target.value)}>{automatic ? <option value="">Choose automatically</option> : !nodes.length && <option value="">No compatible nodes</option>}{nodes.map(node => <option key={node.id} value={node.id} disabled={!gameNodeAvailable(node)}>{node.name}{node.unavailable_reason ? ` · ${node.unavailable_reason}` : !node.automatic_ports && node.free_allocations !== undefined && node.free_allocations < 1 ? ' · No available ports' : ''}</option>)}</Select></Field>;
}

