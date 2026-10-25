import React from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {MinecraftContent} from '../../src/client/MinecraftContent';
import '../../src/styles.css';
import '../../src/theme.css';

// Browser-only API contract fixtures. No request can reach a live server.
const state={files:[{file:'existing-mod.jar',size:204800}],readOnly:false,missingKey:false};
const calls:{method:string;path:string;body:any}[]=[];
Object.assign(window,{__contentFixture:state,__contentCalls:calls});
window.fetch=async(input,init)=>{
 const path=String(input),url=new URL(path,location.origin),method=init?.method||'GET',body=init?.body?JSON.parse(String(init.body)):null;
 calls.push({method,path,body});
 const provider=url.searchParams.get('provider')||'curseforge';
 let data:any;
 if(url.pathname.endsWith('/versions')) data={versions:[{id:'release-1',name:'Compatible release',filename:'fixture-mod.jar',size:4096}],server_compatibility_unknown:url.pathname.includes('/curseforge/'),provider_message:'Server compatibility is unverified.'};
 else if(url.pathname.endsWith('/install')&&method==='POST'){state.files.push({file:'fixture-mod.jar',size:4096});data={files:['fixture-mod.jar']};}
 else if(url.pathname.endsWith('/file')&&method==='DELETE'){state.files=state.files.filter(file=>file.file!==body.file);return new Response(null,{status:204});}
 else if(url.pathname.endsWith('/minecraft/content')){
  const unknown=provider==='curseforge',unverified=url.searchParams.get('include_unverified')==='true';
  data={supported:true,reason:'',provider,minecraft_version:'26.3',loader:'fabric',loader_version:'0.20.1',content_type:'mod',installed:state.files,can_install:!state.readOnly,can_remove:!state.readOnly,provider_available:!(unknown&&state.missingKey),provider_message:unknown&&state.missingKey?'Ask an administrator to save an enabled global CurseForge API key in Integrations.':unknown?'CurseForge does not report server compatibility.':'',compatibility:url.searchParams.get('compatibility')||'server',include_unverified:unverified,server_compatibility_unknown:unknown,projects:unknown&&!unverified?[]:[{id:'project-1',name:'Fixture mod',summary:'A small fixture project. This deliberately long description stays inside a compact card instead of pushing the useful actions down the page.',author:'Fixture author',icon_url:'',compatibility:unknown?'unknown':'server_only',project_url:'https://example.invalid/fixture'}]};
 }else throw new Error(`Unexpected fixture request: ${method} ${path}`);
 return new Response(JSON.stringify({object:'fixture',attributes:data}),{status:200,headers:{'Content-Type':'application/json'}});
};
createRoot(document.getElementById('root')!).render(<MemoryRouter><main style={{padding:'24px',maxWidth:'1440px',margin:'0 auto'}}><MinecraftContent server="fixture"/></main></MemoryRouter>);
