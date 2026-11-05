import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
const dir=path.resolve('.local/game-parity-20261029/goldsrc-schema-proposal');
fs.mkdirSync(dir,{recursive:true});
const shared='internal/panel/game_settings_source.go',before=fs.readFileSync(shared);
const proposal='.local/game-parity-20261029/runtime/css-native/schema-test/game_settings_source.go';
const original=before.toString('utf8');
const sharedIntegrated=original.includes('func parseSourceSettingsWithSchema(');
const proposed=sharedIntegrated?original:fs.readFileSync(proposal,'utf8');
const boundary=original.indexOf('\nfunc sourceSettingValue(');assert(boundary>0);
assert(proposed.endsWith(original.slice(boundary)),'Original CS2 validator bytes changed in the shared proposal');
fs.writeFileSync(path.join(dir,'game_settings_source.go'),proposed);
for(const name of ['game_settings_css.go','game_settings_css_test.go','game_settings_goldsrc.go','game_settings_goldsrc_test.go','game_settings_goldsrc_presentation.go','game_settings_goldsrc_presentation_test.go']){
 const pending='internal/panel/'+name+'.pending';fs.copyFileSync(fs.existsSync(pending)?pending:'internal/panel/'+name,path.join(dir,name));
}
fs.copyFileSync('internal/panel/game_settings_source_test.go',path.join(dir,'game_settings_source_test.go'));
fs.writeFileSync(path.join(dir,'support.go'),'package panel\nimport "fmt"\ntype gameSetting struct{key,value,kind,on,off string}\ntype gameSettingsParsed struct{fields []gameSetting;patch func(map[string]string)([]byte,error)}\nfunc bad(s string)error{return fmt.Errorf("%s",s)}\n');
fs.appendFileSync(path.join(dir,'support.go'),'type M=map[string]any\ntype fixtureTemplate struct{Path string;Egg M}\nfunc gameTemplates()struct{Entries []fixtureTemplate}{return struct{Entries []fixtureTemplate}{[]fixtureTemplate{{"counter_strike/counter_strike_1.6/egg-counter-strike1-6--vanilla.json",M{"startup":"fixture"}}}}}\nfunc gameTemplateEggUUID(entry fixtureTemplate)string{return entry.Path}\nfunc nativeSettingsIsRecipe(egg M,recipe string)bool{return egg["uuid"]==recipe}\n');
fs.writeFileSync(path.join(dir,'go.mod'),'module goldsrc-schema-proposal\n\ngo 1.26\n');
const publisher='.local/game-parity-20261029/cs16-vanilla-native/publisher/cstrike/server.cfg';
const captureAvailable=fs.existsSync(publisher);
if(captureAvailable){
 fs.mkdirSync(path.join(dir,'testdata'),{recursive:true});fs.copyFileSync(publisher,path.join(dir,'testdata','publisher-server.cfg'));
 fs.writeFileSync(path.join(dir,'publisher_capture_test.go'),'package panel\nimport("os";"testing";"bytes")\nfunc TestGoldSrcActualPublisherStockReadOnly(t *testing.T){data,err:=os.ReadFile("testdata/publisher-server.cfg");if err!=nil{t.Fatal(err)};p,err:=parseGoldSrcCS16Settings(data);if err!=nil||len(p.fields)!=1||p.fields[0].key!="mp_timelimit"||p.fields[0].kind!="readonly"{t.Fatal("Actual publisher include chain not conservative",err,p.fields)};if _,err=p.patch(map[string]string{"mp_timelimit":"30"});err==nil{t.Fatal("Dynamic include authority invented")};same,err:=p.patch(nil);if err!=nil||!bytes.Equal(same,data){t.Fatal("Publisher bytes changed")}}\n');
}
const result=spawnSync('go',['test','-v','-count=1','.'],{cwd:dir,windowsHide:true,encoding:'utf8',timeout:60000});
const log=(result.stdout||'')+(result.stderr||'');fs.writeFileSync('artifacts/game-parity-20261029/goldsrc-wave8-schema-tests.log',log);
assert(fs.readFileSync(shared).equals(before),'Shared canonical Source parser changed during the proposal test');
const report={at:new Date().toISOString(),scope:'Pending measured GoldSrc schema on the one shared Source lexer; no live dispatch',shared_source_sha256:digest(before),shared_proposal_sha256:digest(Buffer.from(proposed)),shared_generic_function_already_integrated:sharedIntegrated,shared_source_unchanged:true,original_CS2_validator_byte_identical:true,goldsrc_reviewed_schema_fields:15,actual_publisher_cfg_tested:captureAvailable,native_cvar_evidence_received:true,stock_default_writable_fields:0,passed:result.status===0,log:'artifacts/game-parity-20261029/goldsrc-wave8-schema-tests.log',native_acceptance:false};
fs.writeFileSync('artifacts/game-parity-20261029/goldsrc-wave8-schema-test.json',JSON.stringify(report,null,2)+'\n');
console.log(log);if(result.status!==0)process.exitCode=1;
