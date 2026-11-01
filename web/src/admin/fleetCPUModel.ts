export function cpuThreads(payload:any):number|null{
 const count=(payload?.attributes??payload)?.cpu_count;
 return typeof count==='number'&&Number.isInteger(count)&&count>0?count:null;
}
export function cpuUsage(payload:any):number|null{
 const usage=(payload?.attributes??payload)?.resources?.cpu_absolute;
 return typeof usage==='number'&&Number.isFinite(usage)&&usage>=0?usage:null;
}
export function summarizeCPU(threads:(number|null)[],usage:(number|null)[]){
 const total=threads.reduce<number>((sum,value)=>sum+(value??0),0);
 const used=usage.reduce<number>((sum,value)=>sum+(value??0),0)/100;
 const complete=threads.length>0&&threads.every(value=>value!==null)&&usage.every(value=>value!==null);
 return {total,used,percent:complete?used/total*100:null,complete,available:usage.filter(value=>value!==null).length};
}
