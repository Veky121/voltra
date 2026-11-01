// Status groups stay together; names sort naturally within each group.
const priority:Record<string,number>={running:0,starting:1,stopping:2,offline:3,stopped:3,installing:4,restoring_backup:5,suspended:6,install_failed:7,reinstall_failed:7,unavailable:8,unknown:9};
export function compareServers(a:{liveState:string;name?:string;uuid?:string},b:{liveState:string;name?:string;uuid?:string}){
 return (priority[a.liveState]??9)-(priority[b.liveState]??9)
  ||(a.name||'').localeCompare(b.name||'',undefined,{numeric:true,sensitivity:'base'})
  ||(a.uuid||'').localeCompare(b.uuid||'');
}
