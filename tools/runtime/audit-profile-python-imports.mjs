// Check local Python dependencies inside embedded installer heredocs.
// This covers ordinary imports, not dynamic importlib paths or external packages.
import fs from 'node:fs';
import path from 'node:path';
const known=new Set(fs.readdirSync('internal/panel/game_library/scripts').filter(name=>name.endsWith('.py')).map(name=>name.slice(0,-3).replaceAll('-','_')));
const profiles=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'));
const findings=[],conditional=[];let checked=0,modules=0;
for(const [recipe,profile]of Object.entries(profiles)){
 const script=profile.egg.scripts.installation.script;
 const embedded=[];
 const pattern=/cat\s+>\s*([^\s]+\.py)\s+<<'([^']+)'\r?\n([\s\S]*?)\r?\n\2(?:\r?\n|$)/g;
 for(const match of script.matchAll(pattern))embedded.push({name:path.posix.basename(match[1]).slice(0,-3),source:match[3]});
 if(!embedded.length)continue;
 checked++;modules+=embedded.length;
 const available=new Set(embedded.map(module=>module.name));
 for(const module of embedded){
  const imports=/^([ \t]*)(?:from\s+([A-Za-z_]\w*)\s+import|import\s+([A-Za-z_]\w*))/gm;
  for(const match of module.source.matchAll(imports)){
   const dependency=match[2]||match[3];
   if(known.has(dependency)&&!available.has(dependency))(match[1]?conditional:findings).push({recipe,module:module.name,missing_local_dependency:dependency});
  }
 }
}
const report={scope:'Unconditional local Python imports in embedded installer heredocs. Indented imports are listed separately for recipe-level review.',profiles_checked:checked,embedded_modules:modules,findings,conditional_dependencies_to_review:conditional};
fs.writeFileSync('artifacts/game-profile-python-import-audit.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
if(findings.length)process.exitCode=1;
