// Static route inventory, deliberately not a settings/parity acceptance test.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const panel=path.join(root,'internal/panel');
const sources=fs.readdirSync(panel).filter(n=>n.endsWith('.go')&&!n.endsWith('_test.go')).map(n=>({name:n,source:fs.readFileSync(path.join(panel,n),'utf8')}));
const constants=new Map();
for(const {source} of sources)for(const m of source.matchAll(/\b([A-Za-z_]\w*)\s*=\s*"([^"\r\n]+\.json)"/g))constants.set(m[1],m[2]);
const authority=sources.find(s=>s.name==='game_settings_campaign_authority.go').source;
const body=authority.match(/func campaignParserRecipe\(egg M\) string \{\s*for _, r := range \[\]string\{([^}]+)\}/)?.[1];
assert.ok(body,'Exact campaign registry not found');
const recipes=body.split(',').map(x=>x.trim()).filter(Boolean).map(token=>{
  if(token.startsWith('"'))return JSON.parse(token);
  assert.ok(constants.has(token),'Unresolved recipe constant '+token);
  return constants.get(token);
});
assert.equal(new Set(recipes).size,recipes.length);
const catalog=JSON.parse(fs.readFileSync(path.join(panel,'game_library/overrides.json')));
for(const r of recipes)assert.ok(catalog[r],'Registry is outside canonical overrides '+r);
const report={scope:'Static explicit campaign authority registry only. Other game families use separate settings paths; absence here does not mean unsupported.',explicit_campaign_authority_routes:recipes.length,canonical_profiles:Object.keys(catalog).length,registered_recipes:recipes,other_canonical_recipes:Object.keys(catalog).filter(r=>!recipes.includes(r)),unproven:['Registration alone does not establish parser field coverage, editability, discovery, API permission correctness or current native consumption.','Read-only versus writable must be assessed using the actual selected document and field metadata.','Native lifecycle, browser and gameplay gates remain separate.'],source_sha256:crypto.createHash('sha256').update(authority).digest('hex')};
const out=path.join(root,'artifacts/game-parity-20261029/wave72-settings-route-inventory');fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({explicit_routes:recipes.length,canonical_profiles:Object.keys(catalog).length,scope:report.scope}));
