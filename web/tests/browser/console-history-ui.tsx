import React,{act,useState} from 'react';
import {createRoot} from 'react-dom/client';
import Terminal from '../../src/client/Terminal';
import {ServerContext} from '../../src/client/common';
import {appendConsoleHistory,emptyConsoleHistory} from '../../src/client/consoleHistory';
import '../../src/styles.css';
import '../../src/theme.css';
import '../../src/client/console.css';

window.fetch=async()=>{throw Error('Fixture blocks all API requests')};
function Fixture(){
 const [history,setHistory]=useState(()=>appendConsoleHistory(emptyConsoleHistory(),Array.from({length:5000},(_,i)=>`[INFO] line ${String(i).padStart(6,'0')} selection text remains in the document`)));
 (window as any).consoleFixture={
  append:(lines:string[])=>act(()=>setHistory(old=>appendConsoleHistory(old,lines))),
  replace:(count:number)=>act(()=>setHistory(appendConsoleHistory(emptyConsoleHistory(),Array.from({length:count},(_,i)=>`[INFO] line ${String(i).padStart(6,'0')} selection text remains in the document`)))),
  count:history.count,
 };
 return <ServerContext.Provider value={{server:{name:'Fixture'},permissions:['control.console'],base:'/api/fixture',reload:()=>{}}}><div className="console-view" style={{padding:20}}><Terminal history={history} status="running" connection="Connected" busy={false} onClear={()=>setHistory(emptyConsoleHistory())} onSend={(_c,done)=>done()}/></div></ServerContext.Provider>;
}
await act(async()=>{createRoot(document.getElementById('root')!).render(<Fixture/>)});
(window as any).fixtureReady=true;
