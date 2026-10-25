import fs from 'node:fs';import {createHash} from 'node:crypto';
const dir='.local/onset-native',profile=JSON.parse(fs.readFileSync(dir+'/source-profile-current.json')),script=profile.egg.scripts.installation.script;
const expected={};
for(const match of script.matchAll(/cat > \.voltra\/([^ ]+) <<'([^']+)'\r?\n([\s\S]*?)\r?\n\2/g))expected[match[1]]=Buffer.from(match[3].replaceAll('\r\n','\n')+'\n');
const checks=Object.entries(expected).map(([name,body])=>{const actual=fs.readFileSync(dir+'/installed-source-sql-preservation/'+name);return {name,sha256:createHash('sha256').update(actual).digest('hex'),bytes:actual.length,exact_lf_normalized_source:body.equals(actual)};});
if(checks.length!==9||checks.some(c=>!c.exact_lf_normalized_source))throw Error('Installed source mismatch '+JSON.stringify(checks));
fs.writeFileSync(dir+'/installed-source-verification.json',JSON.stringify({normalization:'installer LF line endings and final newline',checks},null,2)+'\n');console.log({actual_installed_modules:checks.length,exact_match:true});
