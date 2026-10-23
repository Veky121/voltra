// Reproducible isolated OSS client build; never changes host PATH or runtime images.
import fs from 'node:fs';import{resolve,join,relative}from'node:path';import{spawnSync}from'node:child_process';import{createHash}from'node:crypto';
const root=resolve('tools/runtime/managed-console'),assets=resolve('internal/panel/managed_console_assets');
const sha=data=>createHash('sha256').update(data).digest('hex');
const buildScriptSHA=sha(fs.readFileSync(new URL(import.meta.url)));
const previous=process.argv.includes('--repro')?JSON.parse(fs.readFileSync(join(assets,'manifest.json'))):null;
const run=(args,extra={})=>{const r=spawnSync('go',args,{cwd:root,windowsHide:true,encoding:'utf8',maxBuffer:16*1024*1024,...extra});if(r.status!==0)throw Error('Isolated client Go command failed: '+r.stderr);return r.stdout.trim();};
function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en')).flatMap(e=>e.isDirectory()?files(join(dir,e.name)):[join(dir,e.name)]);}
const source=()=>files(root).map(path=>({path:relative(root,path).replaceAll('\\','/'),sha256:sha(fs.readFileSync(path))}));
if(process.argv.includes('--verify')){
 const m=JSON.parse(fs.readFileSync(join(assets,'manifest.json')));if(m.version!=='0.10.3-voltra-auth1'||m.build_script_sha256!==buildScriptSHA||m.source_tree_sha256!==sha(JSON.stringify(source())))throw Error('Pinned client source manifest mismatch');
 for(const a of m.artifacts){let b=fs.readFileSync(join(assets,a.file));if(b.length!==a.bytes||sha(b)!==a.sha256||b.readUInt16LE(18)!==({amd64:62,arm64:183})[a.architecture]||b.subarray(0,4).toString('hex')!=='7f454c46')throw Error('Client ELF artifact mismatch');}
 for(const a of m.licenses)if(sha(fs.readFileSync(join(assets,a.file)))!==a.sha256)throw Error('Client license mismatch');
 console.log('Verified pinned source, both architecture binaries, checksums, ELF machines and licenses');process.exit(0);
}
fs.mkdirSync(assets,{recursive:true});run(['mod','download']);run(['mod','verify']);
const compiler=run(['version']);
const modules=run(['list','-mod=readonly','-m','-f','{{.Path}}|{{.Version}}|{{.Dir}}|{{.Sum}}','all']).split(/\r?\n/).filter(Boolean).map(line=>{const[path,version,dir,sum]=line.split('|');return{path,version,dir,sum};});
const licenses=[];
for(const m of modules){
 if(!m.dir)continue;let names=fs.readdirSync(m.dir).filter(name=>/^licen[sc]e(?:[.\-_]|$)|^copying(?:[.\-_]|$)/i.test(name));
 if(!names.length)throw Error('Pinned dependency license missing: '+m.path);
 for(const name of names){if(!fs.statSync(join(m.dir,name)).isFile())continue;const file='licenses/'+m.path.replaceAll('/','_').replaceAll('!','')+'-'+name;fs.mkdirSync(join(assets,'licenses'),{recursive:true});const b=fs.readFileSync(join(m.dir,name));fs.writeFileSync(join(assets,file),b);licenses.push({module:m.path,version:m.version,file,sha256:sha(b)});}
}
const artifacts=[];
for(const architecture of ['amd64','arm64']){
 const file='console-linux-'+architecture;const env={...process.env,GOOS:'linux',GOARCH:architecture,CGO_ENABLED:'0',GOTOOLCHAIN:'local'};if(architecture==='amd64')env.GOAMD64='v1';else env.GOARM64='v8.0';
 run(['build','-mod=readonly','-trimpath','-buildvcs=false','-ldflags','-s -w -buildid= -X main.Version=0.10.3-voltra-auth1','-o',join(assets,file),'./cmd/gorcon'],{env});
 const b=fs.readFileSync(join(assets,file));artifacts.push({architecture,os:'linux',file,bytes:b.length,sha256:sha(b)});
}
const sources=source();const manifest={schema_version:1,version:'0.10.3-voltra-auth1',compiler,build_script_sha256:buildScriptSHA,build_flags:['-mod=readonly','-trimpath','-buildvcs=false','-ldflags=-s -w -buildid= -X main.Version=0.10.3-voltra-auth1'],build_environment:{GOOS:'linux',CGO_ENABLED:'0',GOAMD64:'v1',GOARM64:'v8.0',GOTOOLCHAIN:'local'},source_tree_sha256:sha(JSON.stringify(sources)),sources,upstreams:JSON.parse(fs.readFileSync(join(root,'upstream.json'))).upstreams.map(({repository,tag,commit})=>({repository,tag,commit})),modules:modules.map(({path,version,sum})=>({path,version,sum})),artifacts,licenses};
if(previous&&JSON.stringify(previous.artifacts)!==JSON.stringify(artifacts))throw Error('Deterministic rebuild differs from previously reviewed artifacts');
fs.writeFileSync(join(assets,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify({compiler,artifacts,source_tree_sha256:manifest.source_tree_sha256,deterministic_rebuild:!!previous}));
