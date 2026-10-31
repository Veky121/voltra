import {miBToGB} from "../resourceUnits.ts";
import {startupVariableSection} from './startupSettingsModel';
import {GameSwitch} from './GameSwitch';
import {useRef, useState, type FormEvent} from 'react';
import {Link, useNavigate, useParams} from 'react-router-dom';
import {api, Button, Card, ErrorBox, Field, Input, Select, unwrap} from '../lib';
import {json} from './common';
import {GameAgreementField, GameMemoryField, GameNameField, GameNodeField} from './GameSetupFields';
import {memoryMiB, gameInitialNode, gameMemoryBudget, gameResourceBudget, type SetupNode, type SteamGame, type SteamOptions} from './gameSetupModel';
import {SteamSetupForm} from './SteamGames';
import {useGameRequest} from './useGameRequest';
import {type GameAgreement, templateMemoryWarning, templateStorageWarning, templateVariableControl, templateVariableProblem, type TemplatePortRule} from './gameTemplateModel';
import {templateSetupProblems} from './templateSetupValidation';
import {GamePorts, useGamePortPlan, rememberInstallationPorts} from './GamePorts';
import {GameLibraryCard,gameArtwork} from './GameLibraryCard';
import {compareGamePopularity} from './gameLibraryOrder';
import {isMinecraftTemplate, minecraftProjectKey} from './minecraftCommunityModel';
import communityArtwork from './minecraftCommunityArtwork.json';
import type {GameArtwork} from './GameLibraryCard';
import {clearTemplateSteamSecrets, templateSteamDefault, templateSteamEnvironment, templateSteamRole, type TemplateSteamInstallation} from './privateSteamTemplateModel';

type Template = {profile?: string; id: string; name: string; description: string; category: string; source: string; available: boolean; detail: string; verification: string; managed_game?: SteamGame; setup_steps?: string[]; platforms?: string[] | null; required_ports?: number; consecutive_ports?: boolean; consecutive_ports_count?: number; consecutive_primary_offset?: number; port_rules?: TemplatePortRule[] | null};
type Variable = {name: string; description: string; env_variable: string; default_value: string; rules: string; user_viewable: boolean};
type Allocation = {id: number; ip: string; port: number};
type TemplateOptions = Template & {egg_id?: number; saved_license?: boolean; steam_installation?: TemplateSteamInstallation; agreements?: GameAgreement[]; private_content_supported?: boolean; nodes: (SetupNode & {allocations: Allocation[]; private_content_ready?: boolean})[]; images: {label: string; value: string}[]; variables: Variable[]; defaults: {memory: number; disk: number}};

function TemplateVerification({template}: {template: Template}) {
  const label = template.verification === 'runtime_verified' ? 'Native hosting tested'
    : template.verification === 'runtime_partial' ? 'Partially tested: known limitations remain'
    : template.verification === 'runtime_failed' ? 'Runtime test failed'
    : 'Runtime not yet verified';
  return <div><p className="muted">{label}</p><p>{template.detail || 'Community template. Not yet verified on your node.'}</p></div>;
}

export function GameTemplateCatalog({minecraftOnly = false}: {minecraftOnly?: boolean}) {
  const request = useGameRequest<{games: Template[]; can_install: boolean}>('/api/client/game-library/templates');
  const [search, setSearch] = useState('');
  const games = (request.data?.games ?? []).filter(game => isMinecraftTemplate(game) === minecraftOnly);
  const matches = games.filter(game => `${game.name} ${game.category} ${game.description}`.toLowerCase().includes(search.toLowerCase())).sort(compareGamePopularity);
  return <section className="game-template-catalog games-ui">
    <div className="game-template-header">
      <div className="game-template-intro"><h2>{minecraftOnly ? 'Choose your server software' : 'All game templates'}</h2><p className="muted">{minecraftOnly ? 'Minecraft server software, community loaders, crossplay tools and proxies. Community projects are independent of Mojang; vanilla Bedrock is also listed here.' : 'Games, server mods, and variants. Minecraft variants are grouped under Minecraft above.'}</p></div>
      <Field label={minecraftOnly ? 'Find server software' : 'Find a game'}><Input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder={minecraftOnly ? 'Search Paper, Fabric, proxies…' : 'Search games and variants'}/></Field>
    </div>
    <ErrorBox>{request.error}</ErrorBox>{request.error && <Button onClick={request.reload} variant="secondary">Retry catalog</Button>}
    {request.loading && !request.data && <p role="status">Loading game catalog...</p>}
    {request.data && <p role="status" className="muted">{matches.length} of {games.length} recipes</p>}
    <div className="game-template-list">{matches.map(game=><GameLibraryCard key={game.id} name={game.name} subtitle={minecraftOnly ? 'Minecraft community' : game.category.replaceAll('_',' ')} artwork={(minecraftOnly ? (communityArtwork as Record<string, GameArtwork>)[minecraftProjectKey(game.source) ?? ''] : undefined)||gameArtwork('templates',game.id)||gameArtwork('categories',game.category)} to={`/game-library/template/${game.id}`} note={game.verification==='runtime_verified'?'Hosting tested':game.verification==='runtime_partial'?'Partially tested':game.verification==='runtime_failed'?'Runtime test failed':'Runtime not verified'} noteTitle={game.detail} source={game.source} disabledReason={!game.available?'Compatibility review needed':!request.data?.can_install?'Administrator access required':undefined}/>)}</div>
    {minecraftOnly && <details className="library-artwork-credits"><summary>Project artwork credits</summary><p>Project logos belong to their respective owners and are displayed unchanged. Inclusion does not imply endorsement. <a href="https://docs.papermc.io/misc/assets/" target="_blank" rel="noreferrer">PaperMC artwork guidelines</a>.</p><ul>{Object.entries(communityArtwork).filter(([key]) => key !== 'spongevanilla').map(([key, art]) => <li key={key}><a href={art.sourcePage} target="_blank" rel="noreferrer">{art.title}</a><span>{art.credit}</span></li>)}</ul></details>}
  </section>;
}

export default function GameTemplateSetup() {
  const {template} = useParams();
  const request = useGameRequest<TemplateOptions>(template ? `/api/client/game-library/templates/${encodeURIComponent(template)}` : null);
  return <div className="page steam-setup-page games-ui"><header className="page-header"><div><Link to="/game-library">Game Library</Link><h1>{request.data?.name || 'Game'} setup</h1></div></header><ErrorBox>{request.error}</ErrorBox>{request.error && <Button onClick={request.reload} variant="secondary">Retry setup</Button>}{request.loading && !request.data && <p role="status">Loading game requirements...</p>}{request.data && (request.data.managed_game ? <ManagedTemplateSetup key={template} template={request.data} game={request.data.managed_game}/> : <TemplateSetupForm key={template} options={request.data}/>)}</div>;
}

function ManagedTemplateSetup({template, game}: {template: Template; game: SteamGame}) {
  const request = useGameRequest<SteamOptions>(`/api/client/game-library/steam/${encodeURIComponent(game)}`);
  return <><TemplateVerification template={template}/><ErrorBox>{request.error}</ErrorBox>{request.error && <Button onClick={request.reload} variant="secondary">Retry setup</Button>}{request.loading && !request.data && <p role="status">Loading game requirements...</p>}{request.data && <SteamSetupForm game={game} options={request.data}/>}</>;
}

export function TemplateSetupForm({options}: {options: TemplateOptions}) {
  const fs25 = options.profile?.startsWith('fs25-') ?? options.name === 'Farming Simulator 25';
  const navigate = useNavigate();
  const initialNode = gameInitialNode(fs25 ? options.nodes.filter(node => (node.available_disk ?? 0) >= options.defaults.disk && (node.available_memory ?? 0) >= options.defaults.memory) : options.nodes) ?? gameInitialNode(options.nodes);
  const [environment, setEnvironment] = useState<Record<string, string>>(() => clearTemplateSteamSecrets(Object.fromEntries(options.variables.map(variable => [variable.env_variable, variable.default_value])), options.steam_installation));
  const [privateContent, setPrivateContent] = useState(templateSteamDefault(options.steam_installation, !!options.private_content_supported));
  const [name, setName] = useState(`${options.name} server`);
  const [node, setNode] = useState(String(initialNode?.id ?? ''));
  const [memory, setMemory] = useState(String(miBToGB(Math.min(options.defaults.memory, Math.max(128, gameMemoryBudget(1048576, initialNode))))));
  const [disk, setDisk] = useState(String(miBToGB(Math.min(options.defaults.disk, Math.max(128, gameResourceBudget(16777216, initialNode?.available_disk))))));
  const [image, setImage] = useState(options.images[0]?.value ?? '');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const submitting = useRef(false), submission = useRef<{payload: string; id: string} | null>(null);
  const setupForm=useRef<HTMLFormElement>(null);
  let safeEnvironment: Record<string, string> = {}, steamEnvironmentError = '';
  try {safeEnvironment = templateSteamEnvironment(environment, privateContent, options.steam_installation);} catch (error) {steamEnvironmentError = error instanceof Error ? error.message : 'Use reviewed Steam maintenance for private inputs.';}
  const ports = useGamePortPlan(`/api/client/game-library/templates/${encodeURIComponent(options.id)}/ports`, node, safeEnvironment, !steamEnvironmentError);
  const memoryValue = memoryMiB(memory), diskValue = memoryMiB(disk);
  const memoryWarning = templateMemoryWarning(options.name, memoryValue, options.defaults.memory);
  const storageWarning = templateStorageWarning(options.name, diskValue, options.defaults.disk);
  const selectedNode = options.nodes.find(item => String(item.id) === node);
  const memoryMaximum = gameMemoryBudget(1048576, selectedNode), diskMaximum = gameResourceBudget(16777216, selectedNode?.available_disk);
  // Decide from original defaults so correcting a required field never removes it.
  const defaultEnvironment = Object.fromEntries(options.variables.map(variable => [variable.env_variable, variable.default_value]));
  const setupVariables = options.variables.filter(variable => startupVariableSection(variable) === 'runtime'
    || !!templateVariableProblem(variable, defaultEnvironment)
    || /(?:^|\|)required_(?:if|unless|with|without)/.test(variable.rules)
    || fs25 && ['SERVER_NAME', 'WEB_PASSWORD', 'AUTO_DOWNLOAD'].includes(variable.env_variable));
  const checkedVariables=options.variables.filter(variable=>!(fs25&&['WEB_PORT'].includes(variable.env_variable))&&!options.agreements?.some(agreement=>agreement.environment===variable.env_variable)&&(!templateSteamRole(variable.env_variable)||templateSteamRole(variable.env_variable)==='branch')&&!(privateContent&&['SRCDS_APPID','AUTO_UPDATE'].includes(variable.env_variable))&&!options.port_rules?.some(rule=>rule.auto_allocate&&rule.environment===variable.env_variable));
  const setupProblems=templateSetupProblems({name,node:selectedNode,memory:memoryValue,memoryMaximum,disk:diskValue,diskMaximum,imageValid:options.images.some(item=>item.value===image),portsReady:!!ports.data,portsLoading:ports.loading,portsError:!!ports.error,steamError:!!steamEnvironmentError,privateContent,privateSupported:options.private_content_supported===true,fs25,savedLicence:!!options.saved_license,variables:checkedVariables,environment,agreements:options.agreements});
  const valid=setupProblems.length===0;
  function focusProblem(id:string){
    const field=setupForm.current?.querySelector<HTMLElement>(`[id="${id}"]`);
    for(let parent=field?.parentElement;parent&&parent!==setupForm.current;parent=parent.parentElement)if(parent instanceof HTMLDetailsElement)parent.open=true;
    field?.scrollIntoView({block:'center',behavior:'auto'});field?.focus({preventScroll:true});
  }
  async function install(event: FormEvent) {
    event.preventDefault(); if (!valid || submitting.current) return;
    const body = {name: name.trim(), memory: memoryValue, disk: diskValue, image, node_id: Number(node), automatic_ports: true, environment: safeEnvironment, ...(privateContent ? {private_content: true} : {})};
    const payload = JSON.stringify(body); if (submission.current?.payload !== payload) submission.current = {payload, id: crypto.randomUUID()};
    submitting.current = true; setBusy(true); setError('');
    try {
      const result = unwrap(await api(`/api/client/game-library/templates/${options.id}/install`, json('POST', {...body, request_id: submission.current.id})));
      if (!result.identifier) throw Error('The response did not include a server. Check Overview before retrying.');
      rememberInstallationPorts(result.identifier, result.ports);
      navigate(`/server/${encodeURIComponent(result.identifier)}/${privateContent ? 'steam' : 'console'}`);
    } catch (error) {setError(error instanceof Error ? error.message : String(error));}
    finally {submitting.current = false; setBusy(false);}
  }
  const renderVariable = (variable: Variable) => {
    if (fs25 && variable.env_variable === 'SERVER_NAME') variable = {...variable, name: 'In-game server name'};
    if (fs25 && ['WEB_PORT'].includes(variable.env_variable)) return null;
    if (options.agreements?.some(agreement => agreement.environment === variable.env_variable)) return null;
    const steamRole = templateSteamRole(variable.env_variable);
    if (steamRole && steamRole !== 'branch') return null;
    if (privateContent && ['SRCDS_APPID', 'AUTO_UPDATE'].includes(variable.env_variable)) return null;
    const rule = options.port_rules?.find(rule => rule.environment === variable.env_variable && rule.auto_allocate);
    const automatic = rule ? {active: !rule.when_environment || environment[rule.when_environment] === rule.when_value, port: ports.data?.ports.find(port => port.role === variable.env_variable)?.port} : undefined;
    return <TemplateVariable key={variable.env_variable} variable={variable} environment={environment} value={environment[variable.env_variable] ?? ''} privateCarrier={options.steam_installation?.legacy_branch_field === variable.env_variable} automatic={automatic} onChange={value => setEnvironment(previous => ({...previous, [variable.env_variable]: value}))}/>;
  };
  return <div className="steam-setup-layout" style={fs25 ? {display:"block"} : undefined}><Card><form ref={setupForm} onSubmit={install}><fieldset className="steam-fields" disabled={busy}>
    {!!options.platforms?.length && <p className="muted">Required node: {options.platforms.map(platform => platform.replace('linux/', 'Linux ').replace('arm64', 'ARM64').replace('amd64', 'x64')).join(', ')}. Only matching online nodes are listed.</p>}
    <GameNameField value={name} onChange={setName}/><div className="steam-form-grid"><GameNodeField value={node} onChange={setNode} nodes={options.nodes}/><GameMemoryField value={memory} onChange={setMemory} minimum={128} maximum={Math.max(128, memoryMaximum)} describedBy={memoryWarning ? "game-template-memory-warning" : undefined}/><Field label="Storage (GB)"><Input id="game-server-storage" required type="number" min={0.125} max={miBToGB(Math.max(128, diskMaximum))} step="any" value={disk} aria-describedby={storageWarning ? "game-template-storage-warning" : undefined} onChange={event => setDisk(event.target.value)}/></Field></div>
    {memoryWarning && <p id="game-template-memory-warning" className="game-stop-note" role="status">{memoryWarning}</p>}
    {storageWarning && <p id="game-template-storage-warning" className="game-stop-note" role="status">{storageWarning}</p>}
    {(options.steam_installation || options.private_content_supported) && <><Field label="Steam installation"><Select value={privateContent ? 'private' : 'public'} onChange={event => {const next = event.target.value === 'private'; setPrivateContent(next); setEnvironment(previous => clearTemplateSteamSecrets(previous, options.steam_installation));}}><option value="private">Use my Steam account after preparation</option><option value="public">Anonymous Steam installation</option></Select></Field>{privateContent && <p className="muted">Preparation creates the server directory and runtime helpers. Add your Steam authorization on the next page to download game files. Public automatic updates are disabled.</p>}{privateContent && !options.private_content_supported && <p role="status" className="game-stop-note">{options.steam_installation?.private_reason || 'Private Steam setup for this recipe needs a reviewed publication policy.'}</p>}{privateContent && options.private_content_supported && selectedNode?.private_content_ready !== true && <p role="status" className="game-stop-note">Private Steam installation is not enabled on this node. Choose a node with a trusted private Steam worker.</p>}</>}
    {selectedNode?.unavailable_reason && <p className="game-stop-note" role="status">{selectedNode.unavailable_reason}</p>}
    {((memoryValue !== null && memoryValue > memoryMaximum) || (diskValue !== null && diskValue > diskMaximum)) && <p className="game-stop-note" role="status">This node has {miBToGB(memoryMaximum)} GB of memory and {miBToGB(diskMaximum)} GB of storage available for allocation. Lower the limits or choose another node.</p>}
    {steamEnvironmentError && <p role="alert">{steamEnvironmentError}</p>}
    <div id="game-template-ports" tabIndex={-1}><GamePorts plan={ports.data} loading={ports.loading} error={ports.error} retry={ports.reload}/></div>
    {options.agreements?.map(agreement => <GameAgreementField key={agreement.environment} agreement={agreement} value={environment[agreement.environment] ?? "0"} onChange={value => setEnvironment(previous => ({...previous, [agreement.environment]: value}))}/>)}
    {options.steam_installation && <p className="muted">Steam account, password, Guard and private branch password controls use Steam maintenance after preparation. They are not saved in ordinary game settings. {options.steam_installation.coverage === 'pending' ? 'Private support for this recipe is pending review.' : ''}</p>}
    {fs25 && <p className="muted">{options.saved_license ? 'The administrator supplies the game licence and assigned DLC keys automatically.' : 'Ask an administrator to configure a GIANTS server licence before using automatic download.'}</p>}
    <p className="muted">Game options use the template defaults. Edit them in Settings after creation.</p>
    {!!setupVariables.length && <><h2>Installation requirements</h2><div className="steam-form-grid">{setupVariables.map(renderVariable)}</div></>}
    <details className="steam-advanced"><summary>Runtime image</summary><div className="steam-form-grid"><Field label="Runtime image"><Select id="game-runtime-image" value={image} onChange={event => setImage(event.target.value)}>{options.images.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</Select></Field></div></details>
    {!options.nodes.length && <p className="game-stop-note">No compatible online node is available. Connect a node, then reload this setup.</p>}
    <ErrorBox>{error}</ErrorBox>
    {!busy&&setupProblems.length>0&&<section id="game-template-readiness" className="template-readiness" aria-label="Setup requirements"><p role="status">{setupProblems.length===1?'Complete this requirement to create your server.':`Complete these ${setupProblems.length} requirements to create your server.`}</p><ul>{setupProblems.map((problem,index)=><li key={`${problem.field}:${index}`}>{problem.field?<a href={`#${problem.field}`} onClick={event=>{event.preventDefault();focusProblem(problem.field!);}}>{problem.message}</a>:problem.message}</li>)}</ul></section>}
    <Button type="submit" disabled={!valid || busy} aria-busy={busy} aria-describedby={!valid?'game-template-readiness':undefined}>{busy ? 'Creating server...' : 'Create server'}</Button>
  </fieldset></form>{fs25 && <details className="steam-advanced"><summary>Installation and DLC help</summary><ol>{options.setup_steps?.map((step,index)=><li key={index}>{step}</li>)}</ol><p className="muted">{options.detail}</p><a href={options.source} target="_blank" rel="noreferrer">Reviewed upstream recipe</a></details>}</Card>{!fs25 && <aside><h2>Runtime verification</h2><TemplateVerification template={options}/><h2>Recipe requirements</h2><p className="template-description">{options.description}</p><p className="muted">Resource defaults are starting values, not a verified recommendation for this game. Adjust them to the publisher's requirements. {privateContent ? 'Preparation runs first. Steam maintenance opens next for account authorization and content installation. Download completion does not establish native startup readiness.' : 'Installation runs first; start the server from Console when it finishes.'}</p>{!!options.setup_steps?.length && <><h2>After installation</h2><ol>{options.setup_steps.map((step, index) => <li key={index}>{step}</li>)}</ol></>}<a href={options.source} target="_blank" rel="noreferrer">Read the upstream recipe</a></aside>}</div>;
}

function TemplateVariable({variable, environment, value, automatic, privateCarrier, onChange}: {privateCarrier?: boolean; variable: Variable; environment: Record<string, string>; value: string; automatic?: {active: boolean; port?: number}; onChange: (value: string) => void}) {
  const control = templateVariableControl(variable, environment);
  const id=`game-template-${variable.env_variable}`;
  const problem=!automatic&&value!==''?templateVariableProblem(variable,environment):'';
  let hint = automatic ? `${variable.description} ${automatic.active ? `Leave blank to select a port automatically.${automatic.port === undefined ? '' : ` Selected: ${automatic.port}.`}` : 'This port is inactive for the current game settings; its value is retained.'}` : variable.description;
  if(!control.numeric&&control.minimum!==undefined)hint+=` Use ${control.maximum!==undefined?`${control.minimum} to ${control.maximum}`:`at least ${control.minimum}`} characters.`;
  return <Field label={variable.name} hint={hint}>
    {control.boolean ? <GameSwitch id={id} aria-label={variable.name} checked={value === '1' || value === 'true'} disabled={automatic && !automatic.active} onCheckedChange={checked => onChange(control.choices!.includes('true') ? String(checked) : checked ? '1' : '0')}/>
      : control.choices ? <Select id={id} aria-label={variable.name} value={value} required={control.required} aria-invalid={!!problem||undefined} onChange={event => onChange(event.target.value)}>{control.choices.map(choice => <option key={choice} value={choice}>{choice}</option>)}</Select>
      : <Input id={id} aria-label={variable.name} value={value} required={control.required && !automatic} disabled={automatic && !automatic.active} placeholder={automatic?.active ? 'Automatic' : undefined} type={control.secret || privateCarrier ? 'password' : control.numeric ? 'number' : 'text'} pattern={control.numeric ? undefined : control.pattern} title={control.pattern ? "Enter a different value. This template does not accept this value." : undefined} aria-invalid={!!problem||undefined} aria-describedby={problem?`${id}-problem`:undefined} min={control.numeric ? control.minimum : undefined} max={control.numeric ? control.maximum : undefined} minLength={!control.numeric?control.minimum:undefined} maxLength={!control.numeric?control.maximum:undefined} step={control.numeric ? control.step : undefined} autoComplete={control.secret ? 'new-password' : 'off'} onChange={event => onChange(event.target.value)}/>}
    {problem&&<small id={`${id}-problem`} className="template-field-problem">{problem}</small>}
  </Field>;
}



