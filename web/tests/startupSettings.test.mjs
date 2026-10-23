import test from 'node:test';
import assert from 'node:assert/strict';
import {
  commandPreview, secretVariable, startupRules, variableControl,
  variableCanReset, variableEditable, variableProblem, variableValue, variableWrite,
} from '../src/client/startupSettingsModel.ts';

const variable = {name:'Player limit',env_variable:'MAX_PLAYERS',server_value:'16',default_value:'8',is_editable:true,is_overridden:true,rules:'required|integer|min:1|max:64'};

test('numeric and string validation use the rule type, never a numeric-looking value', () => {
  const control = variableControl(variable);
  assert.equal(control.type, 'number');
  assert.equal(control.step, 1);
  assert.equal(control.min, 1);
  assert.equal(control.max, 64);
  for (const draft of ['', '0', '65', '1.5', 'Infinity']) assert.ok(variableProblem(variable,draft));
  for (const draft of ['1','64']) assert.equal(variableProblem(variable,draft), '');
  const text = {...variable,rules:'required|string|min:2|max:6',server_value:'123'};
  assert.equal(variableControl(text).type,'text');
  assert.equal(variableControl(text).max,undefined);
  assert.equal(variableControl(text).maxLength,6);
  assert.equal(variableProblem(text,'12'),'');
  assert.ok(variableProblem(text,'1'));
  assert.ok(variableProblem(text,'1234567'));
  assert.equal(variableProblem({...text,rules:'string|max:2'},'😀😀'),'');
  assert.equal(variableControl({...text,rules:'nullable|numeric|min:0.5|max:3'}).step,'any');
  assert.equal(variableControl({...text,rules:'email'}).type,'email');
});

test('schema choices and boolean controls preserve allowed values', () => {
  assert.deepEqual(variableControl({...variable,rules:'required|in:easy,normal,hard'}).options,['easy','normal','hard']);
  assert.deepEqual(variableControl({...variable,rules:'required|boolean'}).options,['1','0']);
  assert.ok(variableProblem({...variable,rules:'in:a,b'},'c'));
  assert.equal(variableProblem({...variable,rules:'in:a,b'},'b'),'');
  const regex = 'required|regex:/^(one|two)\/[a-z]+$/i|max:50';
  assert.deepEqual(startupRules(regex),['required','regex:/^(one|two)\/[a-z]+$/i','max:50']);
  assert.equal(variableControl({...variable,rules:regex}).maxLength,50);
});

test('each write contains exactly one variable and reset uses inheritance semantics', () => {
  assert.equal(variableWrite(variable,'16','save',true),null);
  assert.deepEqual(variableWrite(variable,'32','save',true),{key:'MAX_PLAYERS',value:'32'});
  assert.deepEqual(variableWrite(variable,'32','reset',true),{key:'MAX_PLAYERS',reset:true});
  assert.throws(()=>variableWrite({...variable,is_overridden:undefined},'32','reset',true),/No template override/);
  assert.throws(()=>variableWrite(variable,'32','clear',true),/only available for secret/);
  assert.throws(()=>variableWrite(variable,'65','save',true),/no more than 64/);
  assert.equal(variableCanReset({...variable,can_reset:false}),false);
  assert.throws(()=>variableWrite({...variable,can_reset:false},'32','reset',true),/No template override/);
  assert.deepEqual(variableWrite({...variable,can_reset:true},'32','reset',true),{key:'MAX_PLAYERS',reset:true});
});

test('permission and template read-only flags both prevent mutation', () => {
  assert.equal(variableEditable(variable,true),true);
  for (const [field,permitted] of [[variable,false],[{...variable,is_editable:false},true],[{...variable,user_editable:false},true]]) {
    assert.equal(variableEditable(field,permitted),false);
    for (const intent of ['save','clear','reset']) assert.throws(()=>variableWrite(field,'32',intent,permitted),/read-only/);
  }
});

test('named password and token fields stay masked even with legacy metadata', () => {
  for (const field of [
    {...variable,secret:true},
    {...variable,env_variable:'RCON_PASSWORD'},
    {...variable,env_variable:'API_TOKEN'},
    {...variable,name:'Private key'},
  ]) {
    assert.equal(secretVariable(field),true);
    assert.equal(variableValue(field),'');
    assert.equal(variableControl(field).type,'password');
    assert.equal(variableControl({...field,rules:'in:private1,private2'}).options,undefined);
  }
  assert.equal(secretVariable(variable),false);
  assert.equal(secretVariable({...variable,env_variable:'TOKEN_EXPIRY',secret:false}),false);
  assert.equal(variableValue({...variable,server_value:0}),'0');
  assert.equal(variableValue({...variable,server_value:null}),'8');
});

test('blank secret is unchanged; explicit clear and reset never submit placeholders', () => {
  const secret = {...variable,env_variable:'PASSWORD',secret:true,secret_configured:true,rules:'nullable|string|max:100',server_value:'[hidden]',default_value:null};
  assert.equal(variableWrite(secret,'','save',true),null);
  assert.deepEqual(variableWrite(secret,'  new secret  ','save',true),{key:'PASSWORD',value:'  new secret  '});
  assert.deepEqual(variableWrite(secret,'ignored draft','clear',true),{key:'PASSWORD',value:''});
  assert.deepEqual(variableWrite(secret,'','reset',true),{key:'PASSWORD',reset:true});
  for (const mask of ['[hidden]','[redacted]','[secret]','<redacted>','••••••','******','●●●']) assert.throws(()=>variableWrite(secret,mask,'save',true),/masked placeholder/);
  assert.throws(()=>variableWrite({...secret,rules:'required|string'},'','clear',true),/required/);
});

test('preview uses saved values and redacts secret placeholders, raw values and hidden fields', () => {
  const secret = {...variable,env_variable:'PASSWORD',secret:true,server_value:'do-not-show',default_value:'template-secret'};
  const meta = {raw_startup_command:'run --players {{MAX_PLAYERS}} --password {{ PASSWORD }} --hidden {{UNKNOWN}} do-not-show template-secret'};
  assert.equal(commandPreview(meta,[variable,secret]),'run --players 16 --password [hidden] --hidden [hidden] [hidden] [hidden]');
  assert.doesNotMatch(commandPreview({startup_command:'unsafe expanded do-not-show'},[secret]),/do-not-show/);
  assert.equal(commandPreview({startup_command:'java -Xmx2G --password [hidden]',raw_startup_command:'raw template'},[{...secret,server_value:'',default_value:''}]),'java -Xmx2G --password [hidden]');
  assert.match(commandPreview({},[]),/No command preview/);
  assert.equal(commandPreview({startup_command:'run --players 16'},[variable]),'run --players 16');
});
