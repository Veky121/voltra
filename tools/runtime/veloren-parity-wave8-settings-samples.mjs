import fs from 'node:fs';
import crypto from 'node:crypto';
const base='.local/game-parity-20261029/veloren-root-native',out='artifacts/game-parity-20261029',state=JSON.parse(fs.readFileSync(base+'/state.json'));
if(!state.starts?.some(x=>x.ready)||!state.queries?.baseline)throw Error('Actual native ready/query evidence required before sample publication');
const rows=[];
for(const [local,name,keys]of[
 ['baseline-userdata_server_server_config_settings.ron','veloren-wave8-actual-managed-settings.ron',['auth_server_address','gameserver_protocols','max_players','metrics_address','query_address','server_name']],
 ['baseline-userdata_server-cli_settings.ron','veloren-wave8-actual-managed-cli-settings.ron',['shutdown_signals','update_shutdown_grace_period_secs','web_address']]
]){
 const bytes=fs.readFileSync(base+'/'+local),text=bytes.toString('utf8'),actual=[...text.matchAll(/^    ([a-z_]+):/gm)].map(m=>m[1]);
 if(JSON.stringify(actual)!==JSON.stringify(keys)||/secret|password|token/i.test(text))throw Error('Sample differs from inspected nonsecret managed-only shape');
 fs.writeFileSync(out+'/'+name,bytes);rows.push({native_capture:base+'/'+local,public_sample:out+'/'+name,keys,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});
}
fs.writeFileSync(out+'/veloren-wave8-actual-settings.json',JSON.stringify({at:new Date().toISOString(),server_uuid:state.server.uuid,build:state.queries.baseline.git_hash,documents:rows,observation:'Existing Rust bridge creates minimal managed configuration before native loading. Native defaults are accepted in memory and omitted from these generated files.',candidate_fields_absent:['day_length','max_player_group_size'],typed_editor_status:'Partial. Existing-only two-scalar proposal would expose zero editable controls in these real documents. Do not claim typed support or insert inferred defaults until reviewed native/schema integration.',native_validation:'Actual startup reached native readiness and upstream UDP challenge query succeeded. No player authentication/gameplay claim.'},null,2)+'\n');
console.log(JSON.stringify(rows));
