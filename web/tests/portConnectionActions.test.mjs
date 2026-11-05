import test from 'node:test';
import assert from 'node:assert/strict';
import {portConnectionActions,groupPortRoutes} from '../src/client/portConnectionActions.ts';
const port={id:7,is_default:true};
const setup={allocations:[{id:7,forward_client_ids:[2]}],clients:[{id:1},{id:2}]};
const domain={choices:[{id:11}]};
test('only admin-approved eligible forwarding connections are offered',()=>{
 assert.deepEqual(portConnectionActions(port,setup,domain,true,true).clients,[{id:2}]);
 assert.equal(portConnectionActions(port,setup,domain,false,true).forward,false);
 assert.equal(portConnectionActions(port,undefined,domain,true,true).forward,false);
 assert.equal(portConnectionActions({id:8},setup,domain,true,true).forward,false);
});
test('subdomain requires configured choice, matching port and write permission',()=>{
 assert.equal(portConnectionActions(port,setup,domain,false,true).subdomain,true);
 assert.equal(portConnectionActions(port,setup,domain,true,false).subdomain,false);
 assert.equal(portConnectionActions(port,setup,{},true,true).subdomain,false);
 assert.equal(portConnectionActions({id:8,is_default:false},setup,domain,true,true).subdomain,false);
 assert.equal(portConnectionActions(port,undefined,undefined,true,true).subdomain,false);
});

test('same address and destination combine protocols without hiding errors',()=>{
 const tcp={id:1,protocol:'tcp',public_host:'example.test',public_port:25592,local_ip:'127.0.0.1',local_port:25592,status:'applied',desired_present:true};
 const udp={...tcp,id:2,protocol:'udp'};
 const merged=groupPortRoutes([udp,tcp]);
 assert.equal(merged.length,1);
 assert.equal(merged[0].protocol,'TCP & UDP');
 assert.equal(merged[0].members.length,2);
 assert.equal(groupPortRoutes([tcp,{...udp,public_port:1024}]).length,2);
 const failed=groupPortRoutes([tcp,{...udp,status:'error',last_error:'UDP failed'}])[0];
 assert.equal(failed.status,'error');assert.equal(failed.last_error,'UDP failed');
});
