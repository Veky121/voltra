// Run against file-manager-ui.html only. All file requests use its in-memory fixture.
export async function runFileMetadataSuite(){
  const results:string[]=[];
  const assert=(ok:unknown,message:string)=>{if(!ok)throw new Error(message);results.push(message)};
  const wait=async(predicate:()=>unknown)=>{const end=Date.now()+5000;while(!predicate()){if(Date.now()>end)throw new Error('File metadata UI timed out');await new Promise(resolve=>setTimeout(resolve,30))}};
  const button=(label:string)=>document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  await wait(()=>button('Open /server.properties'));
  const row=()=>button('Open /server.properties').closest('li')!;
  assert(document.querySelector('.explorer-columns')?.textContent==='NameDate modifiedTypeSize','all metadata columns are visible');
  assert(row().querySelector('.explorer-type')?.textContent==='PROPERTIES file','file extension is shown as its type');
  assert(row().querySelector('.explorer-size')?.textContent==='16 B','file size comes from Wings metadata');
  assert(row().querySelector('time')?.dateTime==='2026-10-23T06:00:00.000Z','modification date retains its original instant');
  const headers=[...document.querySelector('.explorer-columns .explorer-metadata')!.children].map(e=>e.getBoundingClientRect().x);
  const cells=[...row().querySelector('.explorer-metadata')!.children].map(e=>e.getBoundingClientRect().x);
  assert(headers.every((x,i)=>Math.abs(x-cells[i])<1),'metadata stays aligned with its column headers');
  const folder=button('Browse /config').closest('.explorer-folder-row')!;
  assert(folder.querySelector('.explorer-type')?.textContent==='Folder'&&folder.querySelector('.explorer-size')?.textContent==='—','directory stat sizes are not shown as folder contents');
  assert(document.querySelector('.fm-storage')?.textContent?.includes('Unavailable'),'missing storage telemetry is not reported as zero');
  button('Expand /config').click();await wait(()=>button('Open /config/settings.json'));
  assert(button('Open /config/settings.json').closest('li')?.querySelector('.explorer-type')?.textContent==='JSON file','nested entries receive the same metadata');
  button('Options for /server.properties').click();await wait(()=>document.querySelector('[role=menu]'));
  assert(!new URLSearchParams(location.search).has('file'),'metadata leaves row menus independent of opening files');
  document.querySelector('[role=menu]')!.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  button('Open /server.properties').click();await wait(()=>document.querySelector('.cm-editor'));
  assert(getComputedStyle(document.querySelector('.explorer-metadata')!).display==='none','editor side pane uses the compact explorer');
  button('Close file').click();await wait(()=>!new URLSearchParams(location.search).has('file')&&getComputedStyle(document.querySelector('.explorer-metadata')!).display==='grid');
  assert(getComputedStyle(document.querySelector('.explorer-metadata')!).display==='grid','closing the editor restores file metadata');
  return `${results.length} file metadata interaction checks passed`;
}
