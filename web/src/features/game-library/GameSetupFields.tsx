import {miBToGB} from '../../resourceUnits.ts';
import './games-ui.css';
import {Field, Input, Select} from '../../lib';
import type {SetupNode} from './gameSetupModel';
import {gameNodeAvailable} from './gamePortsModel';
import {GameSetupUnitInput} from './GameSetupLayout';

// Game flows share the same controls and accessibility behavior. These wrappers
// add setup-specific units and availability without owning the page layout.
export function GameNameField({value, onChange}: {value: string; onChange: (value: string) => void}) {
  return (
    <Field label="Panel name">
      <Input
        id="game-server-name"
        required
        maxLength={100}
        autoComplete="off"
        value={value}
        onChange={event => onChange(event.target.value)}
      />
    </Field>
  );
}

export function GameResourceField({
  resource,
  hint,
  value,
  onChange,
  minimum,
  maximum,
  describedBy,
}: {
  value: string;
  onChange?: (value: string) => void;
  resource: 'memory' | 'storage';
  hint?: string;
  minimum?: number;
  maximum?: number;
  describedBy?: string;
}) {
  return (
    <Field
      label={resource === 'memory' ? 'Memory' : 'Storage'}
      hint={hint ?? (minimum !== undefined ? `Minimum ${miBToGB(minimum)} GB` : undefined)}
    >
      <GameSetupUnitInput>
        <Input
          id={`game-server-${resource}`}
          type="number"
          inputMode="decimal"
          required={!!onChange}
          readOnly={!onChange}
          min={minimum === undefined ? undefined : miBToGB(minimum)}
          max={maximum === undefined ? undefined : miBToGB(maximum)}
          step="any"
          value={value}
          aria-describedby={describedBy}
          onChange={event => onChange?.(event.target.value)}
        />
      </GameSetupUnitInput>
    </Field>
  );
}

export function GameNodeField({
  value,
  onChange,
  nodes,
  automatic = false,
}: {
  value: string;
  onChange: (value: string) => void;
  nodes: SetupNode[];
  automatic?: boolean;
}) {
  return (
    <Field label="Host machine">
      <Select
        id="game-server-node"
        value={value}
        required={!automatic}
        onChange={event => onChange(event.target.value)}
      >
        {automatic ? (
          <option value="">Choose automatically</option>
        ) : (
          !nodes.length && <option value="">No compatible nodes</option>
        )}
        {nodes.map(node => (
          <option key={node.id} value={node.id} disabled={!gameNodeAvailable(node)}>
            {node.name}
            {node.unavailable_reason
              ? ` · ${node.unavailable_reason}`
              : !node.automatic_ports && node.free_allocations !== undefined && node.free_allocations < 1
                ? ' · No available ports'
                : ''}
          </option>
        ))}
      </Select>
    </Field>
  );
}
