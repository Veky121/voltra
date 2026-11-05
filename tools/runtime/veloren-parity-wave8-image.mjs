import fs from 'node:fs';
import crypto from 'node:crypto';
import {verifyRuntime,claimNativeUtility} from './campaign-native-20261029.mjs';
const dir='.local/game-parity-20261029/veloren-root-native',file=dir+'/rust-image-state.json';
if(process.argv[2]!=='prepare'||!process.argv.includes('--coordinator-image-prepare-go'))throw Error('Explicit image preparation scope required; pull is not implemented here');
if(fs.existsSync(file))throw Error('Existing image utility receipt requires review; no duplicate claim');
const receipt=await verifyRuntime();
const auth=await fetch('https://auth.docker.io/token?service=registry.docker.io&scope=repository:library/rust:pull');if(!auth.ok)throw Error('Official registry anonymous authorization unavailable');
const token=(await auth.json()).token;if(typeof token!=='string')throw Error('Official registry anonymous token absent');
const headers={Authorization:'Bearer '+token,Accept:'application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json'};
async function manifest(ref){const r=await fetch('https://registry-1.docker.io/v2/library/rust/manifests/'+ref,{headers});if(!r.ok)throw Error('Official manifest request '+r.status);const bytes=Buffer.from(await r.arrayBuffer());if(bytes.length>2*1024**2)throw Error('Manifest bound exceeded');const digest='sha256:'+crypto.createHash('sha256').update(bytes).digest('hex');if(r.headers.get('docker-content-digest')!==digest)throw Error('Official manifest content identity mismatch');return {digest,document:JSON.parse(bytes)};}
const index=await manifest('1.90-slim-bookworm'),platform=index.document.manifests?.find(x=>x.platform.os==='linux'&&x.platform.architecture==='amd64');if(!platform)throw Error('Official tag lacks reviewed linux/amd64 platform');
const image=await manifest(platform.digest);if(image.digest!==platform.digest)throw Error('Selected architecture manifest mismatch');
const layers=image.document.layers.map(x=>({digest:x.digest,compressed_bytes:x.size,media_type:x.mediaType}));if(layers.some(x=>!/^sha256:[a-f0-9]{64}$/.test(x.digest)||!Number.isSafeInteger(x.compressed_bytes)))throw Error('Malformed official layer metadata');
const proof={tag:'docker.io/library/rust:1.90-slim-bookworm',index_digest:index.digest,platform_manifest_digest:image.digest,platform:'linux/amd64',config_digest:image.document.config.digest,layers,total_compressed_bytes:layers.reduce((n,x)=>n+x.compressed_bytes,0),source:'Anonymous public Docker Official Image registry metadata; no token retained',runtime_pid:receipt.pid,at:new Date().toISOString(),pull_boundary:'Metadata only. Docker daemon pull is not cgroup-bounded; later rustc probe must use network-none1GiB/zero-swap/1CPU. No game installer before image proof.'};
fs.writeFileSync(dir+'/rust-official-manifest.json',JSON.stringify(proof,null,2)+'\n');
const lease=claimNativeUtility({task:'veloren_rust_image',owner:'veloren_wave8_image',memory_mib:1024,disk_mib:8192,ports:0});
fs.writeFileSync(file,JSON.stringify({lease,proof,latest_runtime:receipt,admission:'Prepare/claim only; no pull until coordinator acquisition GO'},null,2)+'\n');
console.log(JSON.stringify({lease_id:lease.lease_id,platform:proof.platform,digest:proof.platform_manifest_digest,layers:layers.length,compressed_bytes:proof.total_compressed_bytes,pull:false}));
