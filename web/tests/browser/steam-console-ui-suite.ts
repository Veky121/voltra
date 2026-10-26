// Run on theme-ui.html?view=/server/fixture&captureDisconnected=1.
export async function runSteamConsoleSuite() {
  const fixture=(window as any).consoleFixture;
  const output=()=>document.querySelector('.console-output')?.textContent??'';
  const wait=async(test:()=>boolean)=>{for(let i=0;i<80;i++){if(test())return;await new Promise(resolve=>setTimeout(resolve,75));}throw Error('Steam console fixture timeout');};
  const assert=(value:boolean,message:string)=>{if(!value)throw Error(message);};
  await wait(()=>output().includes('Fixture live log from Wings'));
  const original=window.fetch;
  const entries=[{id:'2',event:'steam output',line:'\x1b[96m[Steam]: \x1b[94mUpdate state downloading, progress: 42.00\x1b[0m',created_at:'2026-10-25T10:00:01Z'},{id:'3',event:'steam output',line:'\x1b[96m[Steam]: \x1b[92mSuccess! App fully installed.\x1b[0m',created_at:'2026-10-25T10:00:02Z'}];
  window.fetch=async(input,init)=>{
    const url=new URL(typeof input==='string'?input:input instanceof Request?input.url:String(input),location.href);
    if(url.pathname.endsWith('/console-history'))return new Response(JSON.stringify({data:entries.filter(entry=>Number(entry.id)>Number(url.searchParams.get('after')??0)),cursor:'3',capture:{connected:false},more:false,limits:{lines:5000}}),{headers:{'Content-Type':'application/json'}});
    return original(input,init);
  };
  try {
    await wait(()=>output().includes('Success! App fully installed.'));
    assert(output().includes('progress: 42.00'),'Streamed download progress missing during live fallback');
    assert(output().includes('Fixture live log from Wings'),'Game console output was replaced');
    assert(!!document.querySelector('.console-output [style*="color"]'),'Steam ANSI colors missing');
    await new Promise(resolve=>setTimeout(resolve,1200));
    assert(output().split('Success! App fully installed.').length===2,'Repeated history polling duplicated Steam output');
    assert(!(window as any).uiErrors.length,'Uncaught console error');
    return '5 Steam console fallback/color/deduplication checks passed';
  } finally {window.fetch=original;}
}
