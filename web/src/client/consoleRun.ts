// Older panels do not send a run marker. Do not infer a run from reconnects.
export function consoleRunID(value:unknown):string|null {
  return typeof value==='string'&&/^\d+$/.test(value)?value:null;
}
export function consoleRunChanged(previous:string|undefined,next:unknown):boolean {
  const id=consoleRunID(next);
  return previous!==undefined&&id!==null&&id!==previous;
}
