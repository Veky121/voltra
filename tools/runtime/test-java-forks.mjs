import fs from'node:fs';import assert from'node:assert/strict';import{createHash}from'node:crypto';import{execFileSync}from'node:child_process';
execFileSync('python',['tools/runtime/test-java-forks.py'],{stdio:'inherit',windowsHide:true});
const c=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json')),stage=JSON.parse(fs.readFileSync('.local/java-forks/profiles.json'));assert.equal(Object.keys(stage).length,5);
for(const[path,p]of Object.entries(stage)){
 const e=c.entries.find(x=>x.path===path);assert(e);assert.equal(p.upstream_sha256,e.sha256);
 for(const original of e.egg.variables){const adapted=p.egg.variables.find(v=>v.env_variable===original.env_variable);assert(adapted,path+original.env_variable);for(const name of['default_value','user_viewable','user_editable'])assert.equal(adapted[name],original[name]);}
 assert(p.egg.voltra.java_config.enabled);assert(p.egg.features.includes('minecraft'));assert.equal(p.egg.config.stop,e.egg.config.stop);
 const files=JSON.parse(p.egg.config.files),originalFiles=JSON.parse(e.egg.config.files);
 if(path.includes('/krypton/')){for(const[key,value]of Object.entries(originalFiles['config.conf'].find))assert.equal(files['config.conf'].find[key],value);for(const key of['ip','port'])assert.equal(files['config.conf'].find['    '+key],originalFiles['config.conf'].find['  '+key]);}
 else assert.deepEqual(files,originalFiles);
 for(const source of['java-fork-install.py','java-fork-releases.json','minecraft-pack-install.py'])assert(p.egg.scripts.installation.script.includes(fs.readFileSync('internal/panel/game_library/scripts/'+source,'utf8')));
 if(path.includes('/krypton/')){
  assert(!p.egg.startup.includes('nogui'),'Krypton CLI rejects generic nogui argument');
  const nativeFile='.local/java-forks/source/config-supplement-probe-v2/init/config.conf';
  if(fs.existsSync(nativeFile)){
   const lines=fs.readFileSync(nativeFile,'utf8').split('\n');
   for(const key of['ip','port']){const line=lines.find(l=>l.startsWith('    '+key+'='));assert(line,'native generated '+key);assert(!line.startsWith('  '+key));assert.equal(Object.keys(files['config.conf'].find).filter(prefix=>Buffer.from(line).subarray(0,Buffer.byteLength(prefix)).equals(Buffer.from(prefix))).length,1,'Wings exact byte prefix matches one rule');}
  }
  const script=p.egg.scripts.installation.script;
  const content=script.split("cat > .voltra/krypton-gradle-verification.xml <<'VOLTRA_FORK_SOURCE'\n")[1]?.split('VOLTRA_FORK_SOURCE\n')[0];assert(content);
  const recipe=JSON.parse(fs.readFileSync('internal/panel/game_library/scripts/krypton-source-releases.json'));
  assert.equal(createHash('sha256').update(content).digest('hex'),recipe.verification_sha256,'actual embedded Gradle allowlist bytes must match pin');
  const helper=script.split("cat > .voltra/krypton_source_build.py <<'VOLTRA_FORK_SOURCE'\n")[1]?.split('VOLTRA_FORK_SOURCE\n')[0];assert(helper);
  assert.equal(createHash('sha256').update(helper).digest('hex'),createHash('sha256').update(fs.readFileSync('internal/panel/game_library/scripts/krypton-source-build.py')).digest('hex'),'actual compiler helper bytes must remain exact for source provenance/cache identity');
 }
}
console.log('FiveexactJavaforks preserve originalcontrols/nativeconfiguration+currentembeddings.');
