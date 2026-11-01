// Additive template metadata. The original variable remains the only form field.
export type TemplateSetupValidation={environment:string;type:'public_ipv4';required:boolean;message:string;description?:string};
export function setupPublicIPv4(value:string):boolean {
  if(value!==value.trim())return false;
  if(!/^(?:0|[1-9][0-9]{0,2})(?:\.(?:0|[1-9][0-9]{0,2})){3}$/.test(value))return false;
  const bytes=value.split('.').map(Number);
  if(bytes.some(n=>n>255))return false;
  if(value==='192.0.0.9'||value==='192.0.0.10')return true;
  const n=bytes.reduce((a,b)=>a*256+b,0);
  const ranges:[number,number][]=[
    [0x00000000,8],[0x0a000000,8],[0x64400000,10],[0x7f000000,8],
    [0xa9fe0000,16],[0xac100000,12],[0xc0000000,24],[0xc0000200,24],
    [0xc0a80000,16],[0xc6120000,15],[0xc6336400,24],[0xcb007100,24],
    [0xe0000000,4],[0xf0000000,4],
  ];
  return !ranges.some(([start,bits])=>n>=start&&n<start+2**(32-bits));
}
export function templateSetupRuleProblems(validations:readonly TemplateSetupValidation[]|null|undefined,variables:readonly {env_variable:string}[],environment:Record<string,string>):{field:string;message:string}[]{
  const problems:{field:string;message:string}[]=[];
  const seen=new Set<string>();
  for(const rule of validations??[]){
    const field=`game-template-${rule.environment}`;
    if(!/^[A-Z_][A-Z0-9_]{0,99}$/.test(rule.environment)||seen.has(rule.environment)||rule.type!=='public_ipv4'||typeof rule.required!=='boolean'||typeof rule.message!=='string'||!rule.message.trim()||rule.message.length>1024||/[\0\r\n]/.test(rule.message)||variables.filter(v=>v.env_variable===rule.environment).length!==1){
      problems.push({field,message:'This template\'s setup validation needs a compatibility review.'});
      continue;
    }
    seen.add(rule.environment);
    const value=environment[rule.environment];
    if((value===undefined||value==='')&&!rule.required)continue;
    if(typeof value!=='string'||!setupPublicIPv4(value))problems.push({field,message:rule.message});
  }
  return problems;
}
