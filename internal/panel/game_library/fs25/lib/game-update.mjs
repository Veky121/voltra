import {realpathSync} from 'node:fs';
// Reinstall and ordinary starts share this base-game compatibility check.
// GIANTS' own launcher performs the update and its normal licence checks.
import {readFileSync,writeFileSync,renameSync,mkdirSync,rmSync,readdirSync,statSync,openSync,closeSync,readSync,copyFileSync,existsSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {latestGameVersion} from './download-game.mjs';
import {pendingDLCs} from './dlc-state.mjs';

const labels={checking:'Checking for game updates',updating:'Updating game files',verifying:'Verifying the game version',dlc:'Updating DLCs',starting:'Starting the server',completed:'Server is ready',failed:'Update needs attention'};
export const versionPattern=/^\d+\.\d+\.\d+\.\d+$/;
export function compareVersions(a,b) {
  if(!versionPattern.test(a)||!versionPattern.test(b))throw Error('VERSION_UNKNOWN');
  return a.split('.').map((v,i)=>Number(v)-Number(b.split('.')[i])).find(v=>v!==0)||0;
}
const stateRoot=env=>resolve(env.FS25_LIB,'..');
const readJSON=(file,fallback=null)=>{try{return JSON.parse(readFileSync(file,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw Error('RECOVERY_REQUIRED');}};
function atomic(file,data) {mkdirSync(dirname(file),{recursive:true,mode:0o700});writeFileSync(file+'.tmp',JSON.stringify(data),{mode:0o600});renameSync(file+'.tmp',file);}
export function installedVersion(env=process.env) {
  try {const version=readFileSync(join(env.GAME_DIR,'VERSION'),'utf8').trim();if(versionPattern.test(version))return version;}catch{}
  // A publisher receipt helps identify an interrupted update. It does not
  // prove the engine exists or runs; prepare and gameplay validation check both.
  const directory=join(env.DOCS_DIR,'updater');
  const versions=[];
  try {for(const name of readdirSync(directory)){
    if(!/^[a-f0-9]{32}$/.test(name))continue;
    try {const xml=readFileSync(join(directory,name,'signature.xml'),'utf8');
      for(const match of xml.matchAll(/buildName="[^"<>]*_patch(\d+)_(\d+)_(\d+)(?:_(\d+))?"/g))versions.push(match.slice(1).map(v=>Number(v||0)).join('.'));
    }catch{}
  }}catch{}
  if(versions.length)return versions.sort((a,b)=>compareVersions(b,a))[0];
  throw Error('VERSION_UNKNOWN');
}
export function setStatus(env,patch) {
  const file=join(stateRoot(env),'update-status.json');
  const state={...readJSON(file,{}),...patch,updated_at:new Date().toISOString()};
  atomic(file,state);
  if(patch.stage)console.log('[fs25/update] '+(labels[patch.stage]||patch.stage)+'.');
  return state;
}
export function nativeUpdateStage(text) {
  const phases=[['Creating signatures of local files','Comparing installed files'],['Starting download and verify thread','Downloading and verifying patch files'],['Starting the installation routine','Installing patch files'],['Installing crypto archives','Applying game archive changes'],['Cleaning up memory and exit.','Finishing native updater']];
  let last=-1,stage='Checking GIANTS update service';
  for(const [marker,label] of phases){const at=text.lastIndexOf(marker);if(at>last){last=at;stage=label;}}
  return stage;
}
function tailSince(file,offset){
  let fd;
  try {const size=statSync(file).size,start=Math.max(offset,size-65536);if(size<=start)return '';fd=openSync(file,'r');const bytes=Buffer.alloc(size-start);readSync(fd,bytes,0,bytes.length,start);return bytes.toString('utf8');}
  catch{return '';}
  finally{if(fd!==undefined)closeSync(fd);}
}
async function nativeUpdate(env) {
  const root=stateRoot(env),log=join(root,'updater.log');
  const nativeLog=join(env.DOCS_DIR,'updater/updater.00.log');
  if(!existsSync(join(env.GAME_DIR,'x64/FarmingSimulator2025Game.exe'))){
    console.log('[fs25/update] Game executable missing; rebuilding GIANTS file verification cache.');
    rmSync(join(env.GAME_DIR,'updater/signature.dat'),{force:true});
    const cacheRoot=join(env.DOCS_DIR,'updater');
    for(const name of existsSync(cacheRoot)?readdirSync(cacheRoot):[])if(/^[a-f0-9]{32}$/.test(name)){
      rmSync(join(cacheRoot,name,'signature.dat'),{force:true});
      rmSync(join(cacheRoot,name,'signature.xml'),{force:true});
    }
  }
  let nativeOffset=0;try{nativeOffset=statSync(nativeLog).size;}catch{}
  const fd=openSync(log,'w',0o600);
  const windowsPath=path=>{const result=spawnSync('winepath',['-w',path],{env,encoding:'utf8',timeout:15000});if(result.status!==0)throw Error('UPDATER_FAILED');return result.stdout.trim();};
  const gamePath=windowsPath(env.GAME_DIR)+'\\',profilePath=windowsPath(env.DOCS_DIR)+'\\';
  const launcher=join(root,'native-updater','FarmingSimulator2025.exe');mkdirSync(dirname(launcher),{recursive:true,mode:0o700});
  if(existsSync(join(env.GAME_DIR,'FarmingSimulator2025.exe')))copyFileSync(join(env.GAME_DIR,'FarmingSimulator2025.exe'),launcher);
  else if(!existsSync(launcher))throw Error('UPDATER_FAILED');
  const launcherPath=windowsPath(launcher);
  const child=spawn('wine',[launcherPath,'-updateAll','-gamePath',gamePath,'-userProfilePath',profilePath],{cwd:env.GAME_DIR,env,stdio:['ignore',fd,fd],detached:true});
  closeSync(fd);
  const started=Date.now();let timer,deadline;
  const stop=()=>{spawnSync('wineserver',['-k'],{env,stdio:'ignore',timeout:15000});try{process.kill(-child.pid,'SIGKILL');}catch{}};
  try {
    await new Promise((resolve,reject)=>{
      let completed=false;
      const abort=()=>{stop();reject(Error('UPDATE_INTERRUPTED'));};
      process.once('SIGTERM',abort);process.once('SIGINT',abort);
      const detach=()=>{process.off('SIGTERM',abort);process.off('SIGINT',abort);};
      child.once('error',()=>{detach();reject(Error('UPDATER_FAILED'));});
      child.once('exit',code=>{
        if(completed)return;
        if(code!==0&&code!==1){detach();reject(Error('UPDATER_FAILED'));return;}
        // The launcher may hand off to another Wine process before exiting.
        const waiter=spawn('wineserver',['-w'],{env,stdio:'ignore'});
        waiter.once('error',()=>{detach();reject(Error('UPDATER_FAILED'));});
        waiter.once('exit',result=>{detach();result===0?resolve():reject(Error('UPDATER_FAILED'));});
      });
      timer=setInterval(()=>{
        const elapsed_seconds=Math.floor((Date.now()-started)/1000);
        setStatus(env,{elapsed_seconds});
        const nativeText=tailSince(nativeLog,nativeOffset);
        const stage=nativeUpdateStage(nativeText);
        if(nativeText.includes('Update process successfully ended.')||nativeText.includes('Found nothing to update')){
          completed=true;detach();stop();resolve();return;
        }
        console.log(`[fs25/update] ${stage}; ${elapsed_seconds}s elapsed, total progress unknown.`);
      },10000);
      deadline=setTimeout(()=>{detach();stop();reject(Error('UPDATE_TIMEOUT'));},30*60*1000);
    });
  } finally {clearInterval(timer);clearTimeout(deadline);}
}
const safeCodes=new Set(['VERSION_UNKNOWN','RECOVERY_REQUIRED','UPDATE_INTERRUPTED','UPDATER_FAILED','UPDATE_TIMEOUT','VERSION_NOT_UPDATED','GAME_FILES_INCOMPLETE','GAME_UPDATE_REQUIRED','AUTOMATIC_DOWNLOAD_DISABLED']);
export async function prepare(env=process.env,{latest=latestGameVersion,update=nativeUpdate,apply=env.FS25_INSTALL_ONLY==='true'}={}) {
  const root=stateRoot(env),id=randomUUID();
  atomic(join(root,'update-status.json'),{id,state:'running',stage:'checking',code:'UPDATE_CHECKING',started_at:new Date().toISOString(),updated_at:new Date().toISOString(),automatic:!apply});
  let updating=false;
  try {
    const transaction=readJSON(join(root,'update-transaction.json'));
    const interrupted=transaction?.phase==='updating'||transaction?.phase==='restoring';
    if(interrupted&&!apply)throw Error('RECOVERY_REQUIRED');
    let current;try{current=installedVersion(env);}catch(error){if(!apply)throw error;current='0.0.0.0';console.log('[fs25/update] Installed version unavailable; running native repair.');}
    setStatus(env,{installed_version:current,stage:'checking'});
    if(['false','0','off','no'].includes(String(env.AUTO_DOWNLOAD).toLowerCase()))throw Error('AUTOMATIC_DOWNLOAD_DISABLED');
    // Ordinary starts use the last public target. Reinstall checks fresh metadata.
    const cacheFile=join(root,'publisher-version.json');
    const cache=readJSON(cacheFile,{});
    const cached=versionPattern.test(cache.version||'') && Number.isFinite(Date.parse(cache.checked_at));
    let target;
    if (latest!==latestGameVersion) target=await latest(env); // injected test/provider
    else if(cached && (!apply || Date.now()-Date.parse(cache.checked_at)<5*60*1000)) target=cache.version;
    else if(!apply) throw Error('GAME_UPDATE_REQUIRED');
    else {target=await latest(env);atomic(cacheFile,{version:target,checked_at:new Date().toISOString()});}
    setStatus(env,{target_version:target});
    console.log(`[fs25/update] Installed ${current==='0.0.0.0'?'unknown':current}; latest published ${target}.`);
    if(compareVersions(target,current)>0||interrupted||!existsSync(join(env.GAME_DIR,'VERSION'))||!existsSync(join(env.GAME_DIR,'x64/FarmingSimulator2025Game.exe'))) {
      if(!apply)throw Error('GAME_UPDATE_REQUIRED');
      atomic(join(root,'update-transaction.json'),{phase:'updating',installed_version:current,target_version:target});updating=true;
      setStatus(env,{stage:'updating',code:'UPDATE_APPLYING'});await update(env);
      setStatus(env,{stage:'verifying',code:'UPDATE_VERIFYING'});
      if(!existsSync(join(env.GAME_DIR,'VERSION'))||!existsSync(join(env.GAME_DIR,'x64/FarmingSimulator2025Game.exe')))throw Error('GAME_FILES_INCOMPLETE');
      const installed=readFileSync(join(env.GAME_DIR,'VERSION'),'utf8').trim();
      if(compareVersions(installed,target)<0)throw Error('VERSION_NOT_UPDATED');
      const transaction=readJSON(join(root,'update-transaction.json'));
      if(transaction)atomic(join(root,'update-transaction.json'),{...transaction,phase:'base_verified'});
      setStatus(env,{installed_version:installed});
    }
    setStatus(env,{stage:'dlc',code:'UPDATE_DLCS'});
    return true;
  } catch(error) {
    let code=error.downloadCode==='quota'?'PROVIDER_DOWNLOAD_LIMIT':safeCodes.has(error.message)?error.message:'UPDATE_CHECK_FAILED';
    if(updating)console.log('[fs25/update] Update incomplete. Reinstall will retry the native updater; server startup is blocked.');
    setStatus(env,{state:'failed',stage:'failed',code,startup_blocked:updating||code==='RECOVERY_REQUIRED'});
    const recovery={PROVIDER_DOWNLOAD_LIMIT:'GIANTS reports that this licence has exceeded its download limit. Contact GIANTS support before retrying.',GAME_UPDATE_REQUIRED:'Use Reinstall server to update the base game first.',AUTOMATIC_DOWNLOAD_DISABLED:'Enable automatic downloads in Game settings before reinstalling.',RECOVERY_REQUIRED:'The native game update is incomplete. Run Reinstall server to resume repair; the server stays stopped.'};
    console.log('[fs25/update] '+code+'. '+(recovery[code]||'The game update did not complete. Retry Reinstall server; do not assume the installed game was updated.')+' DLC updates skipped.');
    if(updating||code==='RECOVERY_REQUIRED')return 'blocked';
    return false;
  }
}
export function gameplayReady(log,version) {
  const match=/^\s*Game-Version:\s*(\d+\.\d+\.\d+\.\d+)\s*$/m.exec(log);
  return !!match&&compareVersions(match[1],version)>=0&&/^\d{4}-\d\d-\d\d [\d:.]+\s+Info:\s+Entered Gameplay\s*$/m.test(log);
}
async function watch(env) {
  const start=Number(env.FS25_START_TIME_MS)||Date.now(),deadline=Date.now()+10*60*1000;
  while(Date.now()<deadline) {
    await new Promise(resolve=>setTimeout(resolve,2000));
    const status=readJSON(join(stateRoot(env),'update-status.json'),{});
    if(status.state!=='running')return;
    const logs=readdirSync(env.DOCS_DIR).filter(name=>/^log_.*\.txt$/.test(name)).map(name=>join(env.DOCS_DIR,name)).filter(file=>statSync(file).mtimeMs>=start&&statSync(file).size<32*1024*1024).sort();
    if(!logs.length)continue;
    const log=readFileSync(logs.at(-1),'utf8');
    if(!gameplayReady(log,status.installed_version))continue;
    // The existing DLC validator owns marker commits. Do not race its renames.
    const pending=pendingDLCs(env.DLC_DIR).length;
    if(pending&&!status.dlc_failed)continue;
    const warnings=status.dlc_failed||pending>0;
    setStatus(env,{state:'completed',stage:'completed',code:warnings?'UPDATE_DLC_WARNING':'UPDATE_COMPLETE',completed_at:new Date().toISOString()});
    rmSync(join(stateRoot(env),'update-transaction.json'),{force:true});return;
  }
  setStatus(env,{state:'failed',stage:'failed',code:'GAME_NOT_READY'});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(realpathSync(process.argv[1])).href) {
  const command=process.argv[2];
  try {
    if(command==='prepare') {const result=await prepare();process.exitCode=result==='blocked'?2:result?0:1;}
    else if(command==='dlc-failed')setStatus(process.env,{dlc_failed:true});
    else if(command==='starting') {
      const status=readJSON(join(stateRoot(process.env),'update-status.json'),{});
      if(status.state==='running')setStatus(process.env,{stage:'starting',code:'UPDATE_STARTING'});
    } else if(command==='watch')await watch(process.env);
    else throw Error('Unknown operation');
  } catch {console.error('[fs25/update] Update state could not be read safely.');process.exitCode=2;}
}
