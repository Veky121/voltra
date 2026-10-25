// Public-only deterministic helper/probe packaging. No native execution or acquisition.
import fs from'node:fs';import{resolve,join}from'node:path';import{spawnSync}from'node:child_process';import{createHash}from'node:crypto';
const assets=resolve('internal/palworldloader/assets'),probe=resolve('tools/runtime/palworld-runtime-probe');const sha=data=>createHash('sha256').update(data).digest('hex');
const run=(args,extra={})=>{let r=spawnSync('go',args,{windowsHide:true,encoding:'utf8',maxBuffer:1024*1024,...extra});if(r.status)throw Error('Public runtime probe build failed '+r.stderr);return r.stdout.trim()};
const pairs=[['palworld-loader-install.py','internal/panel/game_library/scripts/palworld-loader-install.py'],['palworld-loader-pins.json','internal/panel/game_library/scripts/palworld-loader-pins.json'],['steam_template.py','internal/panel/game_library/scripts/steam-template.py']];
if(process.argv.includes('--verify')){
 const m=JSON.parse(fs.readFileSync(join(assets,'bundle.json')));for(const[name,path]of pairs)if(!fs.readFileSync(join(assets,name)).equals(fs.readFileSync(path)))throw Error('Canonical loader source drift');for(const[name,digest]of Object.entries(m.files))if(sha(fs.readFileSync(join(assets,name)))!==digest)throw Error('Public bundle mismatch');console.log('Public Palworld helper/probe bundle hashes and canonical sources verified');process.exit(0);
}
fs.mkdirSync(assets,{recursive:true});for(const[name,path]of pairs)fs.copyFileSync(path,join(assets,name));
const target=join(assets,'runtime-probe.exe'),previous=fs.existsSync(target)?sha(fs.readFileSync(target)):null;
run(['build','-trimpath','-buildvcs=false','-ldflags','-s -w -buildid=','-o',target,'.'],{cwd:probe,env:{...process.env,GOOS:'windows',GOARCH:'amd64',GOAMD64:'v1',CGO_ENABLED:'0',GOTOOLCHAIN:'local'}});
if(process.argv.includes('--repro')&&previous!==sha(fs.readFileSync(target)))throw Error('Runtime probe deterministic rebuild differs');
const toolchain={cwd:probe,env:{...process.env,GOTOOLCHAIN:'local'}};const goroot=run(['env','GOROOT'],toolchain);fs.writeFileSync(join(assets,'runtime-probe.LICENSE'),fs.readFileSync(join(probe,'LICENSE'),'utf8')+'\nGo runtime license:\n\n'+fs.readFileSync(join(goroot,'LICENSE'),'utf8'));
const files=Object.fromEntries(fs.readdirSync(assets).filter(n=>n!=='bundle.json').sort().map(name=>[name,sha(fs.readFileSync(join(assets,name)))]));
const record={schema:1,revision:'palworld-ue4ss-2281fa31-v1',files,probe:{target:'windows/amd64',compiler:run(['version'],toolchain),source_files:Object.fromEntries(fs.readdirSync(probe).sort().map(name=>[name,sha(fs.readFileSync(join(probe,name)))])),flags:['-trimpath','-buildvcs=false','-ldflags=-s -w -buildid=']}};
fs.writeFileSync(join(assets,'bundle.json'),JSON.stringify(record,null,2)+'\n');console.log(JSON.stringify({files:Object.keys(files).length,probe_bytes:fs.statSync(target).size,probe_sha256:files['runtime-probe.exe'],deterministic_rebuild:process.argv.includes('--repro')}));
