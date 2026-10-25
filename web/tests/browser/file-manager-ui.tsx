// Local, in-memory browser fixture. No API request reaches a real panel/node.
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {createBrowserRouter,RouterProvider} from 'react-router-dom';
import FileManager from '../../src/client/FileManager';
import {ServerContext} from '../../src/client/common';
import '../../src/styles.css';
import '../../src/theme.css';
import '../../src/design-system.css';
import '../../src/shell-ui.css';
import '../../src/shadcn.css';
import '../../src/shadcn-app.css';
import {runFileManagerSuite} from './file-manager-ui-suite';

const calls:{path:string;method:string}[]=[];
const entry=(name:string,is_file:boolean,size=16)=>({name,is_file,size:is_file?size:0,modified_at:'2026-10-23T06:00:00Z',mimetype:is_file?'text/plain':'',mode_bits:'644'});
const directories:Record<string,ReturnType<typeof entry>[]>={
  '/':[entry('config',false),entry('worlds',false),entry('large',false),entry('server.properties',true),entry('配置 +%?#.txt',true),entry('archive.zip',true)],
  '/config':[entry('settings.json',true)],'/worlds':[],
  '/large':Array.from({length:1205},(_,i)=>entry(`entry${String(i).padStart(4,'0')}.txt`,true)),
};
(window as any).__fileManagerFixture={calls,directories};
window.fetch=async(input,options)=>{
  const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.href);
  const method=options?.method||'GET';calls.push({path:url.pathname+url.search,method});
  if(!url.pathname.startsWith('/api/client/servers/fixture/'))throw new Error('Fixture blocked an unexpected network request.');
  if(url.pathname.endsWith('/files/list')){
    const files=directories[url.searchParams.get('directory')||'/'];
    return Response.json(files?{data:files.map(attributes=>({object:'file_object',attributes}))}:{errors:[{detail:'Fixture directory not found'}]},{status:files?200:404});
  }
  if(url.pathname.endsWith('/files/download-stream')||url.pathname.endsWith('/files/contents')){
    const content=url.searchParams.get('file')==='/server.properties'?Array.from({length:350},(_,i)=>`setting-${i}=Fixture value ${i}`).join('\n'):'server-name=Fixture\nmax-players=8\n';
    return new Response(content,{headers:{'Content-Type':'text/plain','Content-Length':String(new TextEncoder().encode(content).length)}});
  }
  if(url.pathname.endsWith('/files/transfers'))return Response.json({data:[]});
  return Response.json({errors:[{detail:'Mutations are disabled in this fixture.'}]},{status:405});
};
function Fixture(){
  const [permissions,setPermissions]=useState(['*']);
  const [results,setResults]=useState('');
  return <main style={{padding:24}}><div className="actions" style={{marginBottom:20}}><button onClick={()=>setPermissions(['file.read'])}>Use list-only permissions</button><button onClick={()=>setPermissions(['*'])}>Restore permissions</button><button onClick={()=>{setResults('Running');void runFileManagerSuite(setResults).then(setResults).catch(error=>setResults(`FAIL: ${error.message}`))}}>Run interaction suite</button><output>{results}</output></div>
    <ServerContext.Provider value={{base:'/api/client/servers/fixture',permissions,server:{name:'File manager preview'},reload(){}}}><FileManager/></ServerContext.Provider>
  </main>;
}
createRoot(document.getElementById('root')!).render(<RouterProvider router={createBrowserRouter([{path:'*',element:<Fixture/>}])}/>);
