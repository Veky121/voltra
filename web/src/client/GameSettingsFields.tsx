import {settingDescription} from './settingDescription';
import {Input, Select, Textarea} from '../lib';
import type {QuickField, QuickValue} from './gameSetupModel';
import {GameSwitch} from './GameSwitch';
import {readableSettingName, settingsGroups} from './gameSettingsLayout';

export function GameSettingsFields({fields, game, file, search, draft, onChange}: {fields: QuickField[]; game: string; file: string; search: string; draft: Record<string, QuickValue>; onChange: (key: string, value: string | boolean) => void}) {
  const query = search.trim().toLowerCase();
  const groups = settingsGroups(fields, game, file).map(group => ({...group, fields: group.fields.filter(field => `${field.key} ${readableSettingName(field)}`.toLowerCase().includes(query))})).filter(group => group.fields.length);
  return <>{groups.map(group => <section key={group.id} className="game-settings-section" aria-label={group.label}><h4>{group.label}</h4><div className="game-properties-grid">{group.fields.map(field => <GameSettingField key={field.key} field={field} value={Object.hasOwn(draft, field.key) ? draft[field.key] : field.value} onChange={value => onChange(field.key, value)}/>)}</div></section>)}{!groups.length && <p className="muted">No matching settings.</p>}</>;
}

export function GameSettingField({field, value, onChange}: {field: QuickField; value: QuickValue; onChange: (value: string | boolean) => void}) {
  const disabled = field.readonly || field.type === 'readonly';
  const label = readableSettingName(field);
  const id = `game-property-${encodeURIComponent(field.key)}`;
  const help = typeof field.help === 'string' ? settingDescription(field.help) : '';
  const helpId = help ? `${id}-help` : undefined;
  return <div className={`game-setting-row${field.type === 'boolean' ? ' is-boolean' : ''}`}><div className="game-setting-identity"><label htmlFor={id}>{label}</label><code className="startup-variable-key">{field.key}</code>{disabled && <span className="game-setting-managed" title={field.type === 'readonly' ? 'This structured value needs the file editor.' : 'Managed by the server or template.'}>{field.type === 'readonly' ? 'File editor' : 'Managed'}</span>}{help && <small id={helpId} className="game-setting-help">{help}</small>}</div><div className="game-setting-control">
    {field.type === 'boolean' ? <GameSwitch id={id} aria-label={label} aria-describedby={helpId} checked={value === true} disabled={disabled} onCheckedChange={checked => onChange(checked)}/>
      : field.type === 'list' ? <Textarea id={id} aria-label={label} aria-describedby={helpId} disabled={disabled} title="JSON list" rows={2} value={String(value ?? '[]')} onChange={event => onChange(event.target.value)}/>
      : field.type === 'select' ? <Select id={id} aria-label={label} aria-describedby={helpId} value={String(value ?? '')} disabled={disabled} onChange={event => onChange(event.target.value)}>{field.options?.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</Select>
      : <Input id={id} aria-label={label} aria-describedby={helpId} disabled={disabled} type={field.secret ? 'password' : field.type === 'number' ? 'number' : 'text'} autoComplete={field.secret ? 'new-password' : 'off'} min={field.min} max={field.max} step="any" placeholder={field.secret ? field.configured ? 'Configured' : 'Not configured' : undefined} value={value === null ? '' : String(value)} onChange={event => onChange(event.target.value)}/>}
    {field.secret && field.configured && <button type="button" className="game-setting-clear" disabled={disabled} onClick={() => onChange('')}>Clear</button>}
  </div></div>;
}
