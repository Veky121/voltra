import fs from 'node:fs';import crypto from 'node:crypto';
const dir='.local/holdfast-native',tag=process.argv[2]??'first',p=JSON.parse(fs.readFileSync(dir+'/source-profile-current.json')),manifest=JSON.parse(fs.readFileSync(dir+'/installed-source-'+tag+'/manifest.json'));let checks=[];
for(const m of p.egg.scripts.installation.script.matchAll(/cat > \.voltra\/([^ ]+) <<'([^']+)'\r?\n([\s\S]*?)\r?\n\2/g)){
 const name=m[1],actual=fs.readFileSync(dir+'/installed-source-'+tag+'/'+name,'utf8'),source='internal/panel/game_library/scripts/'+name.replaceAll('_','-');
 const normalize=x=>x.replaceAll('\r\n','\n').trimEnd();checks.push({name,actual_sha256:manifest[name]?.sha256,embedded_equal:normalize(actual)===normalize(m[3]),canonical_equal:fs.existsSync(source)&&normalize(actual)===normalize(fs.readFileSync(source,'utf8'))});
}
fs.writeFileSync(dir+'/source-exact-'+tag+'.json',JSON.stringify(checks,null,2)+'\n',{flag:'wx'});console.log(checks);if(!checks.length||checks.some(x=>!x.embedded_equal||!x.canonical_equal))process.exitCode=1;
