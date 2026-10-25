export type SteamOriginalField = {environment: string; label: string; rules: string};
export type SteamOriginalControls = Partial<Record<'username' | 'password' | 'guard' | 'branch' | 'beta_password', SteamOriginalField[]>>;
export type TemplateSteamInstallation = {default_mode: 'public' | 'private'; private_candidate: boolean; private_supported: boolean; private_reason: string; controls: SteamOriginalControls; coverage: 'reviewed' | 'pending'; legacy_branch_field?: 'EXTRA_FLAGS'};

export function templateSteamRole(name: string) {
  switch (name.toUpperCase()) {
    case 'STEAM_USER': case 'STEAM_USERNAME': return 'username';
    case 'STEAM_PASS': case 'STEAM_PASSWORD': return 'password';
    case 'STEAM_AUTH': case 'STEAM_GUARDCODE': return 'guard';
    case 'SRCDS_BETAID': return 'branch';
    case 'SRCDS_BETAPASS': return 'beta_password';
    default: return '';
  }
}
export function templateSteamDefault(descriptor: TemplateSteamInstallation | undefined, legacySupported: boolean) {
  return descriptor?.default_mode === 'private' || !descriptor && legacySupported;
}
export function clearTemplateSteamSecrets(environment: Record<string, string>, descriptor?: TemplateSteamInstallation) {
  return Object.fromEntries(Object.entries(environment).map(([key, value]) => {
    const role = templateSteamRole(key);
    if (descriptor?.legacy_branch_field === key) {try {validateLegacyPublicBranch(value);} catch {return [key, ''];}}
    return [key, role && role !== 'branch' ? role === 'username' && value === 'anonymous' ? value : '' : value];
  }));
}
export function templateSteamEnvironment(environment: Record<string, string>, privateContent: boolean, descriptor?: TemplateSteamInstallation) {
  if (environment.INSTALL_FLAGS) throw new Error('Raw Steam installation flags are unsupported. Use typed Steam branch settings or Steam maintenance.');
  if (descriptor?.legacy_branch_field) validateLegacyPublicBranch(environment[descriptor.legacy_branch_field] ?? '');
  for (const [key, value] of Object.entries(environment)) {
    const role = templateSteamRole(key);
    if (role && role !== 'branch' && value !== '' && !(role === 'username' && value === 'anonymous')) {
      throw new Error('Supply Steam credentials through Steam maintenance after preparation, not game settings.');
    }
  }
  const result = {...environment};
  if (privateContent) for (const key of Object.keys(result)) if (templateSteamRole(key) && templateSteamRole(key) !== 'branch') result[key] = '';
  return result;
}
export function privateOriginalMaximum(fields: SteamOriginalField[] | undefined): number | undefined {
  const maximums = (fields ?? []).flatMap(field => field.rules.split('|').filter(rule => /^max:\d+$/.test(rule)).map(rule => Number(rule.slice(4))));
  return maximums.length ? Math.min(...maximums) : undefined;
}
export function validatePrivateOriginal(value: string, fields: SteamOriginalField[] | undefined) {
  const maximum = privateOriginalMaximum(fields);
  if (maximum !== undefined && [...value].length > maximum) throw new Error("The Steam input exceeds this recipe's original maximum length.");
  // Full original Laravel-compatible rules remain authoritative on the server.
}
export function privateOriginalLabel(fields: SteamOriginalField[] | undefined, fallback: string) {
  return fields?.length ? `${fields[0].label} (${fields.map(field => field.environment).join(', ')})` : fallback;
}

function validateLegacyPublicBranch(value: string) {
  const tokens: string[] = []; let token = '', quote = '', active = false;
  const chars = [...value];
  for (let index = 0; index < chars.length; index++) {
    const c = chars[index];
    if (c === '\\' && quote !== "'") {
      if (++index === chars.length) throw new Error('Invalid typed Steam branch flags.');
      const next = chars[index]; if (quote === '"' && next !== '"' && next !== '\\') token += '\\';
      token += next; active = true; continue;
    }
    if (quote) {if (c === quote) quote = ''; else token += c; active = true; continue;}
    if (c === "'" || c === '"') {quote = c; active = true; continue;}
    if (' \t\r\n'.includes(c)) {if (active) {tokens.push(token); token = ''; active = false;} continue;}
    token += c; active = true;
  }
  if (quote) throw new Error('Invalid typed Steam branch flags.');
  if (active) tokens.push(token);
  if (!tokens.length || tokens.length === 2 && tokens[0] === '-beta') return;
  throw new Error('Private branch passwords and unsupported Steam flags must use reviewed Steam maintenance, not ordinary game settings.');
}
