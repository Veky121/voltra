import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {ownedStoppedServer} from './cache-owned-server.mjs';
import {api} from './openttd-compat-node.mjs';
const dir='.local/onset-native',{receipt:s,node,image}=await ownedStoppedServer(dir+'/private.json');
if(s.owner!=='unreal_survival'||s.external_id&&s.external_id!=='onset-native-'+s.request_id)throw Error('Foreign fixture');
const db=JSON.parse(spawnSync('docker',['inspect',s.db_container],{windowsHide:true,encoding:'utf8'}).stdout)[0];
if(db.Config.Labels['voltra.acceptance.server']!==s.uuid||db.Config.Labels['voltra.acceptance.request']!==s.request_id||!db.State.Running)throw Error('Owned DB missing');
const lua=`local sql = nil
AddEvent("OnPackageStart", function()
 sql = mariadb_connect("${s.db_container}:3306", "voltra_onset_acceptance", os.getenv("SERVER_PASSWORD"), "voltra_onset_acceptance")
 if sql == false then print("VOLTRA_SQL_CONNECT_FAILED"); return end
 mariadb_query(sql, "CREATE TABLE IF NOT EXISTS acceptance (id INT PRIMARY KEY, boots INT NOT NULL)")
 mariadb_query(sql, "INSERT INTO acceptance VALUES (1,1) ON DUPLICATE KEY UPDATE boots=boots+1")
 mariadb_query(sql, "SELECT 517077,boots FROM acceptance WHERE id=1", function()
  print("VOLTRA_SQL_PROOF marker=" .. tostring(mariadb_get_value_index_int(1,1)) .. " boots=" .. tostring(mariadb_get_value_index_int(1,2)))
 end)
end)
AddEvent("OnPackageStop", function() if sql ~= nil and sql ~= false then mariadb_close(sql) end end)
`;
const script=`import pathlib,json,os
r=pathlib.Path('/fixture');p=r/'packages/voltra_acceptance'
assert not p.exists(), 'Do not overwrite prior fixture package'
p.mkdir();(p/'package.json').write_text(json.dumps({'author':'Voltra isolated acceptance','version':'1.0','server_scripts':['server.lua'],'client_scripts':[],'files':[]}));(p/'server.lua').write_text(${JSON.stringify(lua)})
c=r/'server_config.json';v=json.loads(c.read_text());assert 'voltra_acceptance' not in v['packages'];v['packages'].append('voltra_acceptance');v['maxplayers']=9;v['voltra_unknown_preservation']={'marker':'native-sql-acceptance','unicode':'ž'};c.write_text(json.dumps(v,indent=2)+'\\n')
(r/'packages/voltra_acceptance/operator-note.txt').write_text('Exact private native acceptance persistence marker ž\\n');os.chmod(p/'operator-note.txt',0o640)
print(json.dumps({'packages':v['packages'],'maxplayers':v['maxplayers'],'credentials_in_package':False}))
`;
const info=JSON.parse(spawnSync('docker',['inspect',s.uuid],{windowsHide:true,encoding:'utf8'}).stdout)[0];
const result=spawnSync('docker',['run','--rm','-i','--pull','never','--network','none','--memory','256m','--user',info.Config.User,'--cap-drop','ALL','--security-opt','no-new-privileges','--mount',`type=bind,source=${node.volume_root}/${s.uuid},target=/fixture`,image,'python3','-B','-'],{windowsHide:true,encoding:'utf8',input:script});
if(result.status)throw Error(result.stderr);
await api('/api/application/servers/'+s.internal_id+'/startup','PATCH',{environment:{SERVER_PASSWORD:s.db_password,AUTO_UPDATE:'0'}});
fs.writeFileSync(dir+'/sql-prepare.json',result.stdout);console.log(result.stdout);
