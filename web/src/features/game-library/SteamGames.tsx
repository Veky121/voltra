import {TerminalSpinner} from '../../ui/TerminalProgress';
import {Feedback} from '../../notifications';
import {Disclosure, DisclosureTrigger} from '../../ui/Disclosure';
import {miBToGB} from '../../resourceUnits.ts';
import {startupVariableSection} from '../server-settings/startupSettingsModel';
import {GameSwitch} from '../shared/GameSwitch';
import './games-ui.css';
import {useRef, useState, type FormEvent, type ReactNode} from 'react';
import {useNavigate, useParams} from 'react-router-dom';
import {api, Button, ErrorBox, Field, Input, Select, unwrap} from '../../lib';
import {GameLibraryCard, gameArtwork} from './GameLibraryCard';
import {json} from '../shared/common';
import {
  memoryMiB,
  gameInitialNode,
  gameMemoryBudget,
  steamMemoryWarning,
  recommendedGB,
  steamAdvancedEnvironment,
  type SteamAdvancedField,
  type GameHelp,
  type GameProfile,
  type SteamGame,
  type SteamOptions,
} from './gameSetupModel';
import {useGameRequest} from './useGameRequest';
import {GameNameField, GameResourceField, GameNodeField} from './GameSetupFields';
import {
  GameSetupArtwork,
  GameSetupIdentity,
  GameSetupPage,
  GameSetupSection,
  GameSetupReadiness,
  GameSetupSizing,
  GameSetupSummary,
  type GameSetupProblem,
} from './GameSetupLayout';
import './steamGames.css';
import {GamePorts, useGamePortPlan} from './GamePorts';
import type {InstalledServer, Resource} from '../../types/api';

export function GameHelpLinks({help}: {help: GameHelp[]}) {
  return (
    <div className="game-help">
      {help.map((item, index) => (
        <div key={`${item.label}-${index}`}>
          <strong>
            {item.url && /^https?:\/\//.test(item.url) ? (
              <a href={item.url} target="_blank" rel="noreferrer">
                {item.label} ↗
              </a>
            ) : (
              item.label
            )}
          </strong>
          {item.text && <p>{item.text}</p>}
        </div>
      ))}
    </div>
  );
}

export function SteamGameTiles() {
  const request = useGameRequest<{games: GameProfile[]}>('/api/client/game-library/steam');
  return (
    <>
      <ErrorBox>{request.error}</ErrorBox>
      {request.error && (
        <Button variant="secondary" onClick={request.reload}>
          Retry games
        </Button>
      )}
      {request.loading && !request.data && (
        <p role="status">
          <TerminalSpinner /> Loading games...
        </p>
      )}
      {request.data?.games.map(game => (
        <GameLibraryCard
          key={game.id}
          name={game.name}
          subtitle="Dedicated server · Steam updates"
          artwork={gameArtwork('steam', game.id)}
          to={`/game-library/${game.id}`}
          guided
        />
      ))}
    </>
  );
}

export default function SteamGames() {
  const {game} = useParams();
  const request = useGameRequest<SteamOptions>(
    game && /^[a-z0-9-]+$/.test(game) ? `/api/client/game-library/steam/${encodeURIComponent(game)}` : null
  );
  return (
    <GameSetupPage name={request.data?.name}>
      {!game ? (
        <ErrorBox>This game does not have Steam easy setup.</ErrorBox>
      ) : (
        <>
          <ErrorBox>{request.error}</ErrorBox>
          {request.error && (
            <Button variant="secondary" onClick={request.reload}>
              Retry game options
            </Button>
          )}
          {request.loading && !request.data && (
            <p role="status">
              <TerminalSpinner /> Loading setup options...
            </p>
          )}
          {request.data && <SteamSetupForm key={game} game={game} options={request.data} />}
        </>
      )}
    </GameSetupPage>
  );
}

export function SteamSetupForm({game, options, about}: {game: SteamGame; options: SteamOptions; about?: ReactNode}) {
  const navigate = useNavigate();
  const initialNode = gameInitialNode(options.nodes, {memory: options.defaults.memory});
  const [name, setName] = useState(`${options.name} server`);
  const [gameName, setGameName] = useState(`${options.name} server`);
  const [node, setNode] = useState(String(initialNode?.id ?? ''));
  const [memory, setMemory] = useState(String(miBToGB(options.defaults.memory)));
  const players = String(options.defaults.max_players);
  const [password, setPassword] = useState('');
  const preset = options.presets[0]?.value ?? '';
  const [startAfterInstall, setStartAfterInstall] = useState(true);
  const advancedFields = options.advanced_fields ?? [];
  const requiredFields = advancedFields.filter(field => {
    try {
      steamAdvancedEnvironment([field], {
        [field.key]: field.type === 'boolean' ? field.default === '1' : field.default,
      });
      return false;
    } catch {
      return true;
    }
  });
  const installationOptions = advancedFields.filter(
    field => !requiredFields.includes(field) && startupVariableSection({env_variable: field.key}) === 'runtime'
  );
  const [advanced, setAdvanced] = useState<Record<string, string | boolean>>(() =>
    Object.fromEntries(
      advancedFields.map(field => [field.key, field.type === 'boolean' ? field.default === '1' : field.default])
    )
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const submitting = useRef(false);
  const submission = useRef<{payload: string; id: string} | null>(null);
  const memoryValue = memoryMiB(memory);
  const selectedNode = options.nodes.find(item => String(item.id) === node);
  const portEnvironment = Object.fromEntries(
    advancedFields
      .filter(field => !field.secret && /PORT/i.test(field.key))
      .map(field => [field.key, advanced[field.key] ?? field.default])
  );
  const ports = useGamePortPlan(
    `/api/client/game-library/steam/${encodeURIComponent(game)}/ports`,
    node,
    portEnvironment
  );
  const memoryMaximum = gameMemoryBudget(options.maximum_memory, selectedNode);
  const memoryWarning = steamMemoryWarning(options, memoryValue);
  const passwordRules = options.password ?? {
    enabled: game === 'palworld',
    required: false,
    min_length: 0,
    max_length: 128,
  };
  const passwordValid =
    !passwordRules.enabled ||
    (!passwordRules.required && !password) ||
    ([...password].length >= passwordRules.min_length && [...password].length <= passwordRules.max_length);
  const valid =
    passwordValid &&
    !!gameName.trim() &&
    gameName.length <= 100 &&
    !!name.trim() &&
    options.nodes.some(item => String(item.id) === node && item.setup_available !== false) &&
    memoryValue !== null &&
    memoryValue >= options.minimum_memory &&
    memoryValue <= memoryMaximum &&
    Number.isInteger(Number(players)) &&
    Number(players) >= options.minimum_players &&
    Number(players) <= options.maximum_players &&
    (!options.presets.length || options.presets.some(item => item.value === preset));
  // What keeps Install disabled, each linked to the control that fixes it.
  const problems: GameSetupProblem[] = [];
  if (!name.trim()) problems.push({field: 'game-server-name', message: 'Enter a panel name.'});
  if (options.supports_game_name && (!gameName.trim() || gameName.length > 100))
    problems.push({field: 'steam-game-name', message: 'Enter an in-game server name of up to 100 characters.'});
  if (!passwordValid)
    problems.push({
      field: 'steam-server-password',
      message: `Enter a server password of ${passwordRules.min_length} to ${passwordRules.max_length} characters.`,
    });
  // One capacity message for the hint, the island and the checklist. A host
  // below the game's minimum can only be fixed by choosing another host, and
  // that message, with both amounts, replaces the host's generic reason.
  const hostTooSmall = memoryMaximum < options.minimum_memory;
  if (
    !hostTooSmall &&
    options.nodes.length &&
    !options.nodes.some(item => String(item.id) === node && item.setup_available !== false)
  )
    problems.push({
      field: 'game-server-node',
      message: selectedNode?.unavailable_reason || 'Choose a host machine that is ready for setup.',
    });
  const capacityMessage = hostTooSmall
    ? `This host has ${miBToGB(memoryMaximum)} GB free; ${options.name} needs at least ${miBToGB(options.minimum_memory)} GB. Choose another host.`
    : `Memory exceeds the host's available ${miBToGB(memoryMaximum)} GB. Lower it or choose another host.`;
  if (hostTooSmall) problems.push({field: 'game-server-node', message: capacityMessage});
  else if (memoryValue === null || memoryValue < options.minimum_memory)
    problems.push({
      field: 'game-server-memory',
      message: `Enter at least ${miBToGB(options.minimum_memory)} GB of memory.`,
    });
  else if (memoryValue > memoryMaximum) problems.push({field: 'game-server-memory', message: capacityMessage});
  if (ports.error) problems.push({message: 'Ports could not be planned. Use Retry in Host machine.'});
  function focusProblem(id: string) {
    const field = document.getElementById(id);
    field?.scrollIntoView({block: 'center', behavior: 'auto'});
    field?.focus({preventScroll: true});
  }
  async function install(event: FormEvent) {
    event.preventDefault();
    if (!valid || !ports.data || ports.loading || ports.error || !options.can_install || submitting.current) return;
    let environment: Record<string, string | boolean>;
    try {
      environment = steamAdvancedEnvironment(advancedFields, advanced);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
      return;
    }
    const body = {
      name: name.trim(),
      ...(options.supports_game_name ? {game_name: gameName.trim()} : {}),
      node_id: Number(node),
      memory: memoryValue,
      max_players: Number(players),
      ...(password ? {server_password: password} : {}),
      ...(preset ? {preset} : {}),
      ...(advancedFields.length ? {environment} : {}),
      ...(options.supports_install_only === true ? {start_on_completion: startAfterInstall} : {}),
    };
    const payload = JSON.stringify(body);
    if (submission.current?.payload !== payload) submission.current = {payload, id: crypto.randomUUID()};
    submitting.current = true;
    setBusy(true);
    setError('');
    try {
      const result = unwrap(
        await api<Resource<InstalledServer>>(
          `/api/client/game-library/steam/${game}/install`,
          json('POST', {...body, request_id: submission.current.id})
        )
      );
      if (!result?.identifier)
        throw new Error('The install response did not include a server. Check Overview before retrying.');
      navigate(`/server/${encodeURIComponent(result.identifier)}/steam`);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  const requiresPassword = passwordRules.enabled && passwordRules.required;
  const hasGameSection = options.supports_game_name || requiresPassword || requiredFields.length > 0;
  const resourceSection = hasGameSection ? 2 : 1;
  const storage = options.defaults.disk ? String(miBToGB(options.defaults.disk)) : '';
  const icon = <GameSetupArtwork artwork={gameArtwork('steam', game)} name={options.name} />;
  const version = advancedFields.find(field => field.type === 'select' && /VERSION|BRANCH|VARIANT/.test(field.key));
  const updateAdvanced = (key: string, value: string | boolean) =>
    setAdvanced(previous => ({...previous, [key]: value}));
  return (
    <form className="game-setup-layout" onSubmit={install}>
      <fieldset className="game-setup-fields" disabled={busy}>
        <GameSetupIdentity icon={icon}>
          <GameNameField value={name} onChange={setName} />
        </GameSetupIdentity>
        {hasGameSection && (
          <GameSetupSection number={1} title="Game">
            <div className="game-setup-grid">
              {options.supports_game_name && (
                <Field label="In-game server name">
                  <Input
                    id="steam-game-name"
                    required
                    maxLength={100}
                    autoComplete="off"
                    value={gameName}
                    onChange={event => setGameName(event.target.value)}
                  />
                </Field>
              )}
              {requiresPassword && (
                <Field
                  label="Server password"
                  hint={`Required, ${passwordRules.min_length} to ${passwordRules.max_length} characters.`}
                >
                  <Input
                    id="steam-server-password"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={passwordRules.min_length}
                    maxLength={passwordRules.max_length}
                    value={password}
                    onChange={event => setPassword(event.target.value)}
                  />
                </Field>
              )}
              <SteamAdvancedControls fields={requiredFields} values={advanced} onChange={updateAdvanced} />
            </div>
          </GameSetupSection>
        )}
        <GameSetupSection number={resourceSection} title="Memory and storage">
          <div className="game-setup-grid">
            <GameResourceField
              resource="memory"
              value={memory}
              onChange={setMemory}
              minimum={options.minimum_memory}
              maximum={Math.max(options.minimum_memory, memoryMaximum)}
              hint={[
                recommendedGB(options.recommendation, 'memory'),
                hostTooSmall
                  ? capacityMessage
                  : `Allowed ${miBToGB(options.minimum_memory)} to ${miBToGB(memoryMaximum)} GB on this host`,
              ]
                .filter(Boolean)
                .join(' · ')}
              describedBy={memoryWarning ? 'steam-memory-warning' : undefined}
            />
            {storage && (
              <GameResourceField resource="storage" value={storage} hint={`Set by the ${options.name} setup.`} />
            )}
          </div>
          {memoryWarning && <Feedback tone="warning" id="steam-memory-warning" message={memoryWarning} />}
          {(options.runtime_image || installationOptions.length > 0 || options.supports_install_only) && (
            <Disclosure className="game-setup-advanced">
              <DisclosureTrigger>Advanced</DisclosureTrigger>
              {options.runtime_image && (
                <Field label="Runtime image">
                  <Select value={options.runtime_image} disabled>
                    <option value={options.runtime_image}>{options.runtime_image}</option>
                  </Select>
                </Field>
              )}
              {installationOptions.length > 0 && (
                <div className="game-setup-grid" role="group" aria-label="Installation options">
                  <SteamAdvancedControls fields={installationOptions} values={advanced} onChange={updateAdvanced} />
                </div>
              )}
              {options.supports_install_only && (
                <label className="game-boolean">
                  <GameSwitch disabled={busy} checked={startAfterInstall} onCheckedChange={setStartAfterInstall} />
                  <span>Start server after installation</span>
                </label>
              )}
            </Disclosure>
          )}
        </GameSetupSection>
        <GameSetupSection number={resourceSection + 1} title="Host machine">
          <div className="game-setup-grid">
            <GameNodeField value={node} onChange={setNode} nodes={options.nodes} />
          </div>
          <p className="muted">Game ports are assigned automatically.</p>
          {selectedNode?.unavailable_reason && <Feedback tone="error" message={selectedNode.unavailable_reason} />}
          {(hostTooSmall || (memoryValue !== null && memoryValue > memoryMaximum)) && (
            <Feedback tone="warning" message={capacityMessage} />
          )}
          <GamePorts plan={ports.data} loading={ports.loading} error={ports.error} retry={ports.reload} />
        </GameSetupSection>
      </fieldset>
      <GameSetupSummary
        icon={icon}
        name={options.name}
        subtitle="Dedicated server · Steam"
        rows={[
          ...(version && advanced[version.key] ? [{label: version.label, value: String(advanced[version.key])}] : []),
          {label: 'Memory', value: memory ? `${memory} GB` : '—'},
          ...(storage ? [{label: 'Storage', value: `${storage} GB`}] : []),
          {label: 'Players', value: players},
          {label: 'Host', value: selectedNode?.name ?? 'Choose a host'},
        ]}
        readiness={
          <>
            {!busy && <GameSetupReadiness id="steam-setup-readiness" problems={problems} onFocus={focusProblem} />}
            {!options.can_install && <p className="muted">You do not have permission to create this server.</p>}
            {!options.nodes.length && (
              <p className="muted">Ask an administrator to connect a compatible Linux x64 Steam node.</p>
            )}
          </>
        }
        error={error}
        install={`Install ${options.name}`}
        busy={busy}
        describedBy={problems.length && !busy ? 'steam-setup-readiness' : undefined}
        disabled={!valid || !ports.data || ports.loading || !!ports.error || !options.can_install}
        note={
          <>
            Follow installation progress in the console.{' '}
            {options.supports_install_only && !startAfterInstall
              ? 'The server stays stopped after installation.'
              : 'The server starts after installation.'}
          </>
        }
        about={
          <>
            <h2>After setup</h2>
            <p>{options.after_setup}</p>
            <GameHelpLinks help={options.help ?? []} />
            <GameSetupSizing recommendation={options.recommendation} />
            {about}
          </>
        }
      />
    </form>
  );
}

export function SteamAdvancedControls({
  fields,
  values,
  onChange,
}: {
  fields: SteamAdvancedField[];
  values: Record<string, string | boolean>;
  onChange: (key: string, value: string | boolean) => void;
}) {
  return (
    <>
      {fields.map(field =>
        field.type === 'boolean' ? (
          <label className="game-boolean" key={field.key}>
            <GameSwitch
              checked={values[field.key] === true}
              onCheckedChange={checked => onChange(field.key, checked)}
            />
            <span>{field.label}</span>
          </label>
        ) : (
          <Field key={field.key} label={field.label} hint={field.description}>
            {field.type === 'select' ? (
              <Select
                value={String(values[field.key] ?? field.default)}
                onChange={event => onChange(field.key, event.target.value)}
              >
                {field.options?.map(option => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </Select>
            ) : (
              <Input
                type={
                  field.secret ? 'password' : field.type === 'number' || field.type === 'integer' ? 'number' : 'text'
                }
                autoComplete={field.secret ? 'new-password' : 'off'}
                value={String(values[field.key] ?? '')}
                min={field.min}
                max={field.max}
                step={field.type === 'integer' ? 1 : 'any'}
                maxLength={field.max_length}
                required={field.required || field.type === 'integer' || field.type === 'number'}
                onChange={event => onChange(field.key, event.target.value)}
              />
            )}
          </Field>
        )
      )}
    </>
  );
}
