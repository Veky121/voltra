import fs from 'node:fs';
import crypto from 'node:crypto';
const original='tools/runtime/banana-parity-wave10-etlegacy-authority.py';
const source=fs.readFileSync(original,'utf8');
const prefix=String.raw`PREFIX = re.compile(r'^\s*(?:(?:(?:seta|sets|setu|set)(?=[ \t"])|"(?:seta|sets|setu|set)")[ \t]*)?"?([A-Za-z_][A-Za-z0-9_]*)', re.I)`;
const patched=source.replace(/^PREFIX =.*$/m,prefix);
if(patched===source)throw Error('Identity prefix hardening was not staged');
const output='tools/runtime/banana-parity-wave10-etlegacy-authority-v2.py';fs.writeFileSync(output,patched);
console.log(JSON.stringify({output,sha256:crypto.createHash('sha256').update(patched).digest('hex'),canonical_changed:false}));
