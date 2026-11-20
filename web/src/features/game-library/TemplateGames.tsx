import {TerminalSpinner} from '../../ui/TerminalProgress';
import {Feedback} from '../../notifications';
import {settingDescription} from '../server-settings/settingDescription';
import {Disclosure, DisclosureTrigger} from '../../ui/Disclosure';
import {cfxSetupProblem, fiveMTemplateID} from './cfxAdmission';
import {type TemplateSetupValidation} from './templateSetupRules';
import {miBToGB} from '../../resourceUnits.ts';
import {startupVariableSection} from '../server-settings/startupSettingsModel';
import {GameSwitch} from '../shared/GameSwitch';
import {useRef, useState, type FormEvent} from 'react';
import {useNavigate, useParams} from 'react-router-dom';
import {api, Button, ErrorBox, Field, Input, Select, unwrap} from '../../lib';
import {json} from '../shared/common';
import {GameResourceField, GameNameField, GameNodeField} from './GameSetupFields';
import {
  GameSetupAgreement,
  GameSetupArtwork,
  GameSetupIdentity,
  GameSetupPage,
  GameSetupSection,
  GameSetupReadiness,
  GameSetupSizing,
  GameSetupSummary,
} from './GameSetupLayout';
import {
  memoryMiB,
  gameInitialNode,
  gameMemoryBudget,
  gameResourceBudget,
  type SetupNode,
  type SteamGame,
  type SteamOptions,
  type GameRecommendation,
  recommendedGB,
} from './gameSetupModel';
import {SteamSetupForm} from './SteamGames';
import {useGameRequest} from './useGameRequest';
import {
  type GameAgreement,
  type GameAcceptance,
  templateDeclinedValue,
  templateMemoryWarning,
  templatePlayerLimit,
  templateStorageWarning,
  templateVariableControl,
  templateVariableProblem,
  type TemplatePortRule,
} from './gameTemplateModel';
import {templateSetupProblems, templateSetupDependencyVariables} from './templateSetupValidation';
import {GamePorts, useGamePortPlan} from './GamePorts';
import {GameLibraryCard, gameArtwork} from './GameLibraryCard';
import {variantVerification} from './gameFamiliesModel';
import {compareGamePopularity} from './gameLibraryOrder';
import {isMinecraftTemplate, minecraftProjectKey} from './minecraftCommunityModel';
import communityArtwork from './minecraftCommunityArtwork.json' with {type: 'json'};
import type {GameArtwork} from './GameLibraryCard';
import {
  clearTemplateSteamSecrets,
  templateSteamDefault,
  templateSteamEnvironment,
  templateSteamRole,
  type TemplateSteamInstallation,
} from './privateSteamTemplateModel';
import type {InstalledServer, Resource} from '../../types/api';

type Template = {
  profile?: string;
  id: string;
  name: string;
  description: string;
  category: string;
  source: string;
  available: boolean;
  detail: string;
  verification: string;
  managed_game?: SteamGame;
  setup_steps?: string[];
  platforms?: string[] | null;
  required_ports?: number;
  consecutive_ports?: boolean;
  consecutive_ports_count?: number;
  consecutive_primary_offset?: number;
  port_rules?: TemplatePortRule[] | null;
};
type Variable = {
  name: string;
  description: string;
  env_variable: string;
  default_value: string;
  rules: string;
  user_viewable: boolean;
};
type Allocation = {id: number; ip: string; port: number};
type TemplateOptions = Template & {
  setup_validation?: TemplateSetupValidation[] | null;
  egg_id?: number;
  saved_license?: boolean;
  steam_installation?: TemplateSteamInstallation;
  agreements?: GameAgreement[];
  acceptances?: GameAcceptance[];
  recommendation?: GameRecommendation;
  private_content_supported?: boolean;
  nodes: (SetupNode & {allocations: Allocation[]; private_content_ready?: boolean})[];
  images: {label: string; value: string}[];
  variables: Variable[];
  defaults: {memory: number; disk: number};
};

function TemplateVerification({template}: {template: Template}) {
  const label =
    template.verification === 'runtime_verified'
      ? 'Native hosting tested'
      : template.verification === 'runtime_partial'
        ? 'Partially tested: known limitations remain'
        : template.verification === 'runtime_failed'
          ? 'Runtime test failed'
          : 'Runtime not yet verified';
  return (
    <div>
      <p className="muted">{label}</p>
      <p>{template.detail || 'Community template. Not yet verified on your node.'}</p>
    </div>
  );
}

export function GameTemplateCatalog({minecraftOnly = false}: {minecraftOnly?: boolean}) {
  const request = useGameRequest<{games: Template[]; can_install: boolean}>('/api/client/game-library/templates');
  const [search, setSearch] = useState('');
  const games = (request.data?.games ?? []).filter(game => isMinecraftTemplate(game) === minecraftOnly);
  const matches = games
    .filter(game => `${game.name} ${game.category} ${game.description}`.toLowerCase().includes(search.toLowerCase()))
    .sort(compareGamePopularity);
  return (
    <section className="game-template-catalog games-ui">
      <div className="game-template-header">
        <div className="game-template-intro">
          <h2>{minecraftOnly ? 'Choose your server software' : 'All game templates'}</h2>
          <p className="muted">
            {minecraftOnly
              ? 'Minecraft server software, community loaders, crossplay tools and proxies. Community projects are independent of Mojang; vanilla Bedrock is also listed here.'
              : 'Games, server mods, and variants. Minecraft variants are grouped under Minecraft above.'}
          </p>
        </div>
        <Field label={minecraftOnly ? 'Find server software' : 'Find a game'}>
          <Input
            type="search"
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder={minecraftOnly ? 'Search Paper, Fabric, proxies…' : 'Search games and variants'}
          />
        </Field>
      </div>
      <ErrorBox>{request.error}</ErrorBox>
      {request.error && (
        <Button onClick={request.reload} variant="secondary">
          Retry catalog
        </Button>
      )}
      {request.loading && !request.data && (
        <p role="status">
          <TerminalSpinner /> Loading game catalog...
        </p>
      )}
      {request.data && (
        <p role="status" className="muted">
          {matches.length} of {games.length} recipes
        </p>
      )}
      <div className="game-template-list">
        {matches.map(game => (
          <GameLibraryCard
            key={game.id}
            name={game.name}
            subtitle={minecraftOnly ? 'Minecraft community' : 'Community recipe'}
            artwork={
              (minecraftOnly
                ? (communityArtwork as Record<string, GameArtwork>)[minecraftProjectKey(game.source) ?? '']
                : undefined) ||
              gameArtwork('templates', game.id) ||
              gameArtwork('categories', game.category)
            }
            to={`/game-library/template/${game.id}`}
            note={variantVerification(game)}
            noteTitle={game.detail}
            source={game.source}
            disabledReason={
              !game.available
                ? 'Compatibility review needed'
                : !request.data?.can_install
                  ? 'Administrator access required'
                  : undefined
            }
          />
        ))}
      </div>
      {minecraftOnly && (
        <Disclosure className="library-artwork-credits">
          <DisclosureTrigger>Project artwork credits</DisclosureTrigger>
          <p>
            Project logos belong to their respective owners and are displayed unchanged. Inclusion does not imply
            endorsement.{' '}
            <a href="https://docs.papermc.io/misc/assets/" target="_blank" rel="noreferrer">
              PaperMC artwork guidelines
            </a>
            .
          </p>
          <ul>
            {Object.entries(communityArtwork)
              .filter(([key]) => key !== 'spongevanilla')
              .map(([key, art]) => (
                <li key={key}>
                  <a href={art.sourcePage} target="_blank" rel="noreferrer">
                    {art.title}
                  </a>
                  <span>{art.credit}</span>
                </li>
              ))}
          </ul>
        </Disclosure>
      )}
    </section>
  );
}

export default function GameTemplateSetup() {
  const {template} = useParams();
  const request = useGameRequest<TemplateOptions>(
    template ? `/api/client/game-library/templates/${encodeURIComponent(template)}` : null
  );
  return (
    <GameSetupPage name={request.data?.name}>
      <ErrorBox>{request.error}</ErrorBox>
      {request.error && (
        <Button onClick={request.reload} variant="secondary">
          Retry setup
        </Button>
      )}
      {request.loading && !request.data && (
        <p role="status">
          <TerminalSpinner /> Loading game requirements...
        </p>
      )}
      {request.data &&
        (request.data.managed_game ? (
          <ManagedTemplateSetup key={template} template={request.data} game={request.data.managed_game} />
        ) : (
          <TemplateSetupForm key={template} options={request.data} />
        ))}
    </GameSetupPage>
  );
}

function ManagedTemplateSetup({template, game}: {template: Template; game: SteamGame}) {
  const request = useGameRequest<SteamOptions>(`/api/client/game-library/steam/${encodeURIComponent(game)}`);
  return (
    <>
      <ErrorBox>{request.error}</ErrorBox>
      {request.error && (
        <Button onClick={request.reload} variant="secondary">
          Retry setup
        </Button>
      )}
      {request.loading && !request.data && (
        <p role="status">
          <TerminalSpinner /> Loading game requirements...
        </p>
      )}
      {request.data && (
        <SteamSetupForm game={game} options={request.data} about={<TemplateSetupAbout template={template} />} />
      )}
    </>
  );
}

function TemplateSetupAbout({template, fs25 = false}: {template: Template; fs25?: boolean}) {
  return (
    <>
      {/* Steps before the first start stay in view beside Install, not folded away. */}
      {!!template.setup_steps?.length && (
        <>
          <h3>Before the first start</h3>
          <ol className="game-setup-steps">
            {template.setup_steps.map((step, index) => (
              <li key={index}>{step}</li>
            ))}
          </ol>
        </>
      )}
      <Disclosure className="game-setup-recipe">
        <DisclosureTrigger>{fs25 ? 'Installation and DLC help' : 'Recipe and compatibility'}</DisclosureTrigger>
        <TemplateVerification template={template} />
        {template.description && <p>{template.description}</p>}
        <a href={template.source} target="_blank" rel="noreferrer">
          {fs25 ? 'Reviewed upstream recipe' : 'View source'}
        </a>
      </Disclosure>
    </>
  );
}

export function TemplateSetupForm({options}: {options: TemplateOptions}) {
  const fs25 = options.profile?.startsWith('fs25-') ?? options.name === 'Farming Simulator 25';
  const navigate = useNavigate();
  const initialNode =
    (fs25
      ? gameInitialNode(
          options.nodes.filter(
            node =>
              (node.available_disk ?? 0) >= options.defaults.disk &&
              (node.available_memory ?? 0) >= options.defaults.memory
          )
        )
      : gameInitialNode(options.nodes, options.defaults)) ?? gameInitialNode(options.nodes);
  const agreementNames = new Set([
    ...(options.agreements ?? []).map(agreement => agreement.environment),
    ...(options.acceptances ?? []).map(acceptance => acceptance.environment),
  ]);
  const [environment, setEnvironment] = useState<Record<string, string>>(() => {
    const defaults = Object.fromEntries(
      options.variables.map(variable => [variable.env_variable, variable.default_value])
    );
    for (const agreement of options.agreements ?? []) defaults[agreement.environment] = '0';
    for (const acceptance of options.acceptances ?? [])
      defaults[acceptance.environment] = templateDeclinedValue(acceptance, options.variables);
    return clearTemplateSteamSecrets(defaults, options.steam_installation);
  });
  const [privateContent, setPrivateContent] = useState(
    templateSteamDefault(options.steam_installation, !!options.private_content_supported)
  );
  const [name, setName] = useState(`${options.name} server`);
  const [node, setNode] = useState(String(initialNode?.id ?? ''));
  const [memory, setMemory] = useState(
    String(
      miBToGB(
        fs25
          ? Math.min(options.defaults.memory, Math.max(128, gameMemoryBudget(1048576, initialNode)))
          : options.defaults.memory
      )
    )
  );
  const [disk, setDisk] = useState(
    String(
      miBToGB(
        fs25
          ? Math.min(options.defaults.disk, Math.max(128, gameResourceBudget(16777216, initialNode?.available_disk)))
          : options.defaults.disk
      )
    )
  );
  const [image, setImage] = useState(options.images[0]?.value ?? '');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const submitting = useRef(false),
    submission = useRef<{payload: string; id: string} | null>(null);
  const setupForm = useRef<HTMLFormElement>(null);
  let safeEnvironment: Record<string, string> = {},
    steamEnvironmentError = '';
  try {
    safeEnvironment = templateSteamEnvironment(environment, privateContent, options.steam_installation);
  } catch (error) {
    steamEnvironmentError =
      error instanceof Error ? error.message : 'Use reviewed Steam maintenance for private inputs.';
  }
  const ports = useGamePortPlan(
    `/api/client/game-library/templates/${encodeURIComponent(options.id)}/ports`,
    node,
    safeEnvironment,
    !steamEnvironmentError
  );
  const memoryValue = memoryMiB(memory),
    diskValue = memoryMiB(disk);
  const memoryWarning = templateMemoryWarning(options.name, memoryValue, options.defaults.memory);
  const storageWarning = templateStorageWarning(options.name, diskValue, options.defaults.disk);
  const selectedNode = options.nodes.find(item => String(item.id) === node);
  const memoryMaximum = gameMemoryBudget(1048576, selectedNode),
    diskMaximum = gameResourceBudget(16777216, selectedNode?.available_disk);
  // Decide from original defaults so correcting a required field never removes it.
  const defaultEnvironment = Object.fromEntries(
    options.variables.map(variable => [variable.env_variable, variable.default_value])
  );
  const prerequisiteSelectors = templateSetupDependencyVariables(options.variables);
  const setupVariables = options.variables.filter(
    variable =>
      startupVariableSection(variable) === 'runtime' ||
      /^(SERVER_NAME|SERVERNAME|GAME_NAME|HOSTNAME|SERVER_HOSTNAME|SRV_NAME|SERVER_DISPLAY_NAME|SERV_NAME)$/i.test(
        variable.env_variable
      ) ||
      /^(?:in-game |public )?server name$/i.test(variable.name.trim()) ||
      (options.id === fiveMTemplateID && ['TXHOST_GAME_NAME', 'MAX_PLAYERS'].includes(variable.env_variable)) ||
      prerequisiteSelectors.has(variable.env_variable) ||
      !!templateVariableProblem(variable, defaultEnvironment) ||
      /(?:^|\|)required_(?:if|unless|with|without)/.test(variable.rules) ||
      (fs25 && ['SERVER_NAME', 'WEB_PASSWORD', 'AUTO_DOWNLOAD'].includes(variable.env_variable))
  );
  const checkedVariables = options.variables.filter(
    variable =>
      !(fs25 && ['WEB_PORT'].includes(variable.env_variable)) &&
      !options.agreements?.some(agreement => agreement.environment === variable.env_variable) &&
      (!templateSteamRole(variable.env_variable) || templateSteamRole(variable.env_variable) === 'branch') &&
      !(privateContent && ['SRCDS_APPID', 'AUTO_UPDATE'].includes(variable.env_variable)) &&
      !options.port_rules?.some(rule => rule.auto_allocate && rule.environment === variable.env_variable)
  );
  const setupProblems = templateSetupProblems({
    name,
    node: selectedNode,
    memory: memoryValue,
    memoryMaximum,
    disk: diskValue,
    diskMaximum,
    imageValid: options.images.some(item => item.value === image),
    portsReady: !!ports.data,
    portsLoading: ports.loading,
    portsError: !!ports.error,
    steamError: !!steamEnvironmentError,
    privateContent,
    privateSupported: options.private_content_supported === true,
    fs25,
    savedLicence: !!options.saved_license,
    variables: checkedVariables,
    environment,
    agreements: options.agreements,
    acceptances: options.acceptances,
    setupValidation: options.setup_validation,
  });
  const cfxProblem = cfxSetupProblem(options.id, environment);
  if (cfxProblem) setupProblems.push({field: 'game-template-MAX_PLAYERS', message: cfxProblem});
  const valid = setupProblems.length === 0;
  function focusProblem(id: string) {
    function focus() {
      const field = setupForm.current?.querySelector<HTMLElement>(`[id="${id}"]`);
      field?.scrollIntoView({block: 'center', behavior: 'auto'});
      field?.focus({preventScroll: true});
    }
    if (id === 'game-runtime-image' && !advancedOpen) {
      setAdvancedOpen(true);
      requestAnimationFrame(focus);
    } else {
      focus();
    }
  }
  async function install(event: FormEvent) {
    event.preventDefault();
    if (!valid || submitting.current) return;
    const body = {
      name: name.trim(),
      memory: memoryValue,
      disk: diskValue,
      image,
      node_id: Number(node),
      automatic_ports: true,
      environment: safeEnvironment,
      ...(privateContent ? {private_content: true} : {}),
    };
    const payload = JSON.stringify(body);
    if (submission.current?.payload !== payload) submission.current = {payload, id: crypto.randomUUID()};
    submitting.current = true;
    setBusy(true);
    setError('');
    try {
      const result = unwrap(
        await api<Resource<InstalledServer>>(
          `/api/client/game-library/templates/${options.id}/install`,
          json('POST', {...body, request_id: submission.current.id})
        )
      );
      if (!result.identifier) throw Error('The response did not include a server. Check Overview before retrying.');
      navigate(`/server/${encodeURIComponent(result.identifier)}/${privateContent ? 'steam' : 'console'}`);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  const renderVariable = (variable: Variable) => {
    if (fs25 && variable.env_variable === 'SERVER_NAME') variable = {...variable, name: 'In-game server name'};
    if (fs25 && ['WEB_PORT'].includes(variable.env_variable)) return null;
    if (agreementNames.has(variable.env_variable)) return null;
    const steamRole = templateSteamRole(variable.env_variable);
    if (steamRole && steamRole !== 'branch') return null;
    if (privateContent && ['SRCDS_APPID', 'AUTO_UPDATE'].includes(variable.env_variable)) return null;
    const rule = options.port_rules?.find(rule => rule.environment === variable.env_variable && rule.auto_allocate);
    const automatic = rule
      ? {
          active: !rule.when_environment || environment[rule.when_environment] === rule.when_value,
          port: ports.data?.ports.find(port => port.role === variable.env_variable)?.port,
        }
      : undefined;
    return (
      <TemplateVariable
        key={variable.env_variable}
        variable={variable}
        environment={environment}
        value={environment[variable.env_variable] ?? ''}
        privateCarrier={options.steam_installation?.legacy_branch_field === variable.env_variable}
        automatic={automatic}
        onChange={value => setVariable(variable.env_variable, value)}
      />
    );
  };
  const installationControls = setupVariables.map(renderVariable).filter(Boolean);
  const hasSteamChoice = !!(options.steam_installation || options.private_content_supported);
  const hasGameSection = hasSteamChoice || installationControls.length > 0;
  const resourceSection = hasGameSection ? 2 : 1;
  const hostPlatforms = options.platforms?.map(platform =>
    platform.replace('linux/', 'Linux ').replace('arm64', 'ARM64').replace('amd64', 'x64')
  );
  const variant = setupVariables.find(
    variable =>
      !agreementNames.has(variable.env_variable) &&
      (variable.env_variable === 'TXHOST_GAME_NAME' ||
        /(?:^|_)(VERSION|VARIANT|BRANCH|BETAID)(?:_|$)/.test(variable.env_variable)) &&
      !!environment[variable.env_variable] &&
      !templateVariableControl(variable, environment).secret
  );
  const players = templatePlayerLimit(environment);
  const icon = (
    <GameSetupArtwork
      artwork={gameArtwork('templates', options.id) ?? gameArtwork('categories', options.category)}
      name={options.name}
    />
  );
  function setVariable(key: string, value: string) {
    setEnvironment(previous => ({...previous, [key]: value}));
  }
  return (
    <form className="game-setup-layout" ref={setupForm} onSubmit={install}>
      <fieldset className="game-setup-fields" disabled={busy}>
        <GameSetupIdentity icon={icon}>
          <GameNameField value={name} onChange={setName} />
        </GameSetupIdentity>
        {hasGameSection && (
          <GameSetupSection number={1} title="Game">
            <div className="game-setup-grid">
              {hasSteamChoice && (
                <Field label="Steam installation">
                  <Select
                    id="game-template-steam"
                    value={privateContent ? 'private' : 'public'}
                    onChange={event => {
                      setPrivateContent(event.target.value === 'private');
                      setEnvironment(previous => clearTemplateSteamSecrets(previous, options.steam_installation));
                    }}
                  >
                    <option value="private" disabled={!options.private_content_supported && !privateContent}>
                      Use my Steam account after preparation
                      {options.private_content_supported ? '' : ' (not available for this recipe)'}
                    </option>
                    <option value="public">Anonymous Steam installation</option>
                  </Select>
                </Field>
              )}
              {installationControls}
            </div>
            {hasSteamChoice && !options.private_content_supported && (
              <p className="muted">
                {options.steam_installation?.private_reason ||
                  'Private Steam setup for this recipe needs a reviewed publication policy.'}
              </p>
            )}
            {fs25 && (
              <p className="muted">
                {options.saved_license
                  ? 'The administrator supplies the game licence and assigned DLC keys automatically.'
                  : 'Ask an administrator to configure a GIANTS server licence before using automatic download.'}
              </p>
            )}
          </GameSetupSection>
        )}
        <GameSetupSection number={resourceSection} title="Memory and storage">
          <div className="game-setup-grid">
            <GameResourceField
              resource="memory"
              value={memory}
              onChange={setMemory}
              minimum={128}
              maximum={Math.max(128, memoryMaximum)}
              hint={recommendedGB(options.recommendation, 'memory')}
              describedBy={memoryWarning ? 'game-template-memory-warning' : undefined}
            />
            <GameResourceField
              resource="storage"
              value={disk}
              onChange={setDisk}
              minimum={128}
              maximum={Math.max(128, diskMaximum)}
              hint={recommendedGB(options.recommendation, 'disk')}
              describedBy={storageWarning ? 'game-template-storage-warning' : undefined}
            />
          </div>
          {memoryWarning && <Feedback tone="warning" id="game-template-memory-warning" message={memoryWarning} />}
          {storageWarning && <Feedback tone="warning" id="game-template-storage-warning" message={storageWarning} />}
          <Disclosure className="game-setup-advanced" open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <DisclosureTrigger>Advanced</DisclosureTrigger>
            <Field label="Runtime image">
              <Select id="game-runtime-image" value={image} onChange={event => setImage(event.target.value)}>
                {options.images.map(item => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </Select>
            </Field>
          </Disclosure>
        </GameSetupSection>
        <GameSetupSection number={resourceSection + 1} title="Host machine">
          <div className="game-setup-grid">
            <GameNodeField value={node} onChange={setNode} nodes={options.nodes} />
          </div>
          <p className="muted">
            {hostPlatforms?.length ? `Requires ${hostPlatforms.join(', ')}.` : 'Game ports are assigned automatically.'}
          </p>
          {privateContent && options.private_content_supported && selectedNode?.private_content_ready !== true && (
            <Feedback
              tone="warning"
              message="Private Steam installation is not enabled on this node. Choose a node with a trusted private Steam worker."
            />
          )}
          {selectedNode?.unavailable_reason && <Feedback tone="error" message={selectedNode.unavailable_reason} />}
          {((memoryValue !== null && memoryValue > memoryMaximum) ||
            (diskValue !== null && diskValue > diskMaximum)) && (
            <Feedback
              tone="warning"
              message={`This node has ${miBToGB(memoryMaximum)} GB of memory and ${miBToGB(diskMaximum)} GB of storage available for allocation. Lower the limits or choose another node.`}
            />
          )}
          {steamEnvironmentError && <Feedback tone="error" message={steamEnvironmentError} />}
          <div id="game-template-ports" tabIndex={-1}>
            <GamePorts plan={ports.data} loading={ports.loading} error={ports.error} retry={ports.reload} />
          </div>
          {!options.nodes.length && (
            <Feedback
              tone="warning"
              message="No compatible online node is available. Connect a node, then reload this setup."
            />
          )}
        </GameSetupSection>
      </fieldset>
      <GameSetupSummary
        icon={icon}
        name={options.name}
        subtitle="Community template"
        rows={[
          ...(variant
            ? [
                {
                  label: /VERSION/.test(variant.env_variable) ? 'Version' : 'Variant',
                  value: environment[variant.env_variable],
                },
              ]
            : []),
          {label: 'Memory', value: memory ? `${memory} GB` : '—'},
          {label: 'Storage', value: disk ? `${disk} GB` : '—'},
          ...(players != null ? [{label: 'Players', value: players}] : []),
          {label: 'Host', value: selectedNode?.name ?? 'Choose a host'},
        ]}
        agreements={
          <>
            {options.agreements?.map(agreement => (
              <GameSetupAgreement
                key={agreement.environment}
                id={`game-template-${agreement.environment}`}
                title={agreement.title}
                url={agreement.source_url}
                disabled={busy}
                checked={environment[agreement.environment] === agreement.accept_value}
                onCheckedChange={checked => setVariable(agreement.environment, checked ? agreement.accept_value : '0')}
              >
                <Disclosure className="game-setup-terms">
                  <DisclosureTrigger disabled={busy}>Read publisher terms</DisclosureTrigger>
                  <p className="muted">
                    {agreement.effective_date
                      ? `Effective ${agreement.effective_date}`
                      : `Reviewed ${agreement.reviewed_date}`}
                  </p>
                  <pre tabIndex={0} aria-label={agreement.title}>
                    {agreement.text}
                  </pre>
                </Disclosure>
              </GameSetupAgreement>
            ))}
            {options.acceptances?.map(acceptance => (
              <GameSetupAgreement
                key={acceptance.environment}
                id={`game-template-${acceptance.environment}`}
                title={acceptance.title}
                url={acceptance.url}
                links={acceptance.links}
                disabled={busy}
                checked={environment[acceptance.environment] === acceptance.accept_value}
                onCheckedChange={checked =>
                  setVariable(
                    acceptance.environment,
                    checked ? acceptance.accept_value : templateDeclinedValue(acceptance, options.variables)
                  )
                }
              >
                {acceptance.environment === 'SCPSL_ACCEPT_EULA' && (
                  <p className="muted">You can also accept the EULA in Console after installation.</p>
                )}
                {acceptance.environment === 'ACKNOWLEDGE_LEGACY_PREREQUISITES' && (
                  <p className="muted">
                    You supply matching game assets and configuration. This grants no game licence and fetches no client
                    files.
                  </p>
                )}
                {acceptance.environment === 'HYTALE_ACCEPT_EARLY_PLUGINS' && (
                  <p className="muted">Enable only if you want to load unsupported early plugins.</p>
                )}
              </GameSetupAgreement>
            ))}
          </>
        }
        readiness={
          !busy &&
          !valid && <GameSetupReadiness id="game-template-readiness" problems={setupProblems} onFocus={focusProblem} />
        }
        describedBy={!valid && !busy ? 'game-template-readiness' : undefined}
        error={error}
        install={`Install ${options.name}`}
        busy={busy}
        disabled={!valid}
        note={
          privateContent
            ? 'Follow preparation in the console. Authorize Steam next to install game files.'
            : 'Follow installation progress in the console.'
        }
        about={
          <>
            <h2>After setup</h2>
            <p>
              {privateContent
                ? 'Add Steam credentials after preparation. Public automatic updates are disabled.'
                : options.setup_steps?.length
                  ? 'Complete the steps below, then start the server from Console.'
                  : 'Start the server from Console when installation finishes.'}
            </p>
            {privateContent && options.steam_installation?.coverage === 'pending' && (
              <p className="muted">Private installation is awaiting verification.</p>
            )}
            <GameSetupSizing recommendation={options.recommendation} />
            <TemplateSetupAbout template={options} fs25={fs25} />
          </>
        }
      />
    </form>
  );
}

function TemplateVariable({
  variable,
  environment,
  value,
  automatic,
  privateCarrier,
  onChange,
}: {
  privateCarrier?: boolean;
  variable: Variable;
  environment: Record<string, string>;
  value: string;
  automatic?: {active: boolean; port?: number};
  onChange: (value: string) => void;
}) {
  const control = templateVariableControl(variable, environment);
  const id = `game-template-${variable.env_variable}`;
  const problem = !automatic && value !== '' ? templateVariableProblem(variable, environment) : '';
  let hint = automatic
    ? `${variable.description} ${automatic.active ? `Leave blank to select a port automatically.${automatic.port === undefined ? '' : ` Selected: ${automatic.port}.`}` : 'This port is inactive for the current game settings; its value is retained.'}`
    : settingDescription(variable.description);
  if (!control.numeric && control.minimum !== undefined)
    hint += ` Use ${control.maximum !== undefined ? `${control.minimum} to ${control.maximum}` : `at least ${control.minimum}`} characters.`;
  return (
    <Field label={variable.name} hint={hint}>
      {control.boolean ? (
        <GameSwitch
          id={id}
          aria-label={variable.name}
          checked={value === '1' || value === 'true'}
          disabled={automatic && !automatic.active}
          onCheckedChange={checked =>
            onChange(control.choices!.includes('true') ? String(checked) : checked ? '1' : '0')
          }
        />
      ) : control.choices ? (
        <Select
          id={id}
          aria-label={variable.name}
          value={value}
          required={control.required}
          aria-invalid={!!problem || undefined}
          onChange={event => onChange(event.target.value)}
        >
          {control.choices.map(choice => (
            <option key={choice} value={choice}>
              {choice}
            </option>
          ))}
        </Select>
      ) : (
        <Input
          id={id}
          aria-label={variable.name}
          value={value}
          required={control.required && !automatic}
          disabled={automatic && !automatic.active}
          placeholder={automatic?.active ? 'Automatic' : undefined}
          type={control.secret || privateCarrier ? 'password' : control.numeric ? 'number' : 'text'}
          pattern={control.numeric ? undefined : control.pattern}
          title={control.pattern ? 'Enter a different value. This template does not accept this value.' : undefined}
          aria-invalid={!!problem || undefined}
          aria-describedby={problem ? `${id}-problem` : undefined}
          min={control.numeric ? control.minimum : undefined}
          max={control.numeric ? control.maximum : undefined}
          minLength={!control.numeric ? control.minimum : undefined}
          maxLength={!control.numeric ? control.maximum : undefined}
          step={control.numeric ? control.step : undefined}
          autoComplete={control.secret ? 'new-password' : 'off'}
          onChange={event => onChange(event.target.value)}
        />
      )}
      {problem && <Feedback id={`${id}-problem`} tone="error" message={`${variable.name}: ${problem}`} />}
    </Field>
  );
}
