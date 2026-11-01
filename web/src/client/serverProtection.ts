type Schedule={is_active?:boolean;only_when_online?:boolean;next_run_at?:string|null;relationships?:{tasks?:{data?:Array<{attributes?:{action?:string}}>}}};
export function backupProtection(schedules:Schedule[]) {
  const active=schedules.filter(s=>s.is_active&&s.relationships?.tasks?.data?.some(t=>t.attributes?.action==='backup'));
  const dates=active.map(s=>s.next_run_at).filter((date):date is string=>!!date&&Number.isFinite(Date.parse(date))).sort((a,b)=>Date.parse(a)-Date.parse(b));
  return {count:active.length,next:dates[0]||null,onlineOnly:active.length>0&&active.every(s=>s.only_when_online)};
}
