export type BackupStorage = {
  local_bytes:number;remote_bytes:number;other_bytes:number;total_bytes:number;
  pending_count:number;failed_count:number;
};
const valid = (value:unknown):value is number => typeof value==='number'&&Number.isFinite(value)&&value>=0;
export function backupStorage(value:unknown):BackupStorage|null {
  if(!value||typeof value!=='object')return null;
  const data=value as BackupStorage;
  return ['local_bytes','remote_bytes','other_bytes','total_bytes','pending_count','failed_count'].every(key=>valid(data[key as keyof BackupStorage]))?data:null;
}
export function storageTotals(files:number|null,backups:BackupStorage|null) {
  return {
    recorded:files!==null&&backups!==null?files+backups.total_bytes:null,
    local:files!==null&&backups!==null?files+backups.local_bytes:null,
    incomplete:!!backups&&(backups.pending_count>0||backups.failed_count>0),
  };
}
export function storageLimit(used:unknown,limit:unknown,zero:'unlimited'|'disabled'='unlimited') {
  if(!valid(limit))return {percent:undefined,message:'Limit unavailable',level:'unknown'};
  if(limit===0)return {percent:undefined,message:zero==='disabled'?'Backups disabled':'No configured limit',level:'none'};
  if(!valid(used))return {percent:undefined,message:'Usage unavailable',level:'unknown'};
  const percent=used/limit*100;
  return {percent,message:percent>=100?'Limit reached':percent>=90?'Almost full':percent>=80?'Approaching limit':'',level:percent>=100?'full':percent>=80?'warning':'normal'};
}
