import {captureErrorContext,reportPanelError,resolvePanelErrors} from './store';

// For binary/streaming and desktop callers which intentionally do not use api().
// Never clone or record their bodies, headers, or signed query parameters.
export async function observedFetch(input:string|URL,options:RequestInit={},expectedStatuses:number[]=[]){
 const path=String(input);
 const context=captureErrorContext('HTTP',{endpoint:path,method:options.method||'GET'});
 try{
  const response=await fetch(path,options);
  if(!response.ok&&!expectedStatuses.includes(response.status))reportPanelError(`Request failed (${response.status}).`,{...context,status:response.status});
  else if(response.ok)resolvePanelErrors(path,options.method||'GET',context.epoch);
  return response;
 }catch(error){if(!options.signal?.aborted)reportPanelError(error,context);throw error}
}
