import {miBToGB} from "../resourceUnits.ts";
export type TemplateVariableDefinition = {env_variable: string; rules: string; default_value: string};
export type GameAgreement = {environment: string; title: string; text: string; effective_date: string; reviewed_date?: string; accept_value: string};

export function templateAgreementsAccepted(agreements: GameAgreement[] | undefined, environment: Record<string, string>) {
  return (agreements ?? []).every(agreement => /^[a-f0-9]{64}$/.test(agreement.accept_value) && environment[agreement.environment] === agreement.accept_value);
}

function templateResourceWarning(name: string, selectedMiB: number | null, defaultMiB: number, resource: 'memory' | 'storage'): string | null {
  if (selectedMiB === null || !Number.isSafeInteger(selectedMiB) || selectedMiB < 128 || !Number.isSafeInteger(defaultMiB) || defaultMiB <= 0 || selectedMiB >= defaultMiB) return null;
  const risk = resource === 'memory' ? 'the server may fail to start or be stopped when it runs out of memory' : 'installation or updates may run out of space';
  return `${name} defaults to ${miBToGB(defaultMiB)} GB of ${resource}. The selected ${miBToGB(selectedMiB)} GB is lower; ${risk}.`;
}

export function templateStorageWarning(name: string, selectedMiB: number | null, defaultMiB: number) { return templateResourceWarning(name, selectedMiB, defaultMiB, 'storage'); }
export function templateMemoryWarning(name: string, selectedMiB: number | null, defaultMiB: number) { return templateResourceWarning(name, selectedMiB, defaultMiB, 'memory'); }

export type TemplateAllocation = {id: number; ip: string; port: number};
export type TemplatePortRange = {minimum: number; maximum: number; count: number; offsets?: number[]; allocated_offsets?: number[]; allocatedPort?: number; exclude_primary?: boolean; exclude_offsets?: number[]; exclude_ports?: number[]; invalidEnvironment?: boolean; environment?: string; value?: string; condition?: string; allocated_value?: boolean; auto_allocate?: boolean; when_environment?: string; when_value?: string; automatic?: boolean};
export type TemplatePortRule = TemplatePortRange;
function templatePortRangeValid(rule: TemplatePortRule) {
  const offsets = rule.offsets ?? [];
  const excluded = rule.exclude_offsets ?? [];
  const excludedPorts = rule.exclude_ports ?? [];
  if (!Array.isArray(excludedPorts) || excludedPorts.length > 0 && !rule.allocated_value || new Set(excludedPorts).size !== excludedPorts.length || excludedPorts.some(port => !Number.isInteger(port) || port < 1 || port > 65535)) return false;
  const companions = rule.allocated_offsets ?? [];
  if (!Array.isArray(companions) || companions.length > 0 && (!rule.allocated_value || companions.length + 2 > rule.count) || new Set(companions).size !== companions.length || companions.some(offset => !Number.isInteger(offset) || offset === 0 || offset < -65534 || offset > 65534)) return false;
  if (!Array.isArray(excluded) || excluded.length > 0 && !rule.allocated_value || new Set(excluded).size !== excluded.length || excluded.some(offset => !Number.isInteger(offset) || offset === 0 || offset < -65534 || offset > 65534)) return false;
  const environment = rule.environment ?? '', value = rule.value ?? '';
  const condition = rule.condition ?? '';
  const whenEnvironment = rule.when_environment ?? '', whenValue = rule.when_value ?? '';
  if (typeof whenEnvironment !== 'string' || typeof whenValue !== 'string' || !!whenEnvironment !== !!whenValue || whenEnvironment && (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(whenEnvironment) || /[\x00\r\n]/.test(whenValue))) return false;
  if (rule.auto_allocate !== undefined && typeof rule.auto_allocate !== 'boolean' || rule.auto_allocate && (!rule.allocated_value || condition !== 'nonzero')) return false;
  const gateValid = condition === 'nonzero' ? !!environment && !value : !condition && !!environment === !!value;
  return !rule.invalidEnvironment && Number.isInteger(rule.minimum) && Number.isInteger(rule.maximum) && rule.minimum >= 1 && rule.maximum <= 65535 && rule.maximum >= rule.minimum && Number.isInteger(rule.count) && rule.count >= 1 && rule.count <= rule.maximum - rule.minimum + 1 && Array.isArray(offsets) && offsets.length + 1 <= rule.count && new Set(offsets).size === offsets.length && offsets.every(offset => Number.isInteger(offset) && offset !== 0 && offset >= -65534 && offset <= 65534) && typeof environment === 'string' && typeof value === 'string' && gateValid && (!rule.allocated_value || condition === 'nonzero' && rule.count >= 2) && (!rule.exclude_primary || !!rule.allocated_value);
}
export function templatePortRanges(rules: TemplatePortRule[], environment: Record<string, string>) {
  // Malformed inactive metadata must still fail validation, matching the API.
  const automaticNames = rules.filter(rule => rule.auto_allocate).map(rule => rule.environment);
  if (new Set(automaticNames).size !== automaticNames.length) return rules.map(rule => ({...rule, invalidEnvironment: true}));
  return rules.flatMap(rule => {
    if (!templatePortRangeValid(rule)) return [rule];
    if (rule.when_environment && environment[rule.when_environment] !== rule.when_value) return [];
    if (rule.condition === 'nonzero') {
      const raw = environment[rule.environment!] ?? '';
      if (raw === '' && rule.auto_allocate) return [{...rule, automatic: true}];
      if (!/^(0|[1-9]\d*)$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) > 65535) return [{...rule, invalidEnvironment: true}];
      if (raw === '0') return [];
      return [{...rule, ...(rule.allocated_value ? {allocatedPort: Number(raw)} : {})}];
    }
    return !rule.environment || environment[rule.environment] === rule.value ? [rule] : [];
  });
}

function servicePortGroup(rule: TemplatePortRange, base: number) {return [base, ...(rule.allocated_offsets ?? []).map(offset => base + offset)];}
function resolveTemplatePortRanges(allocations: TemplateAllocation[], primary: number, selected: number[], ranges: TemplatePortRange[], fixedPorts: number[] = []) {
  if (!ranges.some(rule => rule.auto_allocate || rule.allocated_offsets?.length || rule.exclude_ports?.length)) return {ranges, error: ''};
  const game = allocations.find(item => item.id === primary);
  if (!game || ranges.some(rule => !templatePortRangeValid(rule))) return {ranges, error: 'Invalid game port or service port metadata.'};
  if (ranges.some(rule => (Array.isArray(rule.exclude_ports) ? rule.exclude_ports : []).includes(game.port) || selected.some(id => (Array.isArray(rule.exclude_ports) ? rule.exclude_ports : []).includes(allocations.find(item => item.id === id)?.port ?? 0)))) return {ranges, error: 'A selected port is reserved by this recipe for a native role.'};
  const additional = selected.map(id => allocations.find(item => item.id === id));
  if (additional.some(item => !item || item.id === primary || item.ip !== game.ip || item.port < 1 || item.port > 65535 || !Number.isInteger(item.port)) || new Set(additional.map(item => item!.port)).size !== additional.length) return {ranges, error: 'Service ports need distinct selected allocations on the game address.'};
  const available = additional.map(item => item!).sort((a, b) => a.port - b.port);
  const reserved = new Set([game.port, ...fixedPorts, ...ranges.flatMap(rule => (rule.offsets ?? []).map(offset => game.port + offset))]);
  const eligible = (rule: TemplatePortRange, base: number) => servicePortGroup(rule, base).every(port => available.some(item => item.port === port) && !reserved.has(port) && port >= rule.minimum && port <= rule.maximum && !(Array.isArray(rule.exclude_ports) ? rule.exclude_ports : []).includes(port) && !(rule.exclude_offsets ?? []).some(offset => game.port + offset === port));
  const names = new Set<string>();
  for (const rule of ranges.filter(rule => rule.allocated_value)) {
    if (!rule.environment || names.has(rule.environment)) return {ranges, error: 'Service port roles must be distinct.'};
    names.add(rule.environment);
    if (rule.automatic) continue;
    const port = rule.allocatedPort;
    if (port === undefined || !eligible(rule, port)) return {ranges, error: 'Service ports and their companions must use distinct selected additional allocations, separate from fixed game ports.'};
    servicePortGroup(rule, port).forEach(port => reserved.add(port));
  }
  const resolved: TemplatePortRange[] = [];
  for (const rule of ranges) {
    if (!rule.automatic) {resolved.push(rule); continue;}
    const chosen = available.find(item => eligible(rule, item.port));
    if (!chosen) return {ranges, error: `Allocate another distinct port on the game address for ${rule.environment}.`};
    servicePortGroup(rule, chosen.port).forEach(port => reserved.add(port)); resolved.push({...rule, allocatedPort: chosen.port});
  }
  return {ranges: resolved, error: ''};
}

export function templatePortEnvironment(rules: TemplatePortRule[], environment: Record<string, string>, allocations: TemplateAllocation[], primary: number, selected: number[], consecutive = false, consecutiveCount = 0, primaryOffset = 0, required = 1) {
  const ranges = templatePortRanges(rules, environment), game = allocations.find(item => item.id === primary);
  if (ranges.some(rule => !templatePortRangeValid(rule))) return {environment: {...environment}, ports: {} as Record<string, number>, error: 'Invalid service port settings or metadata.'};
  const fixed = consecutive && game ? Array.from({length: consecutiveCount || required}, (_, offset) => game.port - primaryOffset + offset) : [];
  const resolved = resolveTemplatePortRanges(allocations, primary, selected, ranges, fixed), normalized = {...environment}, ports: Record<string, number> = {};
  if (!resolved.error) for (const rule of resolved.ranges) {
    if (rule.auto_allocate && rule.environment && rule.allocatedPort !== undefined) {
      ports[rule.environment] = rule.allocatedPort;
      if (rule.automatic) normalized[rule.environment] = String(rule.allocatedPort);
    }
  }
  return {environment: normalized, ports, error: resolved.error};
}

export function templateAdditionalPorts(allocations: TemplateAllocation[], primary: number, required = 1, selected: number[] = [], consecutive = false, ranges: TemplatePortRange[] = [], consecutiveCount = 0, primaryOffset = 0) {
  const game = allocations.find(item => item.id === primary);
  if (!game) return [];
  const address = game?.ip;
  const valid = allocations.filter(item => !ranges.some(range => (Array.isArray(range.exclude_ports) ? range.exclude_ports : []).includes(item.port)) && item.id !== primary && ((required <= 1 && !ranges.length) || item.ip === address));
  const result = valid.filter(item => selected.includes(item.id)).map(item => item.id);
  if (ranges.some(range => !templatePortRangeValid(range))) return result;
  // Reserve fixed relationships before generic extras, so an ASE/query port
  // also counts toward the range requirement rather than adding a fourth port.
  for (const range of ranges) {
    if (range.allocatedPort !== undefined) {
      for (const port of servicePortGroup(range, range.allocatedPort)) {
        const item = valid.find(item => item.port === port);
        if (item && !result.includes(item.id)) result.push(item.id);
      }
    }
  }
  if (ranges.some(range => range.auto_allocate)) {
    const reserved = new Set([game.port, ...ranges.flatMap(range => (range.offsets ?? []).map(offset => game.port + offset)), ...ranges.flatMap(range => range.allocatedPort === undefined ? [] : servicePortGroup(range, range.allocatedPort))]);
    if (consecutive) for (let offset = 0; offset < (consecutiveCount || required); offset++) reserved.add(game.port - primaryOffset + offset);
    for (const range of ranges.filter(range => range.automatic)) {
      const eligible = valid.filter(item => servicePortGroup(range,item.port).every(port => valid.some(candidate => candidate.port === port) && !reserved.has(port) && port >= range.minimum && port <= range.maximum && !(Array.isArray(range.exclude_ports) ? range.exclude_ports : []).includes(port) && !(range.exclude_offsets ?? []).some(offset => port === game.port + offset)));
      const item = [...eligible.filter(item => result.includes(item.id)), ...eligible.filter(item => !result.includes(item.id))].sort((a,b) => Number(result.includes(b.id)) - Number(result.includes(a.id)) || a.port - b.port)[0];
      if (item) for (const port of servicePortGroup(range,item.port)) {reserved.add(port); const companion=valid.find(candidate=>candidate.port===port)!; if (!result.includes(companion.id)) result.push(companion.id);}
    }
  }
  for (const range of ranges) {
    for (const offset of range.offsets ?? []) {
      const port = game.port + offset;
      const item = valid.find(item => item.port === port && port >= range.minimum && port <= range.maximum);
      if (item && !result.includes(item.id)) result.push(item.id);
    }
  }
  for (const range of ranges) {
    for (const item of valid.filter(item => item.port >= range.minimum && item.port <= range.maximum)) {
      if (valid.filter(port => result.includes(port.id) && port.port >= range.minimum && port.port <= range.maximum).length >= range.count - 1) break;
      if (!result.includes(item.id)) result.push(item.id);
    }
  }
  if (consecutive) {
    const count = consecutiveCount || required;
    if (!Number.isInteger(count) || count < 1 || count > required || !Number.isInteger(primaryOffset) || primaryOffset < 0 || primaryOffset >= count) return result;
    for (let offset = 0; offset < count; offset++) {
      const item = valid.find(item => item.port === (game?.port ?? 0) - primaryOffset + offset);
      if (item && !result.includes(item.id)) result.push(item.id);
    }
  }
  for (const item of valid) {
    if (result.length >= required - 1) break;
    if (!result.includes(item.id)) result.push(item.id);
  }
  return result;
}

export function templatePortsValid(allocations: TemplateAllocation[], primary: number, selected: number[], required = 1, consecutive = false, ranges: TemplatePortRange[] = [], consecutiveCount = 0, primaryOffset = 0) {
  const game = allocations.find(item => item.id === primary);
  if (!game || !Number.isInteger(game.port) || game.port < 1 || game.port > 65535 || selected.length < required - 1 || new Set(selected).size !== selected.length) return false;
  const extra = selected.map(id => allocations.find(item => item.id === id));
  if (extra.some(item => !item || item.id === primary || !Number.isInteger(item.port) || item.port < 1 || item.port > 65535 || ((required > 1 || !!ranges.length) && item.ip !== game.ip))) return false;
  if (new Set([`${game.ip}:${game.port}`, ...extra.map(item => `${item!.ip}:${item!.port}`)]).size !== extra.length + 1) return false;
  if (ranges.some(range => [game, ...extra].some(item => item && (Array.isArray(range.exclude_ports) ? range.exclude_ports : []).includes(item.port)))) return false;
  const fixed = consecutive ? Array.from({length: consecutiveCount || required}, (_, offset) => game.port - primaryOffset + offset) : [];
  const resolved = resolveTemplatePortRanges(allocations, primary, selected, ranges, fixed);
  if (resolved.error) return false;
  ranges = resolved.ranges;
  if (ranges.some(range => !templatePortRangeValid(range) || game.port < range.minimum || game.port > range.maximum || extra.filter(item => item && item.port >= range.minimum && item.port <= range.maximum).length < range.count - 1 || range.allocatedPort !== undefined && (range.exclude_primary && range.allocatedPort === game.port || range.allocatedPort < range.minimum || range.allocatedPort > range.maximum || range.allocatedPort !== game.port && !extra.some(item => item?.port === range.allocatedPort)) || (range.offsets ?? []).some(offset => game.port + offset < range.minimum || game.port + offset > range.maximum || !extra.some(item => item?.port === game.port + offset)))) return false;
  if (ranges.some(range => range.allocatedPort !== undefined && servicePortGroup(range, range.allocatedPort).some(port => (Array.isArray(range.exclude_ports) ? range.exclude_ports : []).includes(port)))) return false;
  if (ranges.some(range => range.allocatedPort !== undefined && (range.exclude_offsets ?? []).some(offset => range.allocatedPort === game.port + offset))) return false;
  if (!consecutive) return consecutiveCount === 0 && primaryOffset === 0;
  const count = consecutiveCount || required;
  if (!Number.isInteger(count) || count < 1 || count > required || !Number.isInteger(primaryOffset) || primaryOffset < 0 || primaryOffset >= count) return false;
  return Array.from({length: count}, (_, offset) => game.port - primaryOffset + offset).every(port => port >= 1 && port <= 65535 && (game.port === port || extra.some(item => item?.port === port)));
}

export function templatePrimaryPort(allocations: TemplateAllocation[], required = 1, consecutive = false, ranges: TemplatePortRange[] = [], consecutiveCount = 0, primaryOffset = 0) {
  return allocations.find(item => templatePortsValid(allocations, item.id, templateAdditionalPorts(allocations, item.id, required, [], consecutive, ranges, consecutiveCount, primaryOffset), required, consecutive, ranges, consecutiveCount, primaryOffset)) ?? allocations[0];
}

// Interpret only the rules whose browser behavior matches backend validation.
// The existing egg validator remains authoritative for cross-field rules.
export function templateVariableControl(variable: TemplateVariableDefinition, environment: Record<string, string> = {}) {
  const rules = variable.rules.split('|');
  // Quoted/escaped Laravel CSV parameters stay with backend validation.
  const excludedValues = rules.flatMap(rule => rule.startsWith('not_in:') && !/["'\\]/.test(rule.slice(7)) ? rule.slice(7).split(',') : []);
  const pattern = excludedValues.length ? `(?!(?:${excludedValues.map(value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})$).*` : undefined;
  const choices = rules.find(rule => rule.startsWith('in:'))?.slice(3).split(',');
  const credentialName = /pass(?:word|wd)?|token|secret|license|api_?key|auth_?key|(?:^|_)gslt(?:_|$)/i.test(variable.env_variable) || /^(TIMED_URL|GAME_SERIAL|DLC_PRODUCT_KEY)$/i.test(variable.env_variable);
  const authenticationValue = /(?:^|_)auth(?:_|$)/i.test(variable.env_variable) && !choices && !rules.some(rule => rule === 'url' || rule.startsWith('url:'));
  const secret = (credentialName || authenticationValue) && !/(?:^|_)PORT$/i.test(variable.env_variable);
  const numeric = !secret && rules.some(rule => ['integer', 'numeric'].includes(rule)) && !rules.includes('string');
  const minRule = rules.find(rule => /^min:-?\d+(\.\d+)?$/.test(rule));
  const maxRule = rules.find(rule => /^max:-?\d+(\.\d+)?$/.test(rule));
  const between = rules.find(rule => /^between:-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(rule))?.slice(8).split(',').map(Number);
  const lowerBounds = [...(minRule ? [Number(minRule.slice(4))] : []), ...(between ? [between[0]] : [])];
  const upperBounds = [...(maxRule ? [Number(maxRule.slice(4))] : []), ...(between ? [between[1]] : [])];
  const minimum = lowerBounds.length ? Math.max(...lowerBounds) : undefined;
  const maximum = upperBounds.length ? Math.min(...upperBounds) : undefined;
  const booleanChoices = rules.includes('boolean') ? (/^(?:true|false)$/.test(variable.default_value) ? ['false', 'true'] : ['0', '1']) : undefined;
  const conditionalRequired = rules.some(rule => {
    const match = /^required_if:environment\.([A-Za-z0-9_]+),([A-Za-z0-9_.-]+(?:,[A-Za-z0-9_.-]+)*)$/.exec(rule);
    return !!match && match[2].split(',').includes(environment[match[1]]);
  });
  const toggleChoices = choices ?? booleanChoices;
  const boolean = !secret && !!toggleChoices && toggleChoices.length === 2 && (toggleChoices.includes('0') && toggleChoices.includes('1') || toggleChoices.includes('true') && toggleChoices.includes('false'));
  return {boolean, required: rules.includes('required') || conditionalRequired, secret, numeric, choices: choices ?? booleanChoices, minimum, maximum, step: rules.includes('integer') ? 1 : 'any' as const, excludedValues, pattern};
}

// Match the supported browser rules without putting entered values in errors.
// The API remains authoritative for regex, cross-field, and installer checks.
export function templateVariableProblem(variable:TemplateVariableDefinition, environment:Record<string,string>):string {
  const control=templateVariableControl(variable,environment), value=environment[variable.env_variable]??'';
  if(!value.trim())return control.required?'Enter a value.':'';
  if(control.choices&&!control.choices.includes(value))return 'Choose a supported value.';
  if(control.excludedValues.includes(value))return 'Enter a different value; this value is not allowed.';
  if(control.numeric){
    const number=Number(value);
    if(!Number.isFinite(number))return 'Enter a number.';
    if(control.step===1&&!Number.isInteger(number))return 'Enter a whole number.';
    if(control.minimum!==undefined&&number<control.minimum)return `Enter at least ${control.minimum}.`;
    if(control.maximum!==undefined&&number>control.maximum)return `Enter no more than ${control.maximum}.`;
  }else{
    const length=Array.from(value).length;
    if(control.minimum!==undefined&&length<control.minimum)return `Use at least ${control.minimum} characters.`;
    if(control.maximum!==undefined&&length>control.maximum)return `Use no more than ${control.maximum} characters.`;
  }
  return '';
}

