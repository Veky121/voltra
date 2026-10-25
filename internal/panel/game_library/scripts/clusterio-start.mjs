import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';

export function privateInstanceDefaults(defaults) {
  if(typeof defaults?.visibility?.public!=='boolean')throw Error('Unsupported Clusterio defaults. Reinstall the reviewed release.');
  return {...defaults,visibility:{...defaults.visibility,public:false}};
}

export function configureControllerDefaults(InstanceManager) {
  InstanceManager.DefaultFactorioSettings=privateInstanceDefaults(InstanceManager.DefaultFactorioSettings);
  const original=InstanceManager.prototype.createInstance;
  if(typeof original!=='function')throw Error('Unsupported Clusterio instance creation API.');
  InstanceManager.prototype.createInstance=function(config,...args){
    if(config.get('factorio.version')==='latest')config.set('factorio.version','2.0.77');
    return original.call(this,config,...args);
  };
}

export function roleSettings(env) {
  if(!['controller','host'].includes(env.SERVER_MODE))throw Error('Select controller or host.');
  const port=Number(env.SERVER_PORT);
  if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid allocated port.');
  if(env.SERVER_MODE==='controller'){
    if(typeof env.CLUSTER_NAME!=='string'||!env.CLUSTER_NAME.trim()||Array.from(env.CLUSTER_NAME).length>100)throw Error('A controller requires a Cluster Name of at most 100 characters. Hosts may leave it blank.');
    return {'controller.name':env.CLUSTER_NAME,'controller.http_port':port,'controller.bind_address':'0.0.0.0'};
  }
  let token;
  if(!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(env.CONTROLLER_TOKEN||''))throw Error('A valid host token from the Clusterio controller is required.');
  try {token=JSON.parse(Buffer.from(env.CONTROLLER_TOKEN.split('.')[1],'base64url'));} catch {throw Error('A valid host token from the Clusterio controller is required.');}
  if(token.aud!=='host'||!Number.isSafeInteger(token.host)||token.host<0||token.host>2147483647)throw Error('Use a host token, not an administrator token.');
  let url;
  try {url=new URL(env.CONTROLLER_URL);} catch {throw Error('Enter the controller HTTP or HTTPS address.');}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw Error('Controller address must use HTTP or HTTPS without embedded credentials.');
  const ports=(env.VOLTRA_ALLOCATED_PORTS||env.SERVER_PORT).split(',').map(Number);
  if(!ports.length||ports.some(p=>!Number.isInteger(p)||p<1||p>65535)||!ports.includes(port))throw Error('Invalid allocated game ports.');
  return {'host.id':token.host,'host.name':env.HOST_NAME,'host.controller_url':url.href,'host.controller_token':env.CONTROLLER_TOKEN,'host.public_address':env.SERVER_IP,'host.factorio_directory':'factorio','host.factorio_port_range':[...new Set(ports)].join(',')};
}

export function applySettings(directory,env) {
  const settings=roleSettings(env),file=path.join(directory,`config-${env.SERVER_MODE}.json`);
  let existing;
  try {existing=JSON.parse(fs.readFileSync(file,'utf8'));} catch {throw Error('Cannot read Clusterio configuration JSON. Repair it before starting.');}
  if(Object.entries(settings).every(([key,value])=>JSON.stringify(existing[key])===JSON.stringify(value)))return;
  const temp=file+'.voltra-tmp';
  fs.writeFileSync(temp,JSON.stringify({...existing,...settings},null,2)+'\n',{mode:0o600});
  fs.renameSync(temp,file);
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  try {
    const role=process.env.SERVER_MODE;
    const installed=fs.readFileSync('.voltra/clusterio-mode','utf8').trim();
    if(installed!==role)throw Error('Reinstall after changing the server role. Existing data will be retained.');
    applySettings('.',process.env);
    const script=role==='controller'?'.voltra/clusterio-controller.mjs':`node_modules/@clusterio/${role}/dist/node/${role}.js`;
    // Wings' terminal sends Ctrl-C to its foreground process group. A separate
    // child session prevents it receiving both that and our forwarded signal.
    const child=spawn(process.execPath,[script,'--log-level',process.env.LOG_LEVEL||'info','run'],{stdio:'inherit',detached:true});
    let stopping=false;
    for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{if(!stopping){stopping=true;child.kill(signal);}});
    child.on('error',()=>{console.error('Clusterio could not start. Reinstall to repair the runtime.');process.exitCode=1;});
    child.on('exit',(code,signal)=>{process.exitCode=code??(signal?1:0);});
  }catch(error){console.error(error.message);process.exitCode=1;}
}
