// Campaign-only admission calculation. This does not intercept panel or Wings APIs.
export function campaignDefaults(lease) {
  if (!Number.isSafeInteger(lease.memory_mib) || lease.memory_mib < 128 || lease.memory_mib > 8192) throw Error('Memory lease must be 128..8192 MiB');
  return {memory:lease.memory_mib,swap:0,cpu:100,oom_disabled:false};
}
export function assertCampaignAdmission({lease,build,hostAvailableBytes,diskFreeBytes,activeCpuPercent=0,installerCount=0}) {
  const expected=campaignDefaults(lease);
  for(const k of Object.keys(expected))if(build[k]!==expected[k])throw Error('Build differs from bounded campaign default: '+k);
  if(hostAvailableBytes<16*1024**3 || diskFreeBytes<100*1024**3)throw Error('Host headroom below campaign policy');
  if(installerCount!==0 || activeCpuPercent+build.cpu>400)throw Error('Installer concurrency or CPU budget exceeded');
  if(lease.status!=='active')throw Error('Active queue lease required');
  return {expected_docker:{Memory:build.memory*1024**2,MemorySwap:build.memory*1024**2,CpuPeriod:100000,CpuQuota:100000},reservation_mib:build.memory};
}
export function assertInstallerProof(actual,expected) {
  for(const k of ['Memory','MemorySwap','CpuPeriod','CpuQuota']) {
    if(!Number.isSafeInteger(expected[k]) || expected[k]<=0 || actual[k]!==expected[k])throw Error('Installer hard limit mismatch: '+k);
  }
  if(actual.OomKillDisable===true)throw Error('OOM killer must remain enabled');
}
