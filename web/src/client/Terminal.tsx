import {confirmAction} from '../ui/ConfirmAction';
import {IconButton} from '../ui/IconButton';
import {DropdownMenu,DropdownMenuTrigger,DropdownMenuContent,DropdownMenuItem} from '../components/ui/dropdown-menu';
import {requestServerPower} from './serverPower';
import {memo,useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {consoleViewport,consoleViewportChunks,type ConsoleRange} from './consoleViewport';
import {Icon} from '../Icons';
import {can,Notice,useAction,useServer} from './common';
import {CONSOLE_HISTORY_LINES,CONSOLE_HISTORY_CHARACTERS,consoleHistoryText,type ConsoleHistory,type ConsoleHistoryChunk} from './consoleHistory';
import {stripConsoleControls} from './consoleOutput';

const HistoryChunk=memo(function HistoryChunk({chunk}:{chunk:ConsoleHistoryChunk}){
  return <>{chunk.lines.map(line=><span key={line.id} className={`console-line console-level-${line.formatted.level}`}>{line.formatted.segments.map((segment,i)=><span key={i} style={segment.style}>{segment.text}</span>)}</span>)}</>;
});

export default function Terminal({history:logHistory,status,connection,busy,onClear,onSend}:{history:ConsoleHistory;status:string;connection:string;busy:boolean;onClear:()=>void;onSend:(command:string,done:()=>void)=>void}){
  const {server,base,permissions}=useServer();
  const action=useAction();
  const [command,setCommand]=useState(''),[autoScroll,setAutoScroll]=useState(true),[history,setHistory]=useState<string[]>([]);
  const output=useRef<HTMLPreElement>(null),input=useRef<HTMLInputElement>(null);
  const [toolsOpen,setToolsOpen]=useState(false),[historyOpen,setHistoryOpen]=useState(false);
  const historyIndex=useRef(-1),draft=useRef('');
  const [heldHistory,setHeldHistory]=useState<ConsoleHistory|null>(null);
  const currentHistory=useRef(logHistory),pointerSelecting=useRef(false);
  const selectionWindow=useRef<ConsoleRange|null>(null);
  const [viewport,setViewport]=useState({top:0,height:400,lineHeight:20.8});
  currentHistory.current=logHistory;
  const displayed=heldHistory??logHistory;
  const range=consoleViewport(displayed.count,viewport.top,viewport.height,viewport.lineHeight,heldHistory?selectionWindow.current:null);
  const currentRange=useRef(range);currentRange.current=range;
  const visibleChunks=useMemo(()=>consoleViewportChunks(displayed,range),[displayed,range.start,range.end]);
  const measureViewport=()=>{
    const element=output.current;if(!element)return;
    const next={top:element.scrollTop,height:element.clientHeight,lineHeight:parseFloat(getComputedStyle(element).lineHeight)||20.8};
    setViewport(old=>old.top===next.top&&old.height===next.height&&old.lineHeight===next.lineHeight?old:next);
  };
  useLayoutEffect(()=>{measureViewport();const observer=new ResizeObserver(measureViewport);if(output.current)observer.observe(output.current);return()=>observer.disconnect()},[]);
  useEffect(()=>{pointerSelecting.current=false;setHeldHistory(null);setAutoScroll(true)},[base]);
  const working=busy||action.busy,running=status==='running';
  const plainLog=()=>stripConsoleControls(consoleHistoryText(displayed));
  useLayoutEffect(()=>{if(autoScroll&&!heldHistory&&output.current){output.current.scrollTop=output.current.scrollHeight;measureViewport()}},[displayed,autoScroll,heldHistory]);
  useEffect(()=>{
    const selectionInOutput=()=>{
      const selection=window.getSelection();
      if(!selection||selection.isCollapsed||!selection.rangeCount||!output.current)return false;
      return selection.getRangeAt(0).intersectsNode(output.current);
    };
    const syncSelection=()=>{
      if(pointerSelecting.current)return;
      if(selectionInOutput()){selectionWindow.current??=currentRange.current;setHeldHistory(old=>old??currentHistory.current);setAutoScroll(false)}
      else {selectionWindow.current=null;setHeldHistory(null)}
    };
    const releasePointer=()=>{pointerSelecting.current=false;syncSelection()};
    document.addEventListener('selectionchange',syncSelection);
    document.addEventListener('pointerup',releasePointer);
    document.addEventListener('pointercancel',releasePointer);
    return()=>{document.removeEventListener('selectionchange',syncSelection);document.removeEventListener('pointerup',releasePointer);document.removeEventListener('pointercancel',releasePointer)};
  },[]);
  function saveLog(){
    setToolsOpen(false);
    const url=URL.createObjectURL(new Blob([plainLog()],{type:'text/plain'}));
    const anchor=document.createElement('a');anchor.href=url;anchor.download=`${server.name}-console.log`;
    document.body.appendChild(anchor);anchor.click();anchor.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function recall(direction:number){
    if(!history.length)return;
    if(historyIndex.current===-1)draft.current=command;
    historyIndex.current=Math.max(-1,Math.min(history.length-1,historyIndex.current+direction));
    setCommand(historyIndex.current===-1?draft.current:history[historyIndex.current]);
  }
  return <>
    <Notice action={action}/>
    <div className="console-terminal">
      <div className="console-terminal-header">
        <span className="console-terminal-title"><Icon name="console"/>Console</span>
        <div className="console-log-tools" role="toolbar" aria-label="Console tools">
          <span className={`console-connection connection-${connection.toLowerCase()}`} role="status"><span/>{connection}</span>
          {!autoScroll&&<span className="console-paused">{heldHistory?'Selection held':'Auto-scroll paused'}</span>}
          <IconButton type="button" className="console-icon-button" aria-label={autoScroll?'Pause auto-scroll':'Resume auto-scroll'} title={autoScroll?'Pause auto-scroll':'Resume auto-scroll'} aria-pressed={!autoScroll} onClick={()=>{if(!autoScroll){window.getSelection()?.removeAllRanges();setHeldHistory(null)}setAutoScroll(v=>!v)}}><Icon name={autoScroll?'pause':'play'}/></IconButton>
          <IconButton type="button" className="console-icon-button" aria-label="Copy console output" title="Copy console output" disabled={!displayed.count||working} onClick={()=>void action.run(async()=>{
            if(!navigator.clipboard)throw new Error('Clipboard access is unavailable. Use Save console log to keep a copy.');
            await navigator.clipboard.writeText(plainLog());
          },()=>action.setSuccess('Console output copied.'))}><Icon name="copy"/></IconButton>
          <IconButton type="button" className="console-icon-button" aria-label="Clear console display" title="Clear display" disabled={!displayed.count} onClick={()=>{setHeldHistory(null);onClear()}}><Icon name="trash"/></IconButton>
          <DropdownMenu open={toolsOpen} onOpenChange={setToolsOpen} modal={false}>
            <DropdownMenuTrigger render={<IconButton className="console-icon-button" aria-label="More console tools" title="More console tools"/>}><Icon name="more"/></DropdownMenuTrigger>
            <DropdownMenuContent className="console-dropdown" align="end">
              <p className="console-history-budget">{logHistory.count.toLocaleString()} / {CONSOLE_HISTORY_LINES.toLocaleString()} lines | up to {CONSOLE_HISTORY_CHARACTERS*2/1024**2} MiB</p>
              <DropdownMenuItem disabled={!displayed.count} onClick={saveLog}><Icon name="download"/>Save console log</DropdownMenuItem>
              {can(permissions,'control.stop')&&<DropdownMenuItem className="console-force-stop" disabled={working||!['running','starting','stopping'].includes(status)} onClick={async ()=>{
                if(await confirmAction({title:"Force stop?",description:'Immediately kill the server process? Unsaved data may be lost.',confirmLabel:"Force stop",danger:true}))void action.run(()=>requestServerPower(base,'kill'),()=>action.setSuccess('Force stop requested.'));
              }}><Icon name="stop"/>Force stop</DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div className="console-terminal-body">
        <pre ref={output} className="console-output" aria-label="Server console output" tabIndex={0} onPointerDown={event=>{if(event.button===0){selectionWindow.current=currentRange.current;pointerSelecting.current=true;setHeldHistory(old=>old??logHistory);setAutoScroll(false)}}} onScroll={()=>{measureViewport();const element=output.current;if(element&&!pointerSelecting.current&&!heldHistory)setAutoScroll(element.scrollHeight-element.scrollTop-element.clientHeight<32)}}>{displayed.count?<><span className="console-spacer" aria-hidden="true" style={{height:range.start*viewport.lineHeight}}/>{visibleChunks.map(chunk=><HistoryChunk key={chunk.id} chunk={chunk}/>)}<span className="console-spacer" aria-hidden="true" style={{height:(displayed.count-range.end)*viewport.lineHeight}}/></>:'Waiting for console output…'}</pre>
      </div>
      {server.console_input_supported===false?<div className="console-readonly">This launcher provides logs only. Use Game Config and the power controls to manage the server.</div>:can(permissions,'control.console')?<form className="console-command-bar" onSubmit={event=>{
        event.preventDefault();
        if(!command.trim()||working||!running)return;
        const sent=command;
        onSend(sent,()=>{setHistory(old=>[sent,...old.filter(c=>c!==sent)].slice(0,50));setCommand('');historyIndex.current=-1;draft.current='';setHistoryOpen(false)});
      }}>
        <span className="console-prompt" aria-hidden="true">»</span>
        <input ref={input} type="text" className="console-command-input" aria-label="Console command" placeholder={running?'Type a command…':'Start the server to send commands…'} autoComplete="off" autoCapitalize="off" spellCheck={false} value={command} disabled={working} onChange={event=>{setCommand(event.target.value);historyIndex.current=-1}} onKeyDown={event=>{
          if(event.key==='ArrowUp'||event.key==='ArrowDown'){event.preventDefault();recall(event.key==='ArrowUp'?1:-1)}
        }}/>
        <IconButton type="submit" className="console-icon-button console-send" aria-label="Send command" title="Send command · Enter" disabled={working||!running||!command.trim()}><Icon name="send"/></IconButton>
        <DropdownMenu open={historyOpen} onOpenChange={setHistoryOpen} modal={false}>
          <DropdownMenuTrigger disabled={!history.length} render={<IconButton className="console-icon-button" aria-label="Command history" title={history.length?'Command history | Up / Down':'No commands sent in this session'}/> }><Icon name="clock"/></DropdownMenuTrigger>
          <DropdownMenuContent className="console-dropdown console-dropdown-history" align="end" side="top" finalFocus={input} aria-label="Recent commands">
            {history.map((entry,index)=><DropdownMenuItem key={index} onClick={()=>{setCommand(entry);historyIndex.current=index;setHistoryOpen(false)}}><Icon name="console"/><code>{entry}</code></DropdownMenuItem>)}
          </DropdownMenuContent>
        </DropdownMenu>
      </form>:<div className="console-readonly">Read-only console access</div>}
    </div>
  </>;
}
