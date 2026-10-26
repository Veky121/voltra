import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {getServerArtwork,getServerIconSources} from '../src/client/serverArtwork.ts';
import catalog from '../src/client/serverArtworkCatalog.json' with {type: 'json'};

test('explicit workload survives custom or misleading server names', () => {
  assert.equal(getServerArtwork({game:'minecraft',name:'Production'}).id,'minecraft');
  assert.equal(getServerArtwork({artwork:{game:'minecraft'},name:'Custom template name'}).id,'minecraft');
  assert.equal(getServerArtwork({game:'palworld',name:'Minecraft friends'}).id,'palworld');
  assert.equal(getServerArtwork({egg_name:'Counter-Strike: Source',name:'Production'}).id,'counter-strike-source');
});

test('verified modpack artwork replaces generic banners without trusting arbitrary URLs',()=>{
 const path='/api/client/servers/pack-uuid/artwork/pack';
 const art=getServerArtwork({name:'The NjimGang Hunters',artwork:{game:'minecraft',pack_name:'Vault Hunters Third Edition',pack_icon:path}});
 assert.equal(art.src,path);
 assert.equal(art.name,'Vault Hunters Third Edition');
 assert.equal(art.kind,'modpack');
 assert.equal(getServerArtwork({game:'palworld',artwork:{game:'minecraft',pack_icon:path}}).id,'palworld');
 assert.equal(getServerArtwork({artwork:{game:'minecraft',pack_icon:'https://untrusted.example/image.png'}}).id,'minecraft');
});

test('specific game variants and legacy game names get their own artwork', () => {
  assert.equal(getServerArtwork({name:'Source css batch acceptance'}).id,'counter-strike-source');
  assert.equal(getServerArtwork({name:'Quake batch urbanterror'}).id,'urbanterror');
  assert.equal(getServerArtwork({name:'Minetest upstream egg verification'}).id,'luanti');
  assert.equal(getServerArtwork({name:'Arma Reforger server'}).id,'arma-reforger');
  assert.equal(getServerArtwork({name:'GoldSrc cs16 native acceptance'}).id,'counter-strike-16');
  assert.equal(getServerArtwork({name:'Source hl2dm batch acceptance'}).id,'half-life-2-deathmatch');
  assert.equal(getServerArtwork({name:'StarMade server'}).id,'starmade');
});

test('renamed game servers can be identified by their runtime or public app ID', () => {
  assert.equal(getServerArtwork({name:'Friends',invocation:'./CoreKeeperServer -batchmode'}).id,'core-keeper');
  assert.equal(getServerArtwork({name:'Factory',invocation:'./FactoryServer.sh'}).id,'satisfactory');
  assert.equal(getServerArtwork({name:'Friends',invocation:'./srcds_run -game cstrike'}).id,'counter-strike-source');
  assert.equal(getServerArtwork({name:'Friends',invocation:'./hlds_run -game cstrike'}).id,'counter-strike-16');
  assert.equal(getServerArtwork({name:'Friends',relationships:{variables:{data:[{attributes:{env_variable:'STEAM_APP_ID',server_value:'2394010'}}]}}}).id,'palworld');
});

test('Discord workloads use Discord artwork without reading a token value', () => {
  assert.equal(getServerArtwork({name:'Discord music bot'}).id,'discord');
  assert.equal(getServerArtwork({name:'Minecraft Discord bot'}).id,'discord');
  const attributes={env_variable:'DISCORD_TOKEN',get server_value(){throw Error('Secret value must not be read');}};
  assert.equal(getServerArtwork({name:'Music',relationships:{variables:{data:[{attributes}]}}}).id,'discord');
});

test('unknown servers and applications retain locally hosted stock images', () => {
  assert.equal(getServerArtwork({name:'Rusty staging service'}).id,'software');
  assert.equal(getServerArtwork({name:'Worker',docker_image:'ghcr.io/parkervcp/yolks:nodejs_22'}).id,'software');
  assert.equal(getServerArtwork({name:'Private instance'}).id,'server');
  assert.equal(getServerArtwork({name:'Redis cache'}).id,'hardware');
});

test('all catalog images exist locally and include their online provenance', () => {
  assert.ok(catalog.length > 100);
  for (const artwork of catalog) {
    assert.match(artwork.src,/^\/artwork\/[a-z0-9-]+\.(?:jpg|png|svg|webp)$/);
    assert.ok(fs.existsSync(new URL(`../public${artwork.src}`,import.meta.url)),artwork.src);
    assert.match(artwork.source,/^https:\/\//);
  }
});

test('server icons precede pack artwork and only use authorized same-origin image routes',()=>{
  const server='/api/client/servers/abc-123/artwork/icon',pack='/api/client/servers/abc-123/artwork/pack';
  assert.deepEqual(getServerIconSources({server_icon:server,pack_icon:pack}),[{src:server,kind:'server'},{src:pack,kind:'modpack'}]);
  assert.deepEqual(getServerIconSources({pack_icon:pack}),[{src:pack,kind:'modpack'}]);
  for(const src of ['https://example.org/image.png','//example.org/image.png','/api/client/servers/abc/files/contents?file=secret','data:image/svg+xml,anything']){
    assert.deepEqual(getServerIconSources({server_icon:src,pack_icon:src}),[]);
  }
  assert.deepEqual(getServerIconSources(),[]);
});
