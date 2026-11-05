import {proveInstaller} from './campaign-native-20261029.mjs';

export async function observeInstallerExit(waited, timeoutMs=10000) {
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1)throw Error('Positive bounded observation timeout required');
  let timer;
  try {
    return await Promise.race([
      waited.then(exit=>Number.isInteger(exit)&&exit>=0&&exit<=255?
        {observed:true,exit}:{observed:false,pending:true,reason:'invalid_exit_observation'},
      ()=>({observed:false,pending:true,reason:'wait_observer_failed'})),
      new Promise(resolve=>{timer=setTimeout(()=>resolve({observed:false,pending:true,reason:'exit_not_observed'}),timeoutMs);}),
    ]);
  } finally {clearTimeout(timer);}
}

// The observer attests the current owned queue phase, not a historical proof.
export function verifySoldatInstallerObservation({container, lease, queue, slot, uuid, kernel}) {
  const current=queue.installer_slot;
  if(lease.game!=='soldat/egg-soldat.json'||!uuid||!slot?.token||typeof slot.token!=='string'||!container.Name.includes(uuid)||
    current?.token!==slot?.token||current?.owner!==lease.owner||current?.lease_id!==lease.lease_id||
    !queue.claims.some(c=>c.lease_id===lease.lease_id&&c.owner===lease.owner&&c.status==='active'&&c.game===lease.game&&c.memory_mib===lease.memory_mib)) {
    throw Error('Current owned Soldat installer phase required');
  }
  const proof=proveInstaller(container,lease,queue);
  if(kernel.length!==3||kernel[0]!==String(proof.memory*1024**2)||kernel[1]!=='0'||kernel[2]!=='100000 100000') {
    throw Error('Actual installer kernel limits differ from current accounted phase');
  }
  return {memory_max:kernel[0],memory_swap_max:kernel[1],cpu_max:kernel[2],accounted_installer_memory_mib:proof.memory,runtime_memory_mib:lease.memory_mib};
}
