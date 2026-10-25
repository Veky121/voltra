// Change crash retry only on the receipt-owned disposable Wings container.
// Prepare is read-only. Apply requires every mounted game/installer to be stopped.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
const directory='.local/batch-node',receiptPath=directory+'/private.json';
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
const docker=args=>execFileSync('docker',args,{encoding:'utf8',windowsHide:true,maxBuffer:8<<20}).trim();
async function inspect(){
 const receiptBytes=fs.readFileSync(receiptPath),receipt=JSON.parse(receiptBytes);
 if(receipt.container!=='voltra-batch-20261023'||receipt.root!=='/var/lib/voltra-batch-20261023'||receipt.volume_root!==receipt.root+'/volumes')throw Error('Unknown disposable node ownership');
 const [daemon]=JSON.parse(docker(['inspect',receipt.container]));
 if(daemon.Config.Labels?.['voltra.owner']!=='batch-20261023'||!daemon.State.Running)throw Error('Owned daemon is not healthy/running');
 const configPath=path.resolve(receipt.configuration_path);
 if(configPath!==path.resolve(directory+'/wings.json'))throw Error('Unexpected private configuration path');
 if(!daemon.Mounts.some(m=>path.resolve(m.Source)===configPath&&m.Destination==='/etc/pterodactyl/config.yml'))throw Error('Owned configuration mount changed');
 const configBytes=fs.readFileSync(configPath),config=JSON.parse(configBytes);
 if(config.uuid!==receipt.node_uuid||config.system?.data!==receipt.volume_root)throw Error('Node configuration identity changed');
 const response=await fetch('http://127.0.0.1:8088/api/application/nodes/'+receipt.node);const live=await response.json();
 if(!response.ok||(live.attributes??live).uuid!==receipt.node_uuid)throw Error('Live node identity mismatch');
 const ids=docker(['ps','-aq']).split(/\s+/).filter(Boolean);
 const containers=ids.length?JSON.parse(docker(['inspect',...ids])):[];
 const active=containers.filter(c=>c.Id!==daemon.Id&&c.State.Running&&c.Mounts?.some(m=>m.Source===receipt.volume_root||m.Source.startsWith(receipt.volume_root+'/')));
 if(active.length)throw Error('Owned game or installer is active; crash-policy change held: '+active.map(c=>c.Name.replace(/^\//,'')).join(', '));
 return{receipt,receiptBytes,daemon,configPath,configBytes,config};
}
const mode=process.argv[2]??'prepare';if(!['prepare','apply'].includes(mode))throw Error('Use prepare or apply');
const state=await inspect();
const plan={at:new Date().toISOString(),node:state.receipt.node,node_uuid:state.receipt.node_uuid,container:state.receipt.container,container_id:state.daemon.Id,receipt_sha256:digest(state.receiptBytes),configuration_sha256:digest(state.configBytes),before_enabled:state.config.system?.crash_detection?.enabled??true,after_enabled:false,all_owned_game_mounts_stopped:true};
const planPath=directory+'/crash-policy-plan.json';
if(mode==='prepare'){
 fs.writeFileSync(planPath,JSON.stringify(plan,null,2)+'\n',{mode:0o600});
 console.log({prepared:true,node:plan.node,all_owned_game_mounts_stopped:true,before_enabled:plan.before_enabled,after_enabled:false});
}else{
 const previous=JSON.parse(fs.readFileSync(planPath));
 for(const key of ['node_uuid','container_id','receipt_sha256','configuration_sha256'])if(plan[key]!==previous[key])throw Error('Prepared crash-policy plan became stale');
 const backup=directory+'/crash-policy-original-'+Date.now()+'.json';fs.writeFileSync(backup,state.configBytes,{mode:0o600,flag:'wx'});
 const resultPath=directory+'/crash-policy-applied.json';
 const result={...plan,backup,status:'prepared',restarted_owned_daemon_only:false};
 const record=()=>fs.writeFileSync(resultPath,JSON.stringify(result,null,2)+'\n',{mode:0o600});record();
 state.config.system.crash_detection={...state.config.system.crash_detection,enabled:false};
 // Deliberate visible scope: only the receipt-owned test daemon is restarted.
 fs.writeFileSync(state.configPath,JSON.stringify(state.config,null,2)+'\n',{mode:0o600});
 result.status='configuration_written';record();
 try{docker(['restart','-t','10',state.receipt.container]);}catch(error){result.status='restart_failed_or_uncertain';record();throw error;}
 result.status='restarted';result.restarted_owned_daemon_only=true;record();
 console.log({applied:true,node:plan.node,restarted_owned_daemon_only:true});
}
