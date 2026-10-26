import {test} from 'node:test';
import assert from 'node:assert/strict';
import {getServerSoftwareArtwork} from '../src/client/serverSoftwareArtwork.ts';

const server=(loader,extra={})=>({game:'minecraft',relationships:{variables:{data:[{attributes:{env_variable:'MINECRAFT_LOADER',server_value:loader}}]}},...extra});

test('declared loader wins over display names and stale launch commands',()=>{
  const artwork=getServerSoftwareArtwork(server('fabric',{name:'Paper friends',invocation:'java -jar forge.jar'}));
  assert.deepEqual(artwork,{id:'fabric',name:'Fabric',src:'/game-icons/fabric-official.png'});
  assert.equal(getServerSoftwareArtwork(server('neoforge')).id,'neoforge');
  assert.equal(getServerSoftwareArtwork(server(' Paper ')).id,'paper');
});

test('unknown loaders and software without bundled artwork have no patch',()=>{
  assert.equal(getServerSoftwareArtwork(server('unknown',{invocation:'java -jar fabric.jar'})),undefined);
  assert.equal(getServerSoftwareArtwork(server('purpur')),undefined);
  assert.equal(getServerSoftwareArtwork(server('fabric',{game:'palworld'})),undefined);
  assert.equal(getServerSoftwareArtwork({game:'minecraft',name:'Fabric friends'}),undefined);
  assert.equal(getServerSoftwareArtwork({game:'minecraft'}),undefined);
});

test('older responses can use egg or runtime identity without reading unrelated values',()=>{
  assert.equal(getServerSoftwareArtwork({game:'minecraft',invocation:'java -jar fabric-server-launch.jar'}).id,'fabric');
  assert.equal(getServerSoftwareArtwork({egg_name:'NeoForge Minecraft'}).id,'neoforge');
  const secret={env_variable:'PRIVATE_TOKEN',get server_value(){throw Error('Unrelated value read');}};
  assert.equal(getServerSoftwareArtwork({game:'minecraft',relationships:{variables:{data:[{attributes:secret}]}}}),undefined);
});
