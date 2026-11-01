import test from 'node:test';
import assert from 'node:assert/strict';
import {cfxSetupProblem,fiveMTemplateID} from '../src/client/cfxAdmission.ts';
test('Cfx dependent capacity preserves FiveM48 and requires explicit RedM capacity',()=>{
 for(const value of ['0','33','48','1.5','','oops'])assert.ok(cfxSetupProblem(fiveMTemplateID,{TXHOST_GAME_NAME:'redm',MAX_PLAYERS:value}));
 for(const value of ['1','32'])assert.equal(cfxSetupProblem(fiveMTemplateID,{TXHOST_GAME_NAME:'redm',MAX_PLAYERS:value}),'');
 assert.equal(cfxSetupProblem(fiveMTemplateID,{TXHOST_GAME_NAME:'fivem',MAX_PLAYERS:'48'}),'');
 assert.equal(cfxSetupProblem('other',{TXHOST_GAME_NAME:'redm',MAX_PLAYERS:'48'}),'');
});
