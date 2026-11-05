import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';
const dir=path.resolve('.local/game-parity-20261029/runtime/tachyon-native/parser-test');fs.mkdirSync(dir,{recursive:true});
for(const name of ['game_settings_tachyon.go','game_settings_tachyon_test.go'])fs.copyFileSync('internal/panel/'+name+'.pending',path.join(dir,name));
fs.writeFileSync(path.join(dir,'support.go'),'package panel\nimport "fmt"\ntype gameSetting struct { key,value,kind,on,off string }\ntype gameSettingsParsed struct { fields []gameSetting; patch func(map[string]string)([]byte,error) }\nfunc bad(s string)error{return fmt.Errorf("%s",s)}\n');
fs.writeFileSync(path.join(dir,'go.mod'),'module tachyon-parser-isolated\n\ngo 1.26\n');
const r=spawnSync('go',['test','-v','-count=1','.'],{cwd:dir,windowsHide:true,encoding:'utf8',timeout:60000});
fs.writeFileSync('artifacts/game-parity-20261029/tachyon-wave6-settings-tests.log',r.stdout+r.stderr);console.log(r.stdout+r.stderr);if(r.status!==0)process.exitCode=1;
