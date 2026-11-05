// Proposal support. Injected into the pending full generator by the owned stager.
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
const nativeEnvironment = 'windows-docker-desktop-linux-local-npipe';
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function safeEvidence(root, path) {
  if (typeof path !== 'string' || !path || isAbsolute(path) || /^[A-Za-z]:|\\|:\/\//.test(path) || path.split('/').some(p => p === '..' || p === '.' || !p)) return false;
  try {
    const target = realpathSync(resolve(root, path)), base = realpathSync(root);
    const rel = relative(base, target);
    return rel !== '..' && !rel.startsWith('../') && !rel.startsWith('..\\') && !isAbsolute(rel) && statSync(target).isFile();
  } catch { return false; }
}
function fileIdentity(root, path) {
  if (!safeEvidence(root, path)) throw new Error(`Missing/unsafe dependency or evidence: ${path}`);
  return { path, sha256: hash(readFileSync(resolve(root, path))) };
}
// Root reviews the complete dependency closure, including shared dispatch/global edges.
// Filename heuristics are unsafe. Absent reviews remain inventory-only, never verified.
export function scopedBinding(root, recipe, gate, profile, review) {
  const contract = review?.recipes?.[recipe]?.gates?.[gate];
  if (!contract) return null;
  if (review.schema_version !== 2 || contract.coverage !== 'reviewed_complete' || !contract.review_id || !contract.reviewed_by || !digest(contract.environment_identity) || !Array.isArray(contract.paths) || !contract.paths.length) throw new Error(`Invalid dependency review: ${recipe}/${gate}`);
  if (new Set(contract.paths).size !== contract.paths.length) throw new Error('Duplicate dependency paths');
  const dependencies = [...contract.paths].sort().map(path => fileIdentity(root, path));
  const material = { schema_version: 2, recipe, gate, profile, review_id: contract.review_id, reviewed_by: contract.reviewed_by, environment_identity: contract.environment_identity, dependencies };
  return { schema_version: 2, recipe, gate, fingerprint: hash(canonical(material)), environment_identity: contract.environment_identity, review_id: contract.review_id, dependencies };
}

export function reconcileGate(root, name, baseline, receipt, binding) {
  if (!receipt) return baseline;
  if (!Object.hasOwn(requirements, name) || !['unknown', 'partial', 'blocked', 'verified'].includes(receipt.status)) throw new Error(`Invalid ${name} status`);
  const evidence = receipt.evidence || [];
  if (!Array.isArray(evidence) || evidence.some(e => !safeEvidence(root, e))) throw new Error(`Missing/unsafe ${name} evidence`);
  if (receipt.status !== 'unknown' && (!evidence.length || !receipt.reason)) throw new Error(`${name} needs evidence and reason`);
  if (receipt.status === 'verified') {
    if (receipt.schema_version !== 2 || !binding || receipt.fingerprint !== binding.fingerprint) throw new Error(`Stale or unreviewed ${name} fingerprint`);
    if (receipt.kind !== 'native_server' || receipt.environment !== nativeEnvironment) throw new Error(`${name} requires local native receipt`);
    if (requirements[name].some(check => receipt.checks?.[check] !== true)) throw new Error(`Incomplete ${name} checks`);
    if (!digest(receipt.execution?.binary_sha256) || receipt.execution?.environment_identity !== binding.environment_identity) throw new Error('Invalid execution identity');
    const contextIdentity = fileIdentity(root, receipt.execution.context?.path);
    if (contextIdentity.sha256 !== receipt.execution.context?.sha256) throw new Error('Changed execution context');
    const context = json(root, contextIdentity.path);
    // Compare structured assertions, never strings in a report or a filename.
    for (const [key, expected] of Object.entries({ schema_version: 2, recipe: binding.recipe, gate: name, fingerprint: binding.fingerprint, kind: 'native_server', environment: nativeEnvironment, binary_sha256: receipt.execution.binary_sha256, environment_identity: binding.environment_identity, checks: receipt.checks })) {
      if (canonical(context[key]) !== canonical(expected)) throw new Error(`Execution context mismatch: ${key}`);
    }
    const identities = evidence.map(path => fileIdentity(root, path));
    if (canonical(receipt.evidence_identity) !== canonical(identities)) throw new Error('Changed evidence identity');
  }
  return { ...receipt, evidence: [...new Set([...baseline.evidence, ...evidence])] };
}
