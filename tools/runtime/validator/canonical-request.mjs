// Durable reports redact credentials. Never replay those placeholders as input.
// These setup coordinators use only exact frozen publisher defaults, so rebuild
// them from the verified profile and reject any unexpected saved override.
export function materializeDefaults(variables, request) {
  const entries = variables.map(v => [v.env_variable, String(v.default_value)]);
  const environment = Object.fromEntries(entries);
  if (entries.length !== Object.keys(environment).length || !request.environment
    || JSON.stringify(Object.keys(request.environment).sort()) !== JSON.stringify(Object.keys(environment).sort())) {
    throw Error('Canonical request variable set changed');
  }
  for (const [key, value] of entries) {
    const saved = request.environment[key];
    if (saved !== value && !(/(?:token|password|api_key|secret)$/i.test(key) && saved === '[REDACTED]')) {
      throw Error('Canonical default changed: ' + key);
    }
  }
  return { ...request, environment };
}
