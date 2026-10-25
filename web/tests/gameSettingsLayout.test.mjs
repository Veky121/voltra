import test from 'node:test';
import assert from 'node:assert/strict';
import {readableSettingName,settingsGroups} from '../src/client/gameSettingsLayout.ts';
const field=(key,label=key)=>({key,label,type:'text',value:''});
test('Minecraft settings group by purpose and retain every property exactly once',()=>{
 const fields=['motd','gamemode','level-seed','view-distance','server-port','resource-pack','rcon.password','unknown-future-option'].map(key=>field(key));
 const groups=settingsGroups(fields,'minecraft','/server.properties');
 assert.equal(groups[0].id,'general');
 assert.equal(groups.find(group=>group.id==='world').fields[0].key,'level-seed');
 assert.equal(groups.find(group=>group.id==='network').fields[0].key,'server-port');
 assert.deepEqual(groups.flatMap(group=>group.fields.map(field=>field.key)).sort(),fields.map(field=>field.key).sort());
});
test('platform YAML and other game settings follow their native sections',()=>{
 const groups=settingsGroups([field('/chunks/autosave'),field('/misc/enable-nether')],'minecraft','/config/paper-global.yml');
 assert.deepEqual(groups.map(group=>group.label),['Chunks','Misc']);
 assert.equal(settingsGroups([field('ServerName')],'palworld','/server.ini')[0].label,'General');
});
test('names are readable while original property keys stay intact',()=>{
 assert.equal(readableSettingName(field('management-server-tls-enabled')),'Management server TLS enabled');
 assert.equal(readableSettingName(field('view-distance')),'View distance');
 assert.equal(readableSettingName(field('ServerName','Server name')),'Server name');
 assert.equal(readableSettingName(field('/misc/enable-nether')),'Misc / Enable nether');
});
