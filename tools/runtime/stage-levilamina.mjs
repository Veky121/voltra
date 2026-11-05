import fs from 'node:fs';
import crypto from 'node:crypto';
const recipe='minecraft/bedrock/LeviLamina/egg-levi-lamina.json';
const output='artifacts/game-parity-20261029/levilamina-installer-followup';
const canonical=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'))[recipe];
const profile=structuredClone(canonical);
const source=fs.readFileSync('internal/panel/game_library/scripts/levilamina-payload.py','utf8').replace(/\r\n/g, '\n');
// JSON strings are valid Python string literals except JSON boolean/null, absent here.
const script=`import os\nfrom pathlib import Path\nsource = ${JSON.stringify(source)}\nnamespace = {'__name__': 'levilamina_payload'}\nexec(compile(source, 'levilamina_payload.py', 'exec'), namespace)\nhelper = Path('.voltra/levilamina_payload.py')\nif helper.exists() and helper.read_text(encoding='utf-8') != source:\n    raise ValueError('Existing helper differs; explicit source migration required')\nresult = namespace['install'](Path.cwd(), Path(os.environ['LEVI_PAYLOAD_DIR']), Path(os.environ['LEVI_PAYLOAD_SHA256_FILE']))\nhelper.parent.mkdir(exist_ok=True)\nhelper.write_text(source, encoding='utf-8')\nprint(result)\n`;
profile.egg.scripts.installation={container:'python:3.12-slim',entrypoint:'python3',script};
profile.egg.startup='exec python3 .voltra/levilamina_payload.py run';
profile.revision=canonical.revision.replace(/-operator-payload-proposed$/, '')+'-operator-payload-proposed';
fs.mkdirSync(output,{recursive:true});
fs.writeFileSync(output+'/profile.pending.json',JSON.stringify({[recipe]:profile},null,2)+'\n');
fs.writeFileSync(output+'/installer.py',script);
fs.writeFileSync(output+'/integration.json',JSON.stringify({recipe,applied:false,canonical_profile_sha256:crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex'),runtime_prerequisites:['Python >=3.9 on runtime PATH','Operator-provisioned x64 Wine and Microsoft VC++ x64 runtime','Complete lip-prepared workspace, external to destination, with complete relative-path SHA256 JSON inventory','Explicit BEDROCK_TERMS_ACCEPTED=true at install and start','LEVI_PAYLOAD_DIR and LEVI_PAYLOAD_SHA256_FILE supplied by operator, not fabricated panel variables'],eligibility_proposal:{kind:'separate_unapplied',architecture:'linux/amd64',writable_settings:false,reason:'Require proven launcher, active server.properties and override ownership; preserve canonical controls and config mappings until reviewed'},native_gaps:['No Wine compatibility proven','Current done/stop/config mappings retained pending observed native signals','No automatic update across managed file conflicts','Inventory proves bytes only, not complete compatible dependencies','TCP/UDP mapping and actual native readiness still need acceptance']},null,2)+'\n');
console.log(output);
