import fs from 'node:fs';import {createHash} from 'node:crypto';
const dir='.local/romestead-native',profile=JSON.parse(fs.readFileSync(dir+'/source-profile-current.json')),script=profile.egg.scripts.installation.script;
const tag=process.argv[2];if(!/^[a-z0-9_-]+$/.test(tag??''))throw Error('Specify exact immutable installed source phase');
const expected={};
for(const match of script.matchAll(/cat > \.voltra\/([^ ]+) <<'([^']+)'\r?\n([\s\S]*?)\r?\n\2/g))expected[match[1]]=Buffer.from(match[3].replaceAll('\r\n','\n')+'\n');
const checks=Object.entries(expected).map(([name,body])=>{const actual=fs.readFileSync(dir+'/installed-source-'+tag+'/'+name);return {name,sha256:createHash('sha256').update(actual).digest('hex'),bytes:actual.length,exact_lf_normalized_source:body.equals(actual)};});
if(checks.length!==10||checks.some(c=>!c.exact_lf_normalized_source))throw Error('Installed source mismatch '+JSON.stringify(checks));
fs.writeFileSync(dir+'/installed-source-verification-'+tag+'.json',JSON.stringify({normalization:'installer LF line endings and final newline',checks},null,2)+'\n',{flag:'wx'});console.log({actual_installed_modules:checks.length,exact_match:true});
