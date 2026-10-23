import {useRef, useState, type FormEvent} from 'react';
import {Link, useNavigate, useParams} from 'react-router-dom';
import {api, Button, Card, ErrorBox, Field, Input, Select, unwrap} from '../lib';
import {json} from './common';
import {GameMemoryField, GameNameField, GameNodeField} from './GameSetupFields';
import {memoryMiB, type SteamGame, type SteamOptions} from './gameSetupModel';
import {SteamSetupForm} from './SteamGames';
import {useGameRequest} from './useGameRequest';
import {templateVariableControl, templateAdditionalPorts, templatePrimaryPort, templatePortsValid, templatePortRanges, templatePortEnvironment, type TemplatePortRule} from './gameTemplateModel';
import {GameLibraryCard,gameArtwork} from './GameLibraryCard';
import {compareGamePopularity} from './gameLibraryOrder';

type Template = {id: string; name: string; description: string; category: string; source: string; available: boolean; detail: string; verification: string; managed_game?: SteamGame; setup_steps?: string[]; platforms?: string[] | null; required_ports?: number; consecutive_ports?: boolean; consecutive_ports_count?: number; consecutive_primary_offset?: number; port_rules?: TemplatePortRule[] | null};
type Variable = {name: string; description: string; env_variable: string; default_value: string; rules: string; user_viewable: boolean};
type Allocation = {id: number; ip: string; port: number};
type TemplateOptions = Template & {nodes: {id: number; name: string; allocations: Allocation[]}[]; images: {label: string; value: string}[]; variables: Variable[]; defaults: {memory: number; disk: number}};

function TemplateVerification({template}: {template: Template}) {
  const label = template.verification === 'runtime_verified' ? 'Native hosting tested'
    : template.verification === 'runtime_partial' ? 'Partially tested: known limitations remain'
    : template.verification === 'runtime_failed' ? 'Runtime test failed'
    : 'Runtime not yet verified';
  return <div><p className="muted">{label}</p><p>{template.detail || 'Community template. Not yet verified on your node.'}</p></div>;
}

export function GameTemplateCatalog() {
  const request = useGameRequest<{games: Template[]; can_install: boolean}>('/api/client/game-library/templates');
  const [search, setSearch] = useState('');
  const games = request.data?.games ?? [];
  const matches = games.filter(game => `${game.name} ${game.category} ${game.description}`.toLowerCase().includes(search.toLowerCase())).sort(compareGamePopularity);
  return <section className="game-template-catalog">
    <div className="game-template-header">
      <div className="game-template-intro"><h2>All game templates</h2><p className="muted">Games, server mods, and variants. Check the setup page for requirements and testing details.</p></div>
      <Field label="Find a game"><Input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search games and variants"/></Field>
    </div>
    <ErrorBox>{request.error}</ErrorBox>{request.error && <Button onClick={request.reload} variant="secondary">Retry catalog</Button>}
    {request.loading && !request.data && <p role="status">Loading game catalog...</p>}
    {request.data && <p role="status" className="muted">{matches.length} of {games.length} recipes</p>}
    <div className="game-template-list">{matches.map(game=><GameLibraryCard key={game.id} name={game.name} subtitle={game.category.replaceAll('_',' ')} artwork={gameArtwork('templates',game.id)||gameArtwork('categories',game.category)} to={`/game-library/template/${game.id}`} note={game.verification==='runtime_verified'?'Hosting tested':game.verification==='runtime_partial'?'Partially tested':game.verification==='runtime_failed'?'Runtime test failed':'Runtime not verified'} noteTitle={game.detail} source={game.source} disabledReason={!game.available?'Compatibility review needed':!request.data?.can_install?'Administrator access required':undefined}/>)}</div>
  </section>;
}

export default function GameTemplateSetup() {
  const {template} = useParams();
  const request = useGameRequest<TemplateOptions>(template ? `/api/client/game-library/templates/${encodeURIComponent(template)}` : null);
  return <div className="page steam-setup-page"><header className="page-header"><div><Link to="/game-library">Game Library</Link><h1>{request.data?.name || 'Game'} setup</h1></div></header><ErrorBox>{request.error}</ErrorBox>{request.error && <Button onClick={request.reload} variant="secondary">Retry setup</Button>}{request.loading && !request.data && <p role="status">Loading game requirements...</p>}{request.data && (request.data.managed_game ? <ManagedTemplateSetup key={template} template={request.data} game={request.data.managed_game}/> : <TemplateSetupForm key={template} options={request.data}/>)}</div>;
}

function ManagedTemplateSetup({template, game}: {template: Template; game: SteamGame}) {
  const request = useGameRequest<SteamOptions>(`/api/client/game-library/steam/${encodeURIComponent(game)}`);
  return <><TemplateVerification template={template}/><ErrorBox>{request.error}</ErrorBox>{request.error && <Button onClick={request.reload} variant="secondary">Retry setup</Button>}{request.loading && !request.data && <p role="status">Loading game requirements...</p>}{request.data && <SteamSetupForm game={game} options={request.data}/>}</>;
}

function TemplateSetupForm({options}: {options: TemplateOptions}) {
  const navigate = useNavigate();
  const requiredPorts = Math.max(1, options.required_ports ?? 1);
  const consecutive = options.consecutive_ports ?? false;
  const consecutiveCount = options.consecutive_ports_count ?? 0;
  const primaryOffset = options.consecutive_primary_offset ?? 0;
  const [environment, setEnvironment] = useState<Record<string, string>>(() => Object.fromEntries(options.variables.map(variable => [variable.env_variable, variable.default_value])));
  const ranges = templatePortRanges(options.port_rules ?? [], environment);
  const initialNode = options.nodes.find(node => {const port=templatePrimaryPort(node.allocations, requiredPorts, consecutive, ranges, consecutiveCount, primaryOffset);return !!port && templatePortsValid(node.allocations, port.id, templateAdditionalPorts(node.allocations, port.id, requiredPorts, [], consecutive, ranges, consecutiveCount, primaryOffset), requiredPorts, consecutive, ranges, consecutiveCount, primaryOffset);}) ?? options.nodes[0];
  const [name, setName] = useState(`${options.name} server`);
  const [node, setNode] = useState(String(initialNode?.id ?? ''));
  const initialPrimary = templatePrimaryPort(initialNode?.allocations ?? [], requiredPorts, consecutive, ranges, consecutiveCount, primaryOffset);
  const [primary, setPrimary] = useState(String(initialPrimary?.id ?? ''));
  const [additional, setAdditional] = useState<number[]>(() => templateAdditionalPorts(initialNode?.allocations ?? [], initialPrimary?.id ?? 0, requiredPorts, [], consecutive, ranges, consecutiveCount, primaryOffset));
  const [memory, setMemory] = useState(String(options.defaults.memory / 1024));
  const [disk, setDisk] = useState(String(options.defaults.disk / 1024));
  const [image, setImage] = useState(options.images[0]?.value ?? '');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const submitting = useRef(false), submission = useRef<{payload: string; id: string} | null>(null);
  const allocations = options.nodes.find(item => String(item.id) === node)?.allocations ?? [];
  const memoryValue = memoryMiB(memory), diskValue = memoryMiB(disk);
  const address = allocations.find(item => String(item.id) === primary)?.ip;
  const portsValid = templatePortsValid(allocations, Number(primary), additional, requiredPorts, consecutive, ranges, consecutiveCount, primaryOffset);
  const portPreview = templatePortEnvironment(options.port_rules ?? [], environment, allocations, Number(primary), additional, consecutive, consecutiveCount, primaryOffset, requiredPorts);
  const valid = portsValid && !portPreview.error && !!name.trim() && memoryValue !== null && memoryValue >= 128 && memoryValue <= 1048576 && diskValue !== null && diskValue >= 128 && diskValue <= 16777216 && allocations.some(item => String(item.id) === primary) && options.images.some(item => item.value === image);
  function selectPrimary(value: string, ports = allocations) {setPrimary(value); setAdditional(previous => templateAdditionalPorts(ports, Number(value), requiredPorts, previous, consecutive, ranges, consecutiveCount, primaryOffset));}
  function selectNode(value: string) {const ports=options.nodes.find(item => String(item.id) === value)?.allocations ?? [];const port=templatePrimaryPort(ports, requiredPorts, consecutive, ranges, consecutiveCount, primaryOffset);setNode(value);setPrimary(String(port?.id ?? ''));setAdditional(templateAdditionalPorts(ports, port?.id ?? 0, requiredPorts, [], consecutive, ranges, consecutiveCount, primaryOffset));}
  function changeVariable(key: string, value: string) {
    const next = {...environment, [key]: value};
    const nextRanges = templatePortRanges(options.port_rules ?? [], next);
    setEnvironment(next);
    if (JSON.stringify(ranges) === JSON.stringify(nextRanges)) return;
    const selected = templateAdditionalPorts(allocations, Number(primary), requiredPorts, additional, consecutive, nextRanges, consecutiveCount, primaryOffset);
    if (templatePortsValid(allocations, Number(primary), selected, requiredPorts, consecutive, nextRanges, consecutiveCount, primaryOffset)) setAdditional(selected);
    else {
      const candidate = templatePrimaryPort(allocations, requiredPorts, consecutive, nextRanges, consecutiveCount, primaryOffset);
      setPrimary(String(candidate?.id ?? ''));
      setAdditional(templateAdditionalPorts(allocations, candidate?.id ?? 0, requiredPorts, [], consecutive, nextRanges, consecutiveCount, primaryOffset));
    }
  }
  async function install(event: FormEvent) {
    event.preventDefault(); if (!valid || submitting.current) return;
    const body = {name: name.trim(), memory: memoryValue, disk: diskValue, image, allocation_id: Number(primary), allocation_additional: additional, environment};
    const payload = JSON.stringify(body); if (submission.current?.payload !== payload) submission.current = {payload, id: crypto.randomUUID()};
    submitting.current = true; setBusy(true); setError('');
    try {const result = unwrap(await api(`/api/client/game-library/templates/${options.id}/install`, json('POST', {...body, request_id: submission.current.id}))); if (!result.identifier) throw Error('The response did not include a server. Check Overview before retrying.'); navigate(`/server/${encodeURIComponent(result.identifier)}/console`);}
    catch (error) {setError(error instanceof Error ? error.message : String(error));}
    finally {submitting.current = false; setBusy(false);}
  }
  const renderVariable = (variable: Variable) => {
    const rule = options.port_rules?.find(rule => rule.environment === variable.env_variable && rule.auto_allocate);
    const automatic = rule ? {active: !rule.when_environment || environment[rule.when_environment] === rule.when_value, port: portPreview.ports[variable.env_variable]} : undefined;
    return <TemplateVariable key={variable.env_variable} variable={variable} environment={environment} value={environment[variable.env_variable] ?? ''} automatic={automatic} onChange={value => changeVariable(variable.env_variable, value)}/>;
  };
  return <div className="steam-setup-layout"><Card><form onSubmit={install}><fieldset className="steam-fields" disabled={busy}>
    {!!options.platforms?.length && <p className="muted">Required node: {options.platforms.map(platform => platform.replace('linux/', 'Linux ').replace('arm64', 'ARM64').replace('amd64', 'x64')).join(', ')}. Only matching online nodes are listed.</p>}
    <GameNameField value={name} onChange={setName}/><div className="steam-form-grid"><GameNodeField value={node} onChange={selectNode} nodes={options.nodes.map(item => ({...item, free_allocations: item.allocations.length}))}/><GameMemoryField value={memory} onChange={setMemory} minimum={128} maximum={1048576}/><Field label="Storage (GiB)"><Input required type="number" min={0.125} max={16384} step={1 / 1024} value={disk} onChange={event => setDisk(event.target.value)}/></Field><Field label="Game port"><Select required value={primary} onChange={event => selectPrimary(event.target.value)}>{!allocations.length && <option value="">No available ports</option>}{allocations.map(item => <option key={item.id} value={item.id}>{item.ip}:{item.port}</option>)}</Select></Field></div>
    {requiredPorts > 1 && <p className={portsValid ? 'muted' : 'game-stop-note'} role="status">This recipe needs {requiredPorts} ports on the same address.{consecutive && <> A block of {consecutiveCount || requiredPorts} must be consecutive, starting {primaryOffset ? `${primaryOffset} ports below` : 'at'} the game port.</>} Available additional ports are selected automatically; review them below.{!portsValid && ' Add enough free ports on this address before creating the server.'}</p>}
    {ranges.map((range, index) => <p className={portsValid ? 'muted' : 'game-stop-note'} key={index}>This mode needs the game port and at least {range.count} total ports between {range.minimum} and {range.maximum}.{!!range.offsets?.length && <> Include allocations on the same address at {range.offsets.map(offset => `game port ${offset >= 0 ? '+' : '-'} ${Math.abs(offset)}`).join(', ')}.</>}{range.allocatedPort !== undefined && <> Include the configured port {range.allocatedPort} on the same address.</>}{!!range.allocated_offsets?.length && <> Include companion allocations at {range.allocated_offsets.map(offset => `${range.environment ?? 'service port'} ${offset >= 0 ? '+' : '-'} ${Math.abs(offset)}`).join(', ')} on that address.</>}{range.invalidEnvironment && <> {range.auto_allocate ? 'Leave blank for an automatic port, or choose an allocated port from 1 through 65535.' : 'Set this optional port to 0 to disable it, or choose an allocated port from 1 through 65535.'}</>}</p>)}
    {!!Object.keys(portPreview.ports).length && <p className="muted" role="status">Service ports: {Object.entries(portPreview.ports).map(([key, port]) => {const offsets=options.port_rules?.find(rule=>rule.environment===key)?.allocated_offsets??[];return `${options.variables.find(variable => variable.env_variable === key)?.name ?? key}: ${[port,...offsets.map(offset=>port+offset)].map(value=>`${address}:${value}`).join(', ')}`;}).join('; ')}.</p>}
    {portPreview.error && options.port_rules?.some(rule => rule.auto_allocate) && <p className="game-stop-note" role="status">{portPreview.error}</p>}
    <h2>Game settings</h2><div className="steam-form-grid">{options.variables.filter(variable => variable.user_viewable).map(renderVariable)}</div>
    <details className="steam-advanced"><summary>Runtime and additional ports</summary><div className="steam-form-grid"><Field label="Runtime image"><Select value={image} onChange={event => setImage(event.target.value)}>{options.images.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</Select></Field>{options.variables.filter(variable => !variable.user_viewable).map(renderVariable)}</div><p className="muted">Allocate the ports required by the recipe and set matching query, RCON or secondary port settings above.</p>{allocations.filter(item => String(item.id) !== primary && (requiredPorts <= 1 || item.ip === address)).map(item => <label className="check" key={item.id}><input type="checkbox" checked={additional.includes(item.id)} onChange={event => setAdditional(previous => event.target.checked ? [...previous, item.id] : previous.filter(id => id !== item.id))}/>{item.ip}:{item.port}</label>)}</details>
    {!allocations.length && <p className="game-stop-note">{!options.nodes.length ? options.platforms?.length ? 'No matching online nodes are available. Connect a node with the required platform, then reload this setup.' : 'Add an available node in Admin > Nodes, then reload this setup.' : 'Add free ports to this node in Admin > Nodes before creating the server.'}</p>}
    <ErrorBox>{error}</ErrorBox><Button type="submit" disabled={!valid || busy} aria-busy={busy}>{busy ? 'Creating server...' : 'Create server'}</Button>
  </fieldset></form></Card><aside><h2>Runtime verification</h2><TemplateVerification template={options}/><h2>Recipe requirements</h2><p className="template-description">{options.description}</p><p className="muted">Resource defaults are starting values, not a verified recommendation for this game. Adjust them to the publisher's requirements. Installation runs first; start the server from Console when it finishes.</p>{!!options.setup_steps?.length && <><h2>After installation</h2><ol>{options.setup_steps.map((step, index) => <li key={index}>{step}</li>)}</ol></>}<a href={options.source} target="_blank" rel="noreferrer">Read the upstream recipe</a></aside></div>;
}

function TemplateVariable({variable, environment, value, automatic, onChange}: {variable: Variable; environment: Record<string, string>; value: string; automatic?: {active: boolean; port?: number}; onChange: (value: string) => void}) {
  const control = templateVariableControl(variable, environment);
  const hint = automatic ? `${variable.description} ${automatic.active ? `Leave blank to select a port automatically.${automatic.port === undefined ? '' : ` Selected: ${automatic.port}.`}` : 'This port is inactive for the current game settings; its value is retained.'}` : variable.description;
  return <Field label={variable.name} hint={hint}>{control.choices ? <Select value={value} required={control.required} onChange={event => onChange(event.target.value)}>{control.choices.map(choice => <option key={choice} value={choice}>{choice}</option>)}</Select> : <Input value={value} required={control.required && !automatic} disabled={automatic && !automatic.active} placeholder={automatic?.active ? 'Automatic' : undefined} type={control.secret ? 'password' : control.numeric ? 'number' : 'text'} min={control.numeric ? control.minimum : undefined} max={control.numeric ? control.maximum : undefined} step={control.numeric ? control.step : undefined} autoComplete={control.secret ? 'new-password' : 'off'} onChange={event => onChange(event.target.value)}/>}</Field>;
}


