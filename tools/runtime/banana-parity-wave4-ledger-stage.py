"""Stage a ledger proposal only; never replace the active generator or receipts."""
from pathlib import Path

root = Path(__file__).resolve().parents[2]
source = (root / 'tools/runtime/game-parity-ledger.mjs').read_text(encoding='utf-8')
source = source.replace('writeFileSync }', 'writeFileSync, realpathSync, statSync }')
start = source.index('function safeEvidence(')
end = source.index('export function generate(', start)
support = (root / 'tools/runtime/banana-parity-wave4-ledger-support.mjs').read_text(encoding='utf-8')
source = source[:start] + support + '\n' + source[end:]
source = source.replace('export function generate(root, receipts = {})', 'export function generate(root, receipts = {}, dependencyReview = {})')
source = source.replace("  const sharedFingerprint = hash(sources.map(path => hash(readFileSync(resolve(root, path)))).join(':'));", '')
source = source.replace('const fingerprint = hash(JSON.stringify({ entry, override, sharedFingerprint }));', 'const profile = { entry, override: override || null, managed: managed[entry.path] || null };\n    const fingerprint = hash(canonical(profile));\n    const bindings = Object.fromEntries(Object.keys(requirements).map(name => [name, scopedBinding(root, entry.path, name, profile, dependencyReview)]));')
source = source.replace('receipts[entry.path]?.[name], fingerprint)', 'receipts[entry.path]?.[name], bindings[name])')
source = source.replace('source_fingerprint: fingerprint, profile:', 'source_fingerprint: fingerprint, gate_bindings: bindings, profile:')
source = source.replace('schema_version: 1, campaign:', 'schema_version: 2, campaign:')
source = source.replace('current source fingerprint, all checks true, reason and existing workspace-relative evidence files.', 'reviewed scoped dependency binding, immutable execution context and evidence hashes, all checks true and reason. Legacy receipts require explicit review; no migration or inferred promotion.')
source = source.replace("if (args.length > 1)", "if (args.length > 2)").replace('[receipt.json]', '[receipt.json] [dependency-review.json]')
source = source.replace('const ledger = generate(root, existsSync(resolve(root, reviewed)) ? json(root, reviewed) : {});', "const dependencies = args[1] || 'artifacts/game-parity-20261029/reviewed-dependencies.json';\n  const ledger = generate(root, existsSync(resolve(root, reviewed)) ? json(root, reviewed) : {}, existsSync(resolve(root, dependencies)) ? json(root, dependencies) : {});")
source = source.replace("if (process.argv[1] &&", "if (import.meta.url.startsWith('file:') && process.argv[1] &&")
target = root / 'artifacts/game-parity-20261029/banana-wave4-ledger.mjs.pending'
target.write_text(source, encoding='utf-8', newline='\n')
print(target.relative_to(root))
