export const operationPrefix = '@voltra/operation ';
export const operationMessages: Record<string, {message:string; recovery?:string}> = {
  DOWNLOAD_CONNECTING:{message:'Connecting to the download provider'},
  DOWNLOAD_RECEIVING:{message:'Downloading game files'},
  DOWNLOAD_VERIFYING:{message:'Checking the downloaded file'},
  DOWNLOAD_COMPLETE:{message:'Download complete'},
  DOWNLOAD_EXISTING:{message:'Using an existing downloaded file'},
  DOWNLOAD_FAILED:{message:'The download did not finish',recovery:'Check the node connection and available disk space, then retry the download.'},
  DISK_FULL:{message:'The node ran out of disk space',recovery:'Free disk space or ask the administrator to increase storage, then retry.'},
  LICENCE_REQUIRED:{message:'A game licence is required',recovery:'Ask the administrator to configure a valid game licence, or upload an installer you are licensed to use.'},
  PROVIDER_UNAVAILABLE:{message:'The download provider did not respond successfully',recovery:'Try again later. If this continues, ask the administrator to check access to the provider.'},
  DOWNLOAD_NOT_AUTHORIZED:{message:'The provider did not authorize this download',recovery:'Check the licence and its game edition, or upload the installer from your provider account.'},
  DOWNLOAD_UNSUPPORTED:{message:'No compatible installer was provided',recovery:'Check that the licence includes the supported game edition, or upload a compatible installer.'},
};
export type OperationEvent = {v:1; id:string; sequence:number; at:string; source:string; state:'queued'|'running'|'completed'|'failed'; phase:string; code:string; bytes?:number; total?:number|null; restart_required?:boolean};
const integer = (value:unknown):value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
export function parseOperationEvent(line:string):OperationEvent|null {
  if (line.length > 2048) return null;
  // Saved console output may prepend a clock time, but arbitrary chat text is not a report.
  const clean = line.replace(/^\[\d{1,2}:\d{2}:\d{2}\]\s*/, '');
  if (!clean.startsWith(operationPrefix)) return null;
  try {
    const e = JSON.parse(clean.slice(operationPrefix.length));
    if (!e || e.v !== 1 || typeof e.id !== 'string' || typeof e.source !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(e.id) || !/^[a-z][a-z0-9_-]{0,31}$/.test(e.source) || !integer(e.sequence) || e.sequence < 1 || typeof e.at !== 'string' || e.at.length > 30 || !Number.isFinite(Date.parse(e.at))) return null;
    if (!['queued','running','completed','failed'].includes(e.state) || !['prepare','authorize','download','verify','extract','apply'].includes(e.phase) || typeof e.code !== 'string' || !Object.hasOwn(operationMessages,e.code)) return null;
    if (e.bytes !== undefined && !integer(e.bytes) || e.total !== undefined && e.total !== null && (!integer(e.total) || e.total === 0 || e.bytes > e.total)) return null;
    return {v:1,id:e.id,sequence:e.sequence,at:e.at,source:e.source,state:e.state,phase:e.phase,code:e.code,...(e.bytes!==undefined?{bytes:e.bytes}:{}),...(e.total!==undefined?{total:e.total}:{}),...(typeof e.restart_required==='boolean'?{restart_required:e.restart_required}:{})};
  } catch {return null;}
}
export function mergeOperationEvent(events:OperationEvent[], event:OperationEvent):OperationEvent[] {
  const previous = events.find(e=>e.id===event.id);
  if (previous && (event.sequence<=previous.sequence || previous.state==='failed' || previous.state==='completed')) return events;
  return [...events.filter(e=>e.id!==event.id),event].slice(-12);
}
export const operationPending=(event:OperationEvent)=>event.state==='queued'||event.state==='running';
export const operationRecentlyActive=(event:OperationEvent,now=Date.now())=>operationPending(event)&&now-Date.parse(event.at)<=30000&&Date.parse(event.at)-now<=60000;
// Console and install events already obey the node's socket permissions. Never parse chat,
// download snapshots or arbitrary socket metadata as an operation report.
export function operationEventsFromMessage(message:{event?:unknown;args?:unknown}):OperationEvent[] {
  if(!['console output','install output'].includes(String(message.event))||!Array.isArray(message.args)||typeof message.args[0]!=='string')return [];
  return message.args[0].slice(-65536).split(/\r?\n/).slice(-256).map(parseOperationEvent).filter((event):event is OperationEvent=>event!==null);
}
