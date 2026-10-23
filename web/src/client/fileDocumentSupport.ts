export const EDIT_LIMIT=4*1024*1024;
export const VIEW_CHUNK=256*1024;

/** Enforce the limit even if a node ignores HTTP Range or omits Content-Length. */
export async function readBounded(response:Response,limit:number){
  const reader=response.body?.getReader();
  if(!reader)return {buffer:new ArrayBuffer(0),truncated:false};
  const chunks:Uint8Array[]=[];let length=0,truncated=false;
  try{
    while(true){
      const result=await reader.read();if(result.done)break;
      const room=limit-length;
      if(result.value.length>room){if(room)chunks.push(result.value.slice(0,room));length+=room;truncated=true;await reader.cancel();break}
      chunks.push(result.value);length+=result.value.length;
    }
  }finally{reader.releaseLock()}
  const bytes=new Uint8Array(length);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
  return {buffer:bytes.buffer,truncated};
}

export function previewKind(path:string):'image'|'audio'|'video'|'pdf'|'text'{
  const extension=path.split('.').at(-1)?.toLowerCase();
  if(['png','jpg','jpeg','gif','webp','avif','bmp','ico'].includes(extension||''))return 'image';
  if(['mp3','wav','ogg','flac','m4a','aac'].includes(extension||''))return 'audio';
  if(['mp4','webm','ogv','mov'].includes(extension||''))return 'video';
  if(extension==='pdf')return 'pdf';
  return 'text';
}

export function mixedNewlines(text:string){
  const styles=new Set(text.match(/\r\n|\r|\n/g)||[]);
  return styles.size>1;
}

export function responseSize(response:Response){
  const total=response.headers.get('Content-Range')?.match(/\/(\d+)$/)?.[1];
  const raw=total??response.headers.get('Content-Length');
  return raw===null||raw===undefined?null:Number(raw);
}
