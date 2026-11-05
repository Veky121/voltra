import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import ts from '../../web/node_modules/typescript/lib/typescript.js';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const proposal=resolve(root,'artifacts/game-parity-20261029/banana-wave4-setup-templateSetupValidation.ts.pending');
let code=readFileSync(proposal,'utf8');
for(const [specifier,path] of [['../resourceUnits.ts','web/src/resourceUnits.ts'],['./gameTemplateModel.ts','web/src/client/gameTemplateModel.ts'],['./templateSetupRules.ts','web/src/client/templateSetupRules.ts']])code=code.replaceAll(specifier,pathToFileURL(resolve(root,path)).href);
const compiled=ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,verbatimModuleSyntax:true}}).outputText;
const {templateSetupProblems}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
const rule={environment:'PUBLIC_IP',type:'public_ipv4',required:true,message:'Enter the global unicast IPv4 address advertised by this host to Astroneer clients.'};
const variable={name:'Public IP',env_variable:'PUBLIC_IP',default_value:'',rules:'required|string',user_viewable:true};
const ready=value=>({name:'Astroneer',node:{setup_available:true},memory:4096,memoryMaximum:16384,disk:8192,diskMaximum:32768,imageValid:true,portsReady:true,portsLoading:false,portsError:false,steamError:false,privateContent:false,privateSupported:false,fs25:false,savedLicence:false,variables:[variable],environment:{PUBLIC_IP:value},setupValidation:[rule]});
test('pending shared readiness hook uses the existing field and preserves original required validation',()=>{
  for(const value of ['100.64.0.1','192.0.2.1','224.0.0.1','1.1.1.1\n'])assert.deepEqual(templateSetupProblems(ready(value)),[{field:'game-template-PUBLIC_IP',message:rule.message}]);
  const missing=templateSetupProblems(ready(''));assert.equal(missing.length,1);assert.equal(missing[0].field,'game-template-PUBLIC_IP');assert.match(missing[0].message,/Enter a value/);
  for(const value of ['1.1.1.1','8.8.8.8','192.0.0.9','192.0.0.10'])assert.deepEqual(templateSetupProblems(ready(value)),[]);
  const ordinary=ready('100.64.0.1');delete ordinary.setupValidation;assert.deepEqual(templateSetupProblems(ordinary),[]);
});
test('full frontend TypeScript check with pending callsites, without changing live source',()=>{
  const configPath=resolve(root,'web/tsconfig.json');
  const config=ts.readConfigFile(configPath,ts.sys.readFile);
  const parsed=ts.parseJsonConfigFileContent(config.config,ts.sys,resolve(root,'web'));
  const overlay=new Map([
    [resolve(root,'web/src/client/templateSetupValidation.ts').toLowerCase(),readFileSync(proposal,'utf8')],
    [resolve(root,'web/src/client/TemplateGames.tsx').toLowerCase(),readFileSync(resolve(root,'artifacts/game-parity-20261029/banana-wave4-setup-TemplateGames.tsx.pending'),'utf8')],
  ]);
  const host=ts.createCompilerHost(parsed.options);
  const originalRead=host.readFile.bind(host);host.readFile=path=>overlay.get(resolve(path).toLowerCase())??originalRead(path);
  host.getSourceFile=(path,languageVersion,onError)=>{const text=host.readFile(path);if(text===undefined){onError?.('File not found');return undefined;}return ts.createSourceFile(path,text,languageVersion);};
  const program=ts.createProgram(parsed.fileNames,parsed.options,host);
  const errors=ts.getPreEmitDiagnostics(program).filter(d=>d.category===ts.DiagnosticCategory.Error);
  assert.equal(errors.length,0,ts.formatDiagnosticsWithColorAndContext(errors,{getCanonicalFileName:p=>p,getCurrentDirectory:()=>resolve(root,'web'),getNewLine:()=> '\n'}));
});
