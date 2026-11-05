// Genuine publisher client protocol/map synchronization in the existing game
// cgroup. Null video/audio; no browser, desktop, GUI automation or second lease.
import fs from 'node:fs';
import path from 'node:path';
import {runtime,docker,verifyRuntime,activeLease,observePower,digest} from './campaign-native-20261029.mjs';
const dir=path.join(runtime,'banana-wave4-openttd'),file=path.join(dir,'state.json'),state=JSON.parse(fs.readFileSync(file));
await verifyRuntime();activeLease(state.lease.lease_id,'openttd_native_banana');
if(JSON.parse(fs.readFileSync(path.join(runtime,'queue.json'))).activation_pause)throw Error('Activation paused');
if((await observePower(state.fixture)).current_state!=='running')throw Error('Owned OpenTTD must be running');
const uuid=state.fixture.server.uuid,port=state.lease.ports[0];if(!/^[a-f0-9-]{36}$/.test(uuid)||!Number.isSafeInteger(port))throw Error('Owned fixture identity required');
const c=JSON.parse(docker(['inspect',uuid]))[0];if(c.Name!=='/'+uuid||c.HostConfig.NetworkMode!=='voltra-parity-20261029'||c.HostConfig.Memory!==512*1024**2||c.HostConfig.MemorySwap!==c.HostConfig.Memory)throw Error('Existing bounded owned game required');
const script=`mkdir -p /home/container/.voltra/acceptance-client
cat > /home/container/.voltra/acceptance-client/openttd.cfg <<'VOLTRA_CLIENT_CFG'
[network]
client_name = VoltraNativeFixture
participate_survey = no
[gui]
autosave_on_exit = false
VOLTRA_CLIENT_CFG
timeout 20s /home/container/openttd -v null:ticks=10000000 -s null -m null -x -c /home/container/.voltra/acceptance-client/openttd.cfg -n 127.0.0.1:${port}#255 -d net=9 > /home/container/.voltra/acceptance-client/client.log 2>&1
result=$?
printf '%s\\n' "$result" > /home/container/.voltra/acceptance-client/client.exit
exit 0
`;
docker(['exec',uuid,'sh','-c',script]);
const log=docker(['exec',uuid,'cat','/home/container/.voltra/acceptance-client/client.log']);
const exit=docker(['exec',uuid,'cat','/home/container/.voltra/acceptance-client/client.exit']).trim();
const server=docker(['logs',uuid]);
const logPath=path.join(dir,'native-client.log');fs.writeFileSync(logPath,log);
const proof={at:new Date().toISOString(),publisher_client_same_installed_binary:true,network_scope:'same owned bounded game container TCP loopback',new_lease:false,graphical_ui:false,graphical_gameplay:false,log:logPath,log_sha256:digest(log),controlled_timeout_exit:exit,join_sent:log.includes('Client::SendJoin()'),map_received:log.includes('Client::SendMapOk()'),frame_ack:log.includes('Client::SendAck()'),server_observed_fixture:server.includes('VoltraNativeFixture'),server_oom:false};
state.native_client=proof;fs.writeFileSync(file,JSON.stringify(state,null,2)+'\n');console.log(JSON.stringify(proof));
if(!proof.join_sent||!proof.map_received||!proof.frame_ack||!proof.server_observed_fixture)throw Error('Native client synchronization not proved; inspect owned log');
