// Explicitly built acceptance entry; it is not included in normal production builds.
import {useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {createBrowserRouter,RouterProvider} from 'react-router-dom';
import App from '../src/App';
import FileTransfers,{type FileTransfersHandle} from '../src/client/FileTransfers';
import '../src/styles.css';
import '../src/theme.css';
function Acceptance(){
  const queue=useRef<FileTransfersHandle>(null),[saved,setSaved]=useState(0),[directory,setDirectory]=useState('/ui-transfers');
  const server=new URLSearchParams(location.search).get('server');
  if(!server)return <p>Pass the dedicated acceptance server UUID in the server query.</p>;
  return <main style={{maxWidth:1050,margin:'40px auto',padding:24}}><h1>Transfer browser acceptance</h1><p>This test uses generated disposable bytes and the production FileTransfers component.</p><button type="button" onClick={()=>{
    const block=new Uint8Array(8*1024*1024);for(let i=0;i<block.length;i++)block[i]=i%251;
    const file=new File(Array.from({length:32},()=>block),'browser-generated-256MiB.bin',{type:'application/octet-stream',lastModified:1792663200000});
    void queue.current?.addFiles([file]);
  }}>Queue generated 256 MiB file</button><button type="button" onClick={()=>setDirectory('/a-different-folder')}>Change folder while queued</button><p role="status">Files saved to Wings: {saved}</p><FileTransfers ref={queue} base={`/api/client/servers/${encodeURIComponent(server)}`} directory={directory} permissions={['*']} onComplete={()=>setSaved(n=>n+1)}/></main>;
}
const params=new URLSearchParams(location.search);
if(params.get('mode')==='manager'&&params.get('server')){
  history.replaceState(null,'',`/server/${encodeURIComponent(params.get('server')!)}/files`);
  const router=createBrowserRouter([{path:'*',element:<><App/><button style={{position:'fixed',right:20,bottom:20,zIndex:10000}} type="button" onClick={()=>{
    const host=document.querySelector('.fm-browser');if(!host)return;
    const data=new DataTransfer();data.items.add(new File(['generated navigation guard test\n'],'browser-guard.txt',{type:'text/plain',lastModified:1792663200000}));
    host.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data}));
  }}>Drop generated test file</button></>}]);
  createRoot(document.getElementById('root')!).render(<RouterProvider router={router}/>);
}else createRoot(document.getElementById('root')!).render(<Acceptance/>);
