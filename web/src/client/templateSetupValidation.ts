import {miBToGB} from "../resourceUnits.ts";
import {templateAgreementsAccepted,templateVariableProblem,type TemplateVariableDefinition,type GameAgreement} from './gameTemplateModel.ts';

export type SetupProblem={field?:string;message:string};
export type TemplateReadiness={
  name:string;node?:{setup_available?:boolean;private_content_ready?:boolean;unavailable_reason?:string};
  memory:number|null;memoryMaximum:number;disk:number|null;diskMaximum:number;imageValid:boolean;
  portsReady:boolean;portsLoading:boolean;portsError:boolean;steamError:boolean;
  privateContent:boolean;privateSupported:boolean;fs25:boolean;savedLicence:boolean;
  variables:(TemplateVariableDefinition&{name:string})[];environment:Record<string,string>;agreements?:GameAgreement[];
};
export function templateSetupProblems(input:TemplateReadiness):SetupProblem[]{
  const problems:SetupProblem[]=[];
  const add=(field:string|undefined,message:string)=>problems.push({field,message});
  if(!input.name.trim())add('game-server-name','Enter a server name.');
  else if(input.name.length>100)add('game-server-name','Server name must be no more than 100 characters.');
  if(!input.node)add('game-server-node','Choose a compatible host machine.');
  else if(input.node.setup_available===false)add('game-server-node',input.node.unavailable_reason||'This host machine is not ready for setup.');
  if(input.memory===null||!Number.isSafeInteger(input.memory)||input.memory<128)add('game-server-memory','Enter at least 0.125 GB of memory.');
  else if(input.memory>input.memoryMaximum)add('game-server-memory',`Memory exceeds the host's available ${miBToGB(input.memoryMaximum)} GB.`);
  if(input.disk===null||!Number.isSafeInteger(input.disk)||input.disk<128)add('game-server-storage','Enter at least 0.125 GB of storage.');
  else if(input.disk>input.diskMaximum)add('game-server-storage',`Storage exceeds the host's available ${miBToGB(input.diskMaximum)} GB.`);
  if(!input.imageValid)add('game-runtime-image','Choose an available runtime image in advanced settings.');
  if(input.steamError)add(undefined,'Review the Steam installation settings above.');
  if(input.privateContent&&(!input.privateSupported||input.node?.private_content_ready!==true))add('game-server-node','Private Steam installation requires a supported host and trusted worker.');
  if(!templateAgreementsAccepted(input.agreements,input.environment))add(undefined,'Accept the required publisher terms above.');
  if(input.node&&input.node.setup_available!==false&&!input.steamError){
    if(input.portsError)add('game-template-ports','Port checks failed. Retry the check above.');
    else if(input.portsLoading||!input.portsReady)add('game-template-ports','Waiting for automatic port checks to finish.');
  }
  if(input.fs25&&!input.environment.GAME_SERIAL?.trim()&&!input.savedLicence&&input.environment.AUTO_DOWNLOAD!=='false')
    add(undefined,'Ask an administrator to assign an unused GIANTS game and DLC licence, or turn off automatic game downloads to upload an installer.');
  for(const variable of input.variables){
    const problem=templateVariableProblem(variable,input.environment);
    if(problem)add(`game-template-${variable.env_variable}`,`${variable.name}: ${problem}`);
  }
  if(input.fs25&&!problems.some(p=>p.field==='game-template-WEB_PASSWORD')&&Array.from(input.environment.WEB_PASSWORD??'').length<12)
    add('game-template-WEB_PASSWORD','Web portal password: Use at least 12 characters.');
  return problems;
}
