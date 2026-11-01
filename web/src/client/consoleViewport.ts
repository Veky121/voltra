import type {ConsoleHistory,ConsoleHistoryChunk} from './consoleHistory.ts';

export type ConsoleRange={start:number;end:number};
export function consoleViewport(count:number,top:number,height:number,lineHeight:number,selection:ConsoleRange|null=null):ConsoleRange {
  const line=Math.max(1,lineHeight),margin=40;
  const start=Math.min(count,Math.max(0,Math.floor(Math.max(0,top)/line)-margin));
  const end=Math.min(count,Math.max(start,Math.ceil((Math.max(0,top)+height)/line)+margin));
  // Keep the selection anchor mounted while dragging or holding a selection.
  // Copy/save use the full buffer independently of this rendering window.
  return {start:Math.min(start,selection?.start??start),end:Math.min(count,Math.max(end,selection?.end??end))};
}
export function consoleViewportChunks(history:ConsoleHistory,range:ConsoleRange):ConsoleHistoryChunk[] {
  const chunks:ConsoleHistoryChunk[]=[];
  let offset=0;
  for(const chunk of history.chunks){
    const end=offset+chunk.lines.length;
    if(offset>=range.end)break;
    if(end>range.start){
      const from=Math.max(0,range.start-offset),to=Math.min(chunk.lines.length,range.end-offset);
      chunks.push(from===0&&to===chunk.lines.length?chunk:{...chunk,lines:chunk.lines.slice(from,to)});
    }
    offset=end;
  }
  return chunks;
}
