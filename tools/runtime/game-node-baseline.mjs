// Read-only check of an owned acceptance node after server cleanup.
// Usage: node tools/runtime/game-node-baseline.mjs baseline.json receipt.json output.json
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const [baselinePath,receiptPath,outputPath]=process.argv.slice(2);
const baseline=JSON.parse(fs.readFileSync(baselinePath));
const receipt=JSON.parse(fs.readFileSync(receiptPath));
if(!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(receipt.uuid))throw Error('Invalid acceptance UUID');
const script=`import json,hashlib,subprocess,os
owned=subprocess.run(['docker','inspect','${receipt.uuid}'],stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,text=True)
removed=owned.returncode==1 and ('no such object' in owned.stderr.lower() or 'no such container' in owned.stderr.lower())
print(json.dumps({'config_sha256':hashlib.sha256(open('/etc/pterodactyl/config.yml','rb').read()).hexdigest(),'wings_pid':subprocess.check_output(['systemctl','show','wings','--property=MainPID','--value'],text=True).strip(),'containers':sorted(subprocess.check_output(['docker','ps','--format','{{.ID}}'],text=True).split()),'acceptance_container_removed':removed,'acceptance_volume_removed':not os.path.exists('/var/lib/voltra-temp-20261022-lan/volumes/${receipt.uuid}')}))`;
const result=spawnSync('ssh',['-o','BatchMode=yes','home-server-ai','sudo -n python3 -'],{windowsHide:true,input:script,encoding:'utf8'});
if(result.status)throw Error('Baseline inspection failed: '+result.stderr);
const state=JSON.parse(result.stdout);
const preserved=state.config_sha256===baseline.config_sha256&&state.wings_pid===baseline.wings_pid&&JSON.stringify(state.containers)===JSON.stringify([...baseline.containers].sort());
const evidence={...state,baseline_preserved:preserved,observed_at:new Date().toISOString()};
fs.writeFileSync(outputPath,JSON.stringify(evidence,null,2)+'\n');
console.log({baseline_preserved:preserved,original_containers:state.containers.length,acceptance_container_removed:state.acceptance_container_removed,acceptance_volume_removed:state.acceptance_volume_removed});
if(!preserved||!state.acceptance_container_removed||!state.acceptance_volume_removed)process.exitCode=1;
