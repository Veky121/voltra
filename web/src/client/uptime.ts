export function formatUptime(ms:number):string{
 const seconds=Math.floor(Math.max(0,Number.isFinite(ms)?ms:0)/1000);
 const hours=Math.floor(seconds/3600),minutes=Math.floor(seconds/60)%60;
 return `${hours?`${hours}h `:''}${hours||minutes?`${minutes}m `:''}${seconds%60}s`;
}
