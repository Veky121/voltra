import {useEffect,useMemo,useRef,useState} from 'react';
import {api} from '../lib';
import {Icon} from '../Icons';
import {can,json,Notice,useAction,useServer} from './common';
import {formatConsoleLines} from './consoleFormatting';
import {stripConsoleControls} from './consoleOutput';

export default function Terminal({lines,status,connection,busy,onClear,onSend}:{lines:string[];status:string;connection:string;busy:boolean;onClear:()=>void;onSend:(command:string,done:()=>void)=>void}){
  const {server,base,permissions}=useServer();
  const action=useAction();
  const [command,setCommand]=useState(''),[autoScroll,setAutoScroll]=useState(true),[history,setHistory]=useState<string[]>([]);
  const output=useRef<HTMLPreElement>(null),input=useRef<HTMLInputElement>(null),historyMenu=useRef<HTMLDetailsElement>(null),toolsMenu=useRef<HTMLDetailsElement>(null);
  const historyIndex=useRef(-1),draft=useRef('');
  const working=busy||action.busy,running=status==='running';
  const formatted=useMemo(()=>formatConsoleLines(lines),[lines]);
  const plainLog=()=>stripConsoleControls(lines.join('\n'));
  useEffect(()=>{if(autoScroll&&output.current)output.current.scrollTop=output.current.scrollHeight},[lines,autoScroll]);
  useEffect(()=>{
    const closeOutside=(event:PointerEvent)=>{for(const ref of [historyMenu,toolsMenu])if(ref.current&&!ref.current.contains(event.target as Node))ref.current.open=false};
    document.addEventListener('pointerdown',closeOutside);
    return()=>document.removeEventListener('pointerdown',closeOutside);
  },[]);
  function saveLog(){
    if(toolsMenu.current)toolsMenu.current.open=false;
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
      <div className="console-terminal-body">
        <div className="console-log-tools" role="toolbar" aria-label="Console tools">
          <span className={`console-connection connection-${connection.toLowerCase()}`} role="status"><span/>{connection}</span>
          {!autoScroll&&<span className="console-paused">Auto-scroll paused</span>}
          <button type="button" className="console-icon-button" aria-label={autoScroll?'Pause auto-scroll':'Resume auto-scroll'} title={autoScroll?'Pause auto-scroll':'Resume auto-scroll'} aria-pressed={!autoScroll} onClick={()=>setAutoScroll(v=>!v)}><Icon name={autoScroll?'pause':'play'}/></button>
          <button type="button" className="console-icon-button" aria-label="Copy console output" title="Copy console output" disabled={!lines.length||working} onClick={()=>void action.run(async()=>{
            if(!navigator.clipboard)throw new Error('Clipboard access is unavailable. Use Save console log to keep a copy.');
            await navigator.clipboard.writeText(plainLog());
          },()=>action.setSuccess('Console output copied.'))}><Icon name="copy"/></button>
          <button type="button" className="console-icon-button" aria-label="Clear console display" title="Clear display" disabled={!lines.length} onClick={onClear}><Icon name="trash"/></button>
          <details ref={toolsMenu} className="console-options" onKeyDown={event=>{
            if(event.key==='Escape'&&toolsMenu.current?.open){event.preventDefault();toolsMenu.current.open=false;toolsMenu.current.querySelector('summary')?.focus()}
          }}>
            <summary className="console-icon-button" aria-label="More console tools" title="More console tools"><Icon name="more"/></summary>
            <div className="console-tools-menu">
              <button type="button" disabled={!lines.length} onClick={saveLog}><Icon name="download"/>Save console log</button>
              {can(permissions,'control.stop')&&<button type="button" className="console-force-stop" disabled={working||!['running','starting','stopping'].includes(status)} onClick={()=>{
                if(toolsMenu.current)toolsMenu.current.open=false;
                if(confirm('Immediately kill the server process? Unsaved data may be lost.'))void action.run(()=>api(`${base}/power`,json('POST',{signal:'kill'})),()=>action.setSuccess('Force stop requested.'));
              }}><Icon name="stop"/>Force stop</button>}
            </div>
          </details>
        </div>
        <pre ref={output} className="console-output" aria-label="Server console output" tabIndex={0}>{lines.length?formatted.map((line,index)=><span key={index} className={`console-line console-level-${line.level}`}>{line.segments.map((segment,i)=><span key={i} style={segment.style}>{segment.text}</span>)}{index<lines.length-1?'\n':null}</span>):'Waiting for console output…'}</pre>
      </div>
      {can(permissions,'control.console')?<form className="console-command-bar" onSubmit={event=>{
        event.preventDefault();
        if(!command.trim()||working||!running)return;
        const sent=command;
        onSend(sent,()=>{setHistory(old=>[sent,...old.filter(c=>c!==sent)].slice(0,50));setCommand('');historyIndex.current=-1;draft.current='';if(historyMenu.current)historyMenu.current.open=false});
      }}>
        <span className="console-prompt" aria-hidden="true">»</span>
        <input ref={input} aria-label="Console command" placeholder={running?'Type a command…':'Start the server to send commands…'} autoComplete="off" autoCapitalize="off" spellCheck={false} value={command} disabled={working} onChange={event=>{setCommand(event.target.value);historyIndex.current=-1}} onKeyDown={event=>{
          if(event.key==='ArrowUp'||event.key==='ArrowDown'){event.preventDefault();recall(event.key==='ArrowUp'?1:-1)}
        }}/>
        <button type="submit" className="console-icon-button console-send" aria-label="Send command" title="Send command · Enter" disabled={working||!running||!command.trim()}><Icon name="send"/></button>
        <details ref={historyMenu} className="console-history" onKeyDown={event=>{if(event.key==='Escape'&&historyMenu.current?.open){event.preventDefault();historyMenu.current.open=false;input.current?.focus()}}}>
          <summary className="console-icon-button" aria-label="Command history" aria-disabled={!history.length} title={history.length?'Command history · ↑ / ↓':'No commands sent in this session'} tabIndex={history.length?0:-1} onClick={event=>{if(!history.length)event.preventDefault()}}><Icon name="clock"/></summary>
          <div className="console-history-list" aria-label="Recent commands"><p>Recent commands</p>{history.map((entry,index)=><button type="button" key={index} title={entry} onClick={()=>{setCommand(entry);historyIndex.current=index;if(historyMenu.current)historyMenu.current.open=false;input.current?.focus()}}><Icon name="console"/><code>{entry}</code></button>)}</div>
        </details>
      </form>:<div className="console-readonly">Read-only console access</div>}
    </div>
  </>;
}
