import fs from'node:fs';import assert from'node:assert/strict';import{createHash}from'node:crypto';import{execFileSync}from'node:child_process';
execFileSync('python',['tools/runtime/test-java-forks.py'],{stdio:'inherit',windowsHide:true});
const c=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json')),stage=JSON.parse(fs.readFileSync('.local/java-forks/profiles.json'));assert.equal(Object.keys(stage).length,5);
for(const[path,p]of Object.entries(stage)){
 const e=c.entries.find(x=>x.path===path);assert(e);assert.equal(p.upstream_sha256,e.sha256);
 for(const original of e.egg.variables){const adapted=p.egg.variables.find(v=>v.env_variable===original.env_variable);assert(adapted,path+original.env_variable);for(const name of['default_value','user_viewable','user_editable'])assert.equal(adapted[name],original[name]);}
 assert(p.egg.voltra.java_config.enabled);assert(p.egg.features.includes('minecraft'));assert.equal(p.egg.config.stop,e.egg.config.stop);assert.deepEqual(JSON.parse(p.egg.config.files),JSON.parse(e.egg.config.files));
 for(const source of['java-fork-install.py','java-fork-releases.json','minecraft-pack-install.py'])assert(p.egg.scripts.installation.script.includes(fs.readFileSync('internal/panel/game_library/scripts/'+source,'utf8')));
 if(path.includes('/krypton/')){
  const script=p.egg.scripts.installation.script;
  const content=script.split("cat > .voltra/krypton-gradle-verification.xml <<'VOLTRA_FORK_SOURCE'\n")[1]?.split('VOLTRA_FORK_SOURCE\n')[0];assert(content);
  const recipe=JSON.parse(fs.readFileSync('internal/panel/game_library/scripts/krypton-source-releases.json'));
  assert.equal(createHash('sha256').update(content).digest('hex'),recipe.verification_sha256,'actual embedded Gradle allowlist bytes must match pin');
 }
}
console.log('FiveexactJavaforks preserve originalcontrols/nativeconfiguration+currentembeddings.');
