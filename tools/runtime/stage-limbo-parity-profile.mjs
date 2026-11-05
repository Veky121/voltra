import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const recipe = 'minecraft/java/limbo/egg-limbo.json';
export function stageLimbo(current, wrapper) {
  const profile = structuredClone(current[recipe]);
  if (!profile?.egg) throw Error('Missing reviewed standalone Limbo');
  const install = profile.egg.scripts.installation;
  const invocation = 'python3 .voltra/limbo-install.py limbo';
  const wrappedInvocation = 'python3 .voltra/limbo-parity-install.py';
  const header = "cat > .voltra/limbo-parity-install.py <<'VOLTRA_LIMBO_PARITY'\n";
  const block = /cat > \.voltra\/limbo-parity-install\.py <<'VOLTRA_LIMBO_PARITY'\r?\n[\s\S]*?\r?\nVOLTRA_LIMBO_PARITY\r?\npython3 \.voltra\/limbo-parity-install\.py/g;
  const wrapped = [...install.script.matchAll(block)];
  const replacement = header + wrapper.replaceAll('\r\n', '\n') + '\nVOLTRA_LIMBO_PARITY\n' + wrappedInvocation;
  const alreadyWrapped = wrapped.length === 1;
  if (alreadyWrapped) {
    if (install.script.split(wrappedInvocation).length !== 2 || !install.script.trimEnd().endsWith(wrappedInvocation) || install.script.includes(invocation)) throw Error('Expected one terminal wrapped Limbo installer');
    install.script = install.script.replace(block, () => replacement);
  } else {
    if (wrapped.length || install.script.includes(wrappedInvocation) || install.script.split(invocation).length !== 2 || !install.script.trimEnd().endsWith(invocation)) throw Error('Expected exact standalone installer invocation');
    install.script = install.script.replace(invocation, () => replacement);
  }
  // Existing integrated profiles already have these guards. Refreshing a
  // helper must not add another guard or executable invocation on every stage.
  install.script = install.script.split('\n').flatMap((line, index, lines) => {
    const target = line === 'mkdir -p .voltra' ? '.voltra' : /^cat > (\.voltra\/[A-Za-z0-9_.-]+) /.exec(line)?.[1];
    return target && lines[index - 1]?.trim() !== 'test ! -L ' + target ? ['test ! -L ' + target, line] : [line];
  }).join('\n');
  // Native file is authoritative after installation. No startup rewrite.
  profile.egg.config.files = '{}';
  profile.egg.startup = 'java -Xms128M -jar "{{SERVER_JARFILE}}" --nogui';
  if (!alreadyWrapped) profile.revision = 'limbo-managed-java-seed-once-v2';
  if (!alreadyWrapped) profile.setup_steps = [
    'Standalone LOOHP Limbo build 76, 2026.0.3-ALPHA-26.3, remains pinned with SHA-256 verification. Java 21 or newer is required; use the existing Java controls.',
    'Allocate one TCP gameplay port. First installation seeds server-ip and server-port; later starts and reinstalls preserve server.properties. Update its port deliberately if the allocation changes.',
    'Configure server.properties through shared Game settings and Files. Keep forwarding-secrets private. Proxy forwarding modes are mutually exclusive; restrict backend access before enabling them.',
    'Keep schematic files, whitelist.json, permissions and plugins. Limbo loads a schematic rather than a normal persistent Minecraft world. Missing default spawn.schem is extracted by Limbo itself.',
    'Native console uses version and stop. Native startup, settings, preservation and player protocol acceptance remain pending root verification.'
  ];
  return {[recipe]: profile};
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = 'artifacts/game-parity-20261029/limbo-profile.json';
  fs.mkdirSync(path.dirname(output), {recursive:true});
  fs.writeFileSync(output, JSON.stringify(stageLimbo(JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json')), fs.readFileSync('internal/panel/game_library/scripts/limbo-parity-install.py', 'utf8')), null, 2) + '\n');
  console.log(output);
}
