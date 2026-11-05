import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
const dir=path.resolve('.local/game-parity-20261029/runtime/xonotic-native/schema-test');fs.mkdirSync(dir,{recursive:true});
const original=fs.readFileSync('internal/panel/game_settings_source.go','utf8'),boundary=original.indexOf('\nfunc sourceSettingValue(');assert(boundary>0);
const declaration='func parseSourceSettings(data []byte) (gameSettingsParsed, error) {';
let proposal=original;
if(!original.includes('func parseSourceSettingsWithSchema(')){
 let head=original.slice(0,boundary);assert.equal(head.split(declaration).length,2);
 head=head.replace(declaration,'func parseSourceSettings(data []byte) (gameSettingsParsed, error) { return parseSourceSettingsWithSchema(data, sourceSettingKinds, sourceSettingValue) }\n\nfunc parseSourceSettingsWithSchema(data []byte, kinds map[string]string, validate func(string,string)bool) (gameSettingsParsed, error) {');
 head=head.replaceAll('sourceSettingKinds[key]','kinds[key]').replaceAll('sourceSettingKinds[f.key]','kinds[f.key]').replaceAll('sourceSettingValue(key, value)','validate(key, value)');
 proposal=head+original.slice(boundary);
}
assert(proposal.endsWith(original.slice(boundary)),'CS2 validator must remain byte-identical');fs.writeFileSync(path.join(dir,'game_settings_source.go'),proposal);
for(const name of ['game_settings_xonotic.go','game_settings_xonotic_test.go'])fs.copyFileSync('internal/panel/'+name+'.pending',path.join(dir,name));
fs.copyFileSync('internal/panel/game_settings_source_test.go',path.join(dir,'game_settings_source_test.go'));
fs.writeFileSync(path.join(dir,'support.go'),'package panel\nimport "fmt"\ntype gameSetting struct {key,value,kind,on,off string}\ntype gameSettingsParsed struct{fields []gameSetting;patch func(map[string]string)([]byte,error)}\nfunc bad(s string)error{return fmt.Errorf("%s",s)}\n');fs.writeFileSync(path.join(dir,'go.mod'),'module xonotic-schema-private\n\ngo 1.26\n');
const r=spawnSync('go',['test','-v','-count=1','.'],{cwd:dir,windowsHide:true,encoding:'utf8',timeout:60000});fs.writeFileSync('artifacts/game-parity-20261029/xonotic-wave8-schema-tests.log',(r.stdout||'')+(r.stderr||''));console.log((r.stdout||'')+(r.stderr||''));if(r.status!==0)process.exitCode=1;
