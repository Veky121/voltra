import {ActionButton as MiraAction} from '../../ui/ActionButton';
import {settingCopy, settingMatches} from './gameSettingCopy';
import {Input, Select, Textarea} from '../../lib';
import type {QuickField, QuickValue} from '../game-library/gameSetupModel';
import {SettingsRow, SettingsSection} from '../../ui/Settings';
import {GameSwitch} from '../shared/GameSwitch';
import {settingsGroups} from './gameSettingsLayout';

export function GameSettingsFields({
  fields,
  game,
  file,
  search,
  draft,
  onChange,
}: {
  fields: QuickField[];
  game: string;
  file: string;
  search: string;
  draft: Record<string, QuickValue>;
  onChange: (key: string, value: string | boolean) => void;
}) {
  const groups = settingsGroups(fields, game, file)
    .map(group => ({...group, fields: group.fields.filter(field => settingMatches(field, search, game))}))
    .filter(group => group.fields.length);
  return (
    <>
      {groups.map(group => (
        <SettingsSection key={group.id} title={group.label} className="game-settings-section">
          <div className="game-properties-grid">
            {group.fields.map(field => (
              <GameSettingField
                key={field.key}
                field={field}
                game={game}
                value={Object.hasOwn(draft, field.key) ? draft[field.key] : field.value}
                onChange={value => onChange(field.key, value)}
              />
            ))}
          </div>
        </SettingsSection>
      ))}
      {!groups.length && <p className="muted">No matching settings.</p>}
    </>
  );
}

export function GameSettingField({
  field,
  game = '',
  value,
  onChange,
}: {
  field: QuickField;
  game?: string;
  value: QuickValue;
  onChange: (value: string | boolean) => void;
}) {
  const disabled = field.readonly || field.type === 'readonly';
  const {label, description: help, details} = settingCopy(field, game);
  const id = `game-property-${encodeURIComponent(field.key)}`;
  const helpId = help ? `${id}-help` : undefined;
  return (
    <SettingsRow
      className={`game-setting-row${field.type === 'boolean' ? ' is-boolean' : ''}`}
      infoLabel={`Details for ${label}`}
      info={
        <ul className="game-setting-details">
          {details.map(detail => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
      }
      label={
        <>
          <label htmlFor={id}>{label}</label>
          {disabled && (
            <span
              className="game-setting-managed"
              title={
                field.type === 'readonly'
                  ? 'This structured value needs the file editor.'
                  : 'Managed by the server or template.'
              }
            >
              {field.type === 'readonly' ? 'File editor' : 'Managed'}
            </span>
          )}
        </>
      }
      description={help ? <span id={helpId}>{help}</span> : undefined}
      control={
        <>
          {field.type === 'boolean' ? (
            <GameSwitch
              id={id}
              aria-label={label}
              aria-describedby={helpId}
              checked={value === true}
              disabled={disabled}
              onCheckedChange={checked => onChange(checked)}
            />
          ) : field.type === 'list' ? (
            <Textarea
              id={id}
              aria-label={label}
              aria-describedby={helpId}
              disabled={disabled}
              title="JSON list"
              rows={2}
              value={String(value ?? '[]')}
              onChange={event => onChange(event.target.value)}
            />
          ) : field.type === 'select' ? (
            <Select
              id={id}
              aria-label={label}
              aria-describedby={helpId}
              value={String(value ?? '')}
              disabled={disabled}
              onChange={event => onChange(event.target.value)}
            >
              {field.options?.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          ) : (
            <Input
              id={id}
              aria-label={label}
              aria-describedby={helpId}
              disabled={disabled}
              type={field.secret ? 'password' : field.type === 'number' ? 'number' : 'text'}
              autoComplete={field.secret ? 'new-password' : 'off'}
              min={field.min}
              max={field.max}
              step="any"
              placeholder={field.secret ? (field.configured ? 'Configured' : 'Not configured') : undefined}
              value={value === null ? '' : String(value)}
              onChange={event => onChange(event.target.value)}
            />
          )}
          {field.secret && field.configured && (
            <MiraAction type="button" className="game-setting-clear" disabled={disabled} onClick={() => onChange('')}>
              Clear
            </MiraAction>
          )}
        </>
      }
    />
  );
}
