export type StartupVariable = {
  name?: string;
  description?: string;
  env_variable: string;
  rules?: string;
  field_type?: string;
  default_value?: string | number | boolean | null;
  server_value?: string | number | boolean | null;
  is_editable?: boolean;
  user_editable?: boolean;
  secret?: boolean;
  secret_configured?: boolean;
  configured?: boolean;
  is_overridden?: boolean;
  can_reset?: boolean;
};

export type StartupMeta = {
  startup_command?: string;
  raw_startup_command?: string;
  docker_images?: Record<string, string>;
  java_managed?: boolean;
};

export type VariableWrite = { key: string; value: string } | { key: string; reset: true };
export type VariableIntent = 'save' | 'clear' | 'reset';

// Only known installation/process fields belong in Runtime. Custom template
// fields stay available in Game settings rather than disappearing behind admin.
const runtimeVariables = new Set([
  'SERVER_JARFILE', 'SERVER_JAR', 'JARFILE', 'JAR_FILE', 'JAR_NAME',
  'MINECRAFT_VERSION', 'MC_VERSION', 'VANILLA_VERSION', 'SERVER_VERSION', 'VERSION',
  'LOADER', 'MODLOADER', 'MOD_LOADER', 'FABRIC_VERSION', 'FABRIC_LOADER_VERSION',
  'FORGE_VERSION', 'NEOFORGE_VERSION', 'QUILT_VERSION', 'QUILT_LOADER_VERSION',
  'PAPER_BUILD', 'BUILD_NUMBER', 'JAVA_VERSION', 'JVM_ARGS', 'JAVA_ARGS',
  'STARTUP', 'STARTUP_CMD', 'STARTUP_COMMAND', 'SERVER_ARGS', 'SERVER_FLAGS',
  'STEAM_APP_ID', 'STEAMAPPID', 'SRCDS_APPID', 'APP_ID', 'STEAM_BETA',
  'SRCDS_BETAID', 'STEAM_BRANCH', 'BETA_BRANCH', 'LOADER_VERSION',
  'STEAM_BETAPASSWORD', 'STEAM_USER', 'STEAM_PASS', 'STEAM_USERNAME', 'STEAM_PASSWORD',
  'AUTO_UPDATE', 'AUTO_UPDATE_SERVER', 'UPDATE_ON_START', 'VALIDATE',
  'GAME_SERIAL', 'DLC_PRODUCT_KEY', 'AUTO_DOWNLOAD', 'DOWNLOAD_DLC',
]);

export function startupVariableSection(variable: StartupVariable): 'game' | 'runtime' {
  return runtimeVariables.has(variable.env_variable.toUpperCase()) ? 'runtime' : 'game';
}

export function secretVariable(variable: StartupVariable): boolean {
  // Metadata owns classification. Keep older password/token fields masked too.
  if (typeof variable.secret === 'boolean') return variable.secret;
  return /password|passwd|passphrase|token|secret|api[_ -]?key|private[_ -]?key|credential|GAME_SERIAL|DLC_PRODUCT_KEY/i.test(`${variable.env_variable} ${variable.name || ''}`);
}

export function variableValue(variable: StartupVariable): string {
  if (secretVariable(variable)) return '';
  return String(variable.server_value ?? variable.default_value ?? '');
}

export function variableEditable(variable: StartupVariable, permitted: boolean): boolean {
  return permitted && variable.is_editable !== false && variable.user_editable !== false;
}

export function variableCanReset(variable: StartupVariable): boolean {
  return variable.can_reset ?? variable.is_overridden === true;
}

// Keep regex rules intact. A pipe inside a Laravel regex is not a rule separator.
export function startupRules(rules = ''): string[] {
  const parts: string[] = [];
  let start = 0;
  let delimiter = '';
  let escaped = false;
  for (let index = 0; index < rules.length; index++) {
    const char = rules[index];
    if (delimiter) {
      if (!escaped && char === delimiter) delimiter = '';
      escaped = !escaped && char === '\\';
      continue;
    }
    if (/^(?:not_)?regex:$/.test(rules.slice(start, index))) {
      delimiter = char;
      continue;
    }
    if (char === '|') {
      parts.push(rules.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(rules.slice(start));
  return parts.filter(Boolean);
}

export function variableControl(variable: StartupVariable) {
  const rules = startupRules(variable.rules);
  const has = (name: string) => rules.includes(name);
  const parameter = (name: string) => rules.find(rule => rule.startsWith(`${name}:`))?.slice(name.length + 1);
  const bound = (name: string) => {
    const raw = parameter(name);
    return raw !== undefined && raw.trim() && Number.isFinite(Number(raw)) ? Number(raw) : undefined;
  };
  const integer = has('integer');
  const numeric = integer || has('numeric') || has('decimal');
  const secret = secretVariable(variable);
  const choices = parameter('in');
  // Do not expose a secret's permitted values as visible select options.
  const options = !secret && choices !== undefined ? choices.split(',') : !secret && has('boolean') ? ['1', '0'] : undefined;
  const size = bound('size');
  return {
    type: secret ? 'password' : numeric ? 'number' : has('email') ? 'email' : 'text',
    options,
    boolean: !secret && (has('boolean') || !!options && options.length === 2 && (options.includes('0') && options.includes('1') || options.includes('true') && options.includes('false'))),
    required: has('required'),
    integer,
    numeric,
    min: numeric ? size ?? bound('min') : undefined,
    max: numeric ? size ?? bound('max') : undefined,
    minLength: numeric ? undefined : size ?? bound('min'),
    maxLength: numeric ? undefined : size ?? bound('max'),
    step: integer ? 1 : 'any',
  } as const;
}

export function variableProblem(variable: StartupVariable, draft: string): string {
  const control = variableControl(variable);
  if (!draft.trim()) return control.required ? 'A value is required.' : '';
  if (control.options && !control.options.includes(draft)) return 'Choose one of the available options.';
  if (control.numeric) {
    const number = Number(draft);
    if (!Number.isFinite(number) || (control.integer && !Number.isInteger(number))) return control.integer ? 'Enter a whole number.' : 'Enter a number.';
    if (control.min !== undefined && number < control.min) return `Enter at least ${control.min}.`;
    if (control.max !== undefined && number > control.max) return `Enter no more than ${control.max}.`;
  } else {
    const length = Array.from(draft).length;
    if (control.minLength !== undefined && length < control.minLength) return `Use at least ${control.minLength} characters.`;
    if (control.maxLength !== undefined && length > control.maxLength) return `Use no more than ${control.maxLength} characters.`;
  }
  // The API remains authoritative for regex and other Laravel rules.
  return '';
}

export function variableWrite(variable: StartupVariable, draft: string, intent: VariableIntent, permitted: boolean): VariableWrite | null {
  if (!variableEditable(variable, permitted)) throw new Error('This setting is read-only.');
  if (intent === 'reset') {
    if (!variableCanReset(variable)) throw new Error('No template override to reset.');
    return { key: variable.env_variable, reset: true };
  }
  if (intent === 'clear') {
    if (!secretVariable(variable)) throw new Error('Clear is only available for secret fields.');
    const problem = variableProblem(variable, '');
    if (problem) throw new Error(problem);
    return { key: variable.env_variable, value: '' };
  }
  if (secretVariable(variable)) {
    if (!draft) return null;
    if (/^(?:[•●*]+|\[(?:hidden|redacted|secret)\]|<redacted>)$/i.test(draft)) throw new Error('Enter a new value instead of a masked placeholder.');
  } else if (draft === variableValue(variable)) return null;
  const problem = variableProblem(variable, draft);
  if (problem) throw new Error(problem);
  return { key: variable.env_variable, value: draft };
}

export function commandPreview(meta: StartupMeta, variables: StartupVariable[]): string {
  const secrets = variables.filter(secretVariable);
  // The startup API masks literal credentials before returning either command.
  // Prefer its expanded preview so managed Java flags and allocation values stay accurate.
  let command = meta.startup_command || meta.raw_startup_command || '';
  const known = new Map(variables.map(variable => [variable.env_variable, variable]));
  command = command.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_whole, name: string) => {
    const variable = known.get(name);
    return !variable || secretVariable(variable) ? '[hidden]' : variableValue(variable);
  });
  // Also redact raw values if an older API accidentally supplies them.
  const values = secrets.flatMap(variable => [variable.server_value, variable.default_value])
    .filter(value => value !== null && value !== undefined && String(value) !== '')
    .map(String).sort((left, right) => right.length - left.length);
  for (const value of values) command = command.split(value).join('[hidden]');
  return command || 'No command preview is available.';
}

