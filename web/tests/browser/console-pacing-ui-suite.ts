// Run on theme-ui.html?view=/server/fixture&captureDisconnected=1.
export async function runConsolePacingSuite(){
  const fixture=(window as any).consoleFixture;
  const wait=async(test:()=>boolean)=>{for(let i=0;i<60;i++){if(test())return;await new Promise(r=>setTimeout(r,50))}throw new Error('Console pacing fixture timed out')};
  const delay=(ms:number)=>new Promise(r=>setTimeout(r,ms));
  const assert=(ok:boolean,message:string)=>{if(!ok)throw new Error(message)};
  const output=()=>document.querySelector('.console-output') as HTMLElement;
  const lines=(prefix:string)=>[...output().querySelectorAll('.console-line')].map(x=>x.textContent!.trimEnd()).filter(x=>x.startsWith(prefix));
  const emit=(items:string[])=>fixture.socket.onmessage({data:JSON.stringify({event:'console output',args:[items.join('\n')]})});
  await wait(()=>output()?.textContent?.includes('Fixture live log from Wings')||false);

  const prefix=`paced-${Date.now()}-`,expected=Array.from({length:80},(_,i)=>prefix+i),frames:{count:number;ms:number}[]=[];
  const start=performance.now();
  const observer=new MutationObserver(()=>{const count=lines(prefix).length;if(count&&frames.at(-1)?.count!==count)frames.push({count,ms:Math.round(performance.now()-start)})});
  observer.observe(output(),{childList:true,subtree:true,characterData:true});
  emit(expected);await wait(()=>lines(prefix).length===80);observer.disconnect();
  assert(frames.length>4&&frames[0].count<80,'Burst must appear progressively rather than in a single render');
  assert(JSON.stringify(lines(prefix))===JSON.stringify(expected),'Every line must remain ordered and intact');
  assert(frames.at(-1)!.ms<1500,'Busy output must catch up quickly');

  const cleared=`cleared-${Date.now()}-`;
  emit(Array.from({length:80},(_,i)=>cleared+i));await delay(50);
  (document.querySelector('button[aria-label="Clear console display"]') as HTMLButtonElement).click();
  await delay(400);
  assert(output().querySelectorAll('.console-line').length===0,'Clear must discard queued output as well as displayed history');

  emit(['selection anchor']);await wait(()=>output().textContent?.includes('selection anchor')||false);
  const selection=window.getSelection()!,range=document.createRange();range.selectNodeContents(output().querySelector('.console-line')!);selection.removeAllRanges();selection.addRange(range);
  document.dispatchEvent(new Event('selectionchange'));await delay(50);
  const selected=selection.toString();
  emit(['queued during selection']);await delay(400);
  assert(!output().textContent?.includes('queued during selection')&&selection.toString()===selected,'Selection must hold the visible snapshot while the queue drains');
  selection.removeAllRanges();document.dispatchEvent(new Event('selectionchange'));
  await wait(()=>output().textContent?.includes('queued during selection')||false);
  const resume=document.querySelector('button[aria-label="Resume auto-scroll"]') as HTMLButtonElement|null;resume?.click();
  emit(Array.from({length:200},(_,i)=>`scroll-${i}`));await wait(()=>output().textContent?.includes('scroll-199')||false);await delay(80);
  assert(output().scrollHeight-output().scrollTop-output().clientHeight<4,'Auto-scroll must follow the paced batches');

  emit(Array.from({length:80},(_,i)=>`previous-visit-${i}`));
  (window as any).uiNavigate('/account');await delay(100);(window as any).uiNavigate('/server/fixture');
  await wait(()=>output()?.textContent?.includes('Fixture live log from Wings')||false);await delay(400);
  assert(!output().textContent?.includes('previous-visit-'),'Navigation must cancel queued output from the old console');
  assert(!(window as any).uiErrors.length,'No uncaught browser errors');
  return {result:'8 console pacing interaction checks passed',frames};
}

// Run on the default, healthy-capture fixture without captureDisconnected.
export async function runSavedConsolePacingSuite(){
  const output=()=>document.querySelector('.console-output') as HTMLElement;
  const delay=(ms:number)=>new Promise(r=>setTimeout(r,ms));
  for(let i=0;i<60&&!output()?.textContent?.includes('Starting minecraft');i++)await delay(50);
  if(!output()?.textContent?.includes('Starting minecraft'))throw new Error('Initial saved history did not restore');
  const prefix=`saved-paced-${Date.now()}-`,frames:number[]=[],originalFetch=window.fetch;
  let delivered=false;
  const observer=new MutationObserver(()=>{const count=[...output().querySelectorAll('.console-line')].filter(x=>x.textContent?.startsWith(prefix)).length;if(count&&frames.at(-1)!==count)frames.push(count)});
  observer.observe(output(),{childList:true,subtree:true,characterData:true});
  window.fetch=async(input,init)=>{
    if(new URL(String(input),location.href).pathname.endsWith('/console-history')){
      const rows=delivered?[]:Array.from({length:80},(_,i)=>({id:String(i+4),event:'console output',line:prefix+i,created_at:new Date().toISOString()}));
      delivered=true;
      return Response.json({data:rows,cursor:'83',capture:{connected:true},limits:{lines:5000}});
    }
    return originalFetch(input,init);
  };
  try{
    for(let i=0;i<60&&frames.at(-1)!==80;i++)await delay(50);
    if(frames.length<5||frames[0]>=80||frames.at(-1)!==80)throw new Error('Saved-history polling must feed progressive batches');
    const actual=[...output().querySelectorAll('.console-line')].map(x=>x.textContent!.trimEnd()).filter(x=>x.startsWith(prefix));
    if(JSON.stringify(actual)!==JSON.stringify(Array.from({length:80},(_,i)=>prefix+i)))throw new Error('Saved-history batch order changed');
    return {result:'Saved-history polling streams all 80 lines progressively',frames};
  }finally{
    observer.disconnect();(window as any).uiNavigate('/account');await delay(50);window.fetch=originalFetch;
  }
}
