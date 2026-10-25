// Run against theme-ui.html?view=/server/fixture&captureDisconnected=1.
export async function runConsoleFallbackSuite(){
 const fixture=(window as any).consoleFixture;
 const text=()=>document.querySelector('.console-output')?.textContent||'';
 const wait=async(test:()=>boolean)=>{for(let i=0;i<60;i++){if(test())return;await new Promise(r=>setTimeout(r,100))}throw new Error('Console fallback fixture timed out')};
 const assert=(ok:boolean,message:string)=>{if(!ok)throw new Error(message)};
 const emit=(line:string)=>fixture.socket.onmessage({data:JSON.stringify({event:'console output',args:[line]})});
 await wait(()=>text().includes('Fixture live log from Wings'));
 assert(text().includes('Saved power request.'),'Saved history must remain visible');
 assert(fixture.logRequests===1,'Disconnected capture must request the Wings tail once');
 fixture.captureConnected=true;fixture.backfill=true;
 emit('Live after capture recovery');emit('Repeated live line');emit('Repeated live line');
 await new Promise(r=>setTimeout(r,1300));
 assert(text().split('Fixture live log from Wings').length-1===1,'Recovery must not duplicate saved copies of live output');
 assert(text().includes('Live after capture recovery'),'Live output must continue after recovery');
 assert(text().split('Repeated live line').length-1===2,'Legitimate repeated output must remain intact');
 fixture.historyFailure=true;
 await wait(()=>document.body.textContent?.includes('Saved history is unavailable.')||false);
 emit('Live while history API is unavailable');
 await wait(()=>text().includes('Live while history API is unavailable'));
 assert(!(window as any).uiErrors.length,'No uncaught browser errors');
 fixture.historyFailure=false;
 return '7 console fallback interaction checks passed';
}
