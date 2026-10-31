import {miBToGB} from "../resourceUnits.ts";
import {startupVariableSection} from './startupSettingsModel';
import {GameSwitch} from './GameSwitch';
import './games-ui.css';
import {useRef, useState, type FormEvent} from 'react';
import {Link, useNavigate, useParams} from 'react-router-dom';
import {api, Button, Card, ErrorBox, Field, Input, Select, unwrap} from '../lib';
import {GameLibraryCard,gameArtwork} from './GameLibraryCard';
import {json} from './common';
import {memoryMiB, gameInitialNode, gameMemoryBudget, steamMemoryWarning, steamAdvancedEnvironment, type SteamAdvancedField, type GameHelp, type GameProfile, type SteamGame, type SteamOptions} from './gameSetupModel';
import {useGameRequest} from './useGameRequest';
import {GameNameField, GameMemoryField, GameNodeField} from './GameSetupFields';
import './steamGames.css';
import {GamePorts, useGamePortPlan, rememberInstallationPorts} from './GamePorts';

export function GameHelpLinks({help}: {help: GameHelp[]}) {
  return <div className="game-help">{help.map((item, index) => <div key={`${item.label}-${index}`}><strong>{item.url && /^https?:\/\//.test(item.url) ? <a href={item.url} target="_blank" rel="noreferrer">{item.label} ↗</a> : item.label}</strong>{item.text && <p>{item.text}</p>}</div>)}</div>;
}

export function SteamGameTiles() {
  const request = useGameRequest<{games: GameProfile[]}>('/api/client/game-library/steam');
  return <><ErrorBox>{request.error}</ErrorBox>{request.error && <Button variant="secondary" onClick={request.reload}>Retry games</Button>}{request.loading && !request.data && <p role="status">Loading games...</p>}{request.data?.games.map(game=><GameLibraryCard key={game.id} name={game.name} subtitle="Dedicated server · Steam updates" artwork={gameArtwork('steam',game.id)} to={`/game-library/${game.id}`} guided/>)}</>;
}

export default function SteamGames() {
  const {game} = useParams();
  const request = useGameRequest<SteamOptions>(game && /^[a-z0-9-]+$/.test(game) ? `/api/client/game-library/steam/${encodeURIComponent(game)}` : null);
  return <div className="page steam-setup-page games-ui">
    <header className="page-header"><div><Link className="steam-back" to="/game-library">← Game Library</Link><h1>{request.data?.name || 'Game'} easy setup</h1><p className="muted">Create a dedicated server with Steam updates managed by the panel.</p></div></header>
    {!game ? <ErrorBox>This game does not have Steam easy setup.</ErrorBox> : <>
      <ErrorBox>{request.error}</ErrorBox>{request.error && <Button variant="secondary" onClick={request.reload}>Retry game options</Button>}
      {request.loading && !request.data && <p role="status">Loading setup options...</p>}
      {request.data && <SteamSetupForm key={game} game={game} options={request.data}/>}
    </>}
  </div>;
}

export function SteamSetupForm({game, options}: {game: SteamGame; options: SteamOptions}) {
  const navigate = useNavigate();
  const initialNode=gameInitialNode(options.nodes);
  const initialBudget=gameMemoryBudget(options.maximum_memory,initialNode);
  const [name, setName] = useState(`${options.name} server`);
  const [gameName, setGameName] = useState(`${options.name} server`);
  const [node, setNode] = useState(String(initialNode?.id ?? ''));
  const [memory, setMemory] = useState(String(miBToGB(initialBudget>=options.minimum_memory ? Math.min(options.defaults.memory,initialBudget) : options.defaults.memory)));
  const players = String(options.defaults.max_players);
  const [password, setPassword] = useState('');
  const preset = options.presets[0]?.value ?? '';
  const [startAfterInstall, setStartAfterInstall] = useState(true);
  const advancedFields = options.advanced_fields ?? [];
  const setupFields = advancedFields.filter(field => {
    if (startupVariableSection({env_variable: field.key}) === 'runtime') return true;
    try {steamAdvancedEnvironment([field], {[field.key]: field.type === 'boolean' ? field.default === '1' : field.default}); return false;} catch {return true;}
  });
  const [advanced, setAdvanced] = useState<Record<string, string | boolean>>(() => Object.fromEntries(advancedFields.map(field => [field.key, field.type === 'boolean' ? field.default === '1' : field.default])));
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const submitting = useRef(false);
  const submission = useRef<{payload: string; id: string} | null>(null);
  const memoryValue = memoryMiB(memory);
  const selectedNode=options.nodes.find(item=>String(item.id)===node);
  const portEnvironment = Object.fromEntries(advancedFields.filter(field => !field.secret && /PORT/i.test(field.key)).map(field => [field.key, advanced[field.key] ?? field.default]));
  const ports = useGamePortPlan(`/api/client/game-library/steam/${encodeURIComponent(game)}/ports`, node, portEnvironment);
  const memoryMaximum=gameMemoryBudget(options.maximum_memory,selectedNode);
  const memoryWarning = steamMemoryWarning(options, memoryValue);
  const passwordRules = options.password ?? {enabled: game === 'palworld', required: false, min_length: 0, max_length: 128};
  const passwordValid = !passwordRules.enabled || ((!passwordRules.required && !password) || ([...password].length >= passwordRules.min_length && [...password].length <= passwordRules.max_length));
  const valid = passwordValid && !!gameName.trim() && gameName.length <= 100 && !!name.trim() && options.nodes.some(item => String(item.id) === node && item.setup_available !== false) && memoryValue !== null && memoryValue >= options.minimum_memory && memoryValue <= memoryMaximum && Number.isInteger(Number(players)) && Number(players) >= options.minimum_players && Number(players) <= options.maximum_players && (!options.presets.length || options.presets.some(item => item.value === preset));
  async function install(event: FormEvent) {
    event.preventDefault();
    if (!valid || !ports.data || ports.loading || ports.error || !options.can_install || submitting.current) return;
    let environment: Record<string, string | boolean>;
    try {environment = steamAdvancedEnvironment(advancedFields, advanced);} catch (error) {setError(error instanceof Error ? error.message : String(error)); return;}
    const body = {name: name.trim(), ...(options.supports_game_name ? {game_name: gameName.trim()} : {}), node_id: Number(node), memory: memoryValue, max_players: Number(players), ...(password ? {server_password: password} : {}), ...(preset ? {preset} : {}), ...(advancedFields.length ? {environment} : {}), ...(options.supports_install_only === true ? {start_on_completion: startAfterInstall} : {})};
    const payload = JSON.stringify(body);
    if (submission.current?.payload !== payload) submission.current = {payload, id: crypto.randomUUID()};
    submitting.current = true; setBusy(true); setError('');
    try {
      const result = unwrap(await api(`/api/client/game-library/steam/${game}/install`, json('POST', {...body, request_id: submission.current.id})));
      if (!result?.identifier) throw new Error('The install response did not include a server. Check Overview before retrying.');
      rememberInstallationPorts(result.identifier, result.ports);
      navigate(`/server/${encodeURIComponent(result.identifier)}/steam`);
    } catch (error) {setError(error instanceof Error ? error.message : String(error));}
    finally {submitting.current = false; setBusy(false);}
  }
  return <div className="steam-setup-layout games-ui"><Card><form onSubmit={install}>
    <fieldset className="steam-fields" disabled={busy}>
      <GameNameField value={name} onChange={setName}/>
      {options.supports_game_name && <Field label="In-game server name"><Input required maxLength={100} autoComplete="off" value={gameName} onChange={event => setGameName(event.target.value)}/></Field>}
      <div className="steam-form-grid"><GameNodeField value={node} onChange={setNode} nodes={options.nodes}/><GameMemoryField value={memory} onChange={setMemory} minimum={options.minimum_memory} maximum={Math.max(options.minimum_memory,memoryMaximum)} describedBy={memoryWarning ? "steam-memory-warning" : undefined}/></div>
      
      {selectedNode?.unavailable_reason && <p className="game-stop-note" role="status">{selectedNode.unavailable_reason}</p>}
      {memoryValue !== null && memoryValue > memoryMaximum && <p className="game-stop-note" role="status">This node has {miBToGB(memoryMaximum)} GB available for allocation. Lower the limit or choose another node.</p>}
      {memoryWarning && <p id="steam-memory-warning" className="game-stop-note" role="status">{memoryWarning}</p>}
      <GamePorts plan={ports.data} loading={ports.loading} error={ports.error} retry={ports.reload}/>
      {passwordRules.enabled && passwordRules.required && <Field label="Server password" hint={passwordRules.required ? `Required, ${passwordRules.min_length} to ${passwordRules.max_length} characters.` : 'Optional. Players use this when joining.'}><Input type="password" autoComplete="new-password" required={passwordRules.required} minLength={passwordRules.min_length} maxLength={passwordRules.max_length} value={password} onChange={event => setPassword(event.target.value)}/></Field>}
      <p className="muted">Game defaults are ready to use. Edit player limits, optional passwords and gameplay options in Settings after creation.</p>
      <details className="steam-advanced"><summary>Installation options</summary><div className="steam-form-grid">
        <SteamAdvancedControls fields={setupFields} values={advanced} onChange={(key, value) => setAdvanced(previous => ({...previous, [key]: value}))}/>
        {options.supports_install_only === true && <label className="game-boolean"><GameSwitch checked={startAfterInstall} onCheckedChange={checked => setStartAfterInstall(checked)}/><span>Start server after installation</span></label>}
        
      </div></details>
      {!options.can_install && <p className="muted">You do not have permission to create this server.</p>}
      {!options.nodes.length && <p className="muted">No connected compatible Steam node is available. Ask an administrator to connect or upgrade a Linux amd64 node.</p>}
      <ErrorBox>{error}</ErrorBox><div className="steam-submit"><Button type="submit" disabled={!valid || !ports.data || ports.loading || !!ports.error || !options.can_install || busy} aria-busy={busy}>{busy ? 'Creating server...' : 'Create server'}</Button><span className="muted">{options.supports_install_only === true && !startAfterInstall ? 'Steam installs the game and leaves the server stopped.' : 'Steam installs the game, then starts the server.'}</span></div>
    </fieldset>
  </form></Card><aside className="steam-next"><h2>After setup</h2><p>{options.after_setup}</p><GameHelpLinks help={options.help ?? []}/></aside></div>;
}

export function SteamAdvancedControls({fields, values, onChange}: {fields: SteamAdvancedField[]; values: Record<string, string | boolean>; onChange: (key: string, value: string | boolean) => void}) {
  return <>{fields.map(field => field.type === 'boolean' ? <label className="game-boolean" key={field.key}><GameSwitch checked={values[field.key] === true} onCheckedChange={checked => onChange(field.key, checked)}/><span>{field.label}</span></label> : <Field key={field.key} label={field.label} hint={field.description}>{field.type === 'select' ? <Select value={String(values[field.key] ?? field.default)} onChange={event => onChange(field.key, event.target.value)}>{field.options?.map(option => <option key={option} value={option}>{option}</option>)}</Select> : <Input type={field.secret ? 'password' : field.type === 'number' || field.type === 'integer' ? 'number' : 'text'} autoComplete={field.secret ? 'new-password' : 'off'} value={String(values[field.key] ?? '')} min={field.min} max={field.max} step={field.type === 'integer' ? 1 : 'any'} maxLength={field.max_length} required={field.required || field.type === 'integer' || field.type === 'number'} onChange={event => onChange(field.key, event.target.value)}/>}</Field>)}</>;
}

