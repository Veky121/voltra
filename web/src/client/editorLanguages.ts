import {LanguageDescription,LanguageSupport,StreamLanguage} from '@codemirror/language';
import {languages} from '@codemirror/language-data';
import {tags} from '@lezer/highlight';

const extra=(name:string,extensions:string[],kind:string)=>LanguageDescription.of({name,extensions,load:()=>import('./configSyntax.ts').then(m=>new LanguageSupport(StreamLanguage.define(m.configSyntax(kind))))});
export const editorLanguages=[...languages,
  LanguageDescription.of({name:'JSONC',extensions:['jsonc','code-workspace'],load:()=>import('@codemirror/legacy-modes/mode/javascript').then(m=>new LanguageSupport(StreamLanguage.define({...m.json,tokenTable:{property:tags.propertyName}})))}),
  LanguageDescription.of({name:'JSON5',extensions:['json5','mcmeta'],load:()=>import('@codemirror/legacy-modes/mode/javascript').then(m=>new LanguageSupport(StreamLanguage.define({...m.json,tokenTable:{property:tags.propertyName}})))}),
  extra('HOCON',['hocon'],'hocon'),
  extra('Forge config',['cfg'],'forge'),
  extra('SNBT',['snbt'],'snbt'),
  extra('Minecraft function',['mcfunction'],'mcfunction'),
  extra('Skript',['sk'],'skript'),
].sort((a,b)=>a.name.localeCompare(b.name));

export type Detection={name:string;reason:string};
const result=(name:string,reason:string):Detection=>({name,reason});
const ambiguous=/\.(?:cfg|conf|config|cnf|settings|dat|txt)$/i;
const backupSuffix=/\.(?:bak|backup|old|orig|dist|example|sample|disabled)$/i;

/** Bounded, local heuristics. A known extension wins; ambiguous config files use content. */
export function detectLanguage(path:string,content:string):Detection{
  const original=path.split('/').at(-1)||path;
  let filename=original;
  for(let n=0;n<3&&backupSuffix.test(filename);n++)filename=filename.replace(backupSuffix,'');
  const lower=filename.toLowerCase();
  const byName=(name:string)=>result(name,`File name: ${original}`);
  if(/^\.env(?:\.|$)/i.test(filename)||lower==='.npmrc'||lower==='.gitconfig')return byName('Properties files');
  if(/^dockerfile(?:\.|$)/i.test(filename))return byName('Dockerfile');
  if(/^nginx(?:\.|$)/i.test(filename))return byName('Nginx');
  if(/^(?:tsconfig|jsconfig)(?:\.[^.]+)?\.json$/i.test(filename))return byName('JSONC');
  if(/\.mcmeta$/i.test(filename)||lower==='mcmod.info')return byName('JSON5');
  if(/\.zs$/i.test(filename))return byName('Java'); // CraftTweaker ZenScript has Java-like syntax.
  const known=LanguageDescription.matchFilename(editorLanguages,filename)||LanguageDescription.matchFilename(editorLanguages,lower);
  if(known&&!ambiguous.test(filename)){
    if(known.name==='JSON'&&content.length<=65536){
      try{JSON.parse(content.replace(/^\uFEFF/,''))}catch{
        if(/\/\/|\/\*/.test(content))return result('JSONC',`Comments in ${original}`);
      }
    }
    return byName(known.name);
  }

  const sample=content.slice(0,16384).replace(/^\uFEFF/,'');
  const lines=sample.split(/\r?\n/).slice(0,160);
  const active=lines.filter(line=>line.trim()&&!/^\s*(?:#|;|!|\/\/)/.test(line));
  const text=sample.trimStart();
  if(/^#!/.test(text)){
    const head=text.split('\n')[0];
    if(/\bpython[\d.]*\b/.test(head))return result('Python','Python shebang');
    if(/\b(?:node|nodejs|deno|bun)\b/.test(head))return result('JavaScript','JavaScript shebang');
    if(/\b(?:ba|z|da|fi|k)?sh\b/.test(head))return result('Shell','Shell shebang');
    if(/\bruby\b/.test(head))return result('Ruby','Ruby shebang');
    if(/\bperl\b/.test(head))return result('Perl','Perl shebang');
  }
  if(/^<\?xml\b|^<[^!?][\w:.-]*(?:\s|>|\/)/.test(text))return result(/^<!doctype html|^<html\b/i.test(text)?'HTML':'XML','Markup in file contents');
  if(/^<!doctype html/i.test(text))return result('HTML','HTML document declaration');
  if(active.some(line=>/^\s*[BIDS]:\s*[^=]+\s*=/.test(line)))return result('Forge config','Forge typed settings in file contents');
  if(/^\s*\{/.test(text)&&/(?:^|[,{\s])[\w"'.-]+\s*:\s*(?:[\[{"']|-?\d+[bBsSlLfFdD]\b)/.test(text)&&/(?:\[\s*[BIL];|\b-?\d+[bBsSlLfFdD]\b)/.test(text))return result('SNBT','NBT typed values in file contents');
  const uncommented=sample.replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*(?:\/\/[^\n]*|#[^\n]*|;[^\n]*|![^\n]*)\n/gm,'').trimStart();
  if(/^[{[]/.test(uncommented)&&/(?:["'][^\n"']+["']\s*:|\{\s*\}|\{\s*[\w$]+\s*:|^\[\s*(?:\{|\[|"|'|-?\d|true|false|null|\]))/.test(uncommented)){
    if(content.length>65536)return result(/^\s*\/\/|\/\*/m.test(sample)?'JSON5':'JSON','JSON structure in sampled file contents');
    try{JSON.parse(content.replace(/^\uFEFF/,''));return result('JSON','JSON structure in file contents')}catch{/* Comments and trailing commas are common in mod configs. */}
    return result('JSON5','JSON-like contents with comments or relaxed syntax');
  }
  const assignments=active.filter(line=>/^\s*[\w."' -]+\s*=/.test(line));
  const sections=active.some(line=>/^\s*\[\[?[\w."' -]+\]\]?\s*(?:[#;].*)?$/.test(line));
  if((sections&&assignments.length)||assignments.length>=2){
    if(sections&&assignments.some(line=>/=\s*(?:["'\[]|true\b|false\b|-?\d)/.test(line))&&!/\.ini$/i.test(lower))return result('TOML','Config tables and typed assignments');
    if(sections)return result('Properties files','INI sections and assignments');
  }
  if(active.some(line=>/^\s*(?:include\s+["']|[\w."'-]+\s*(?:[=:]\s*)?\{)/.test(line))&&active.some(line=>/^\s*[\w."'-]+\s*[=:]/.test(line)))return result('HOCON','Nested config objects and settings');
  if(assignments.length&&assignments.length>=active.filter(line=>!/^\s*[\]}]/.test(line)).length*.6)return result('Properties files','Key=value settings in file contents');
  if(active.some(line=>/^\s*[\w."'-]+:\s*(?:\S.*)?$/.test(line))&&(active.length>1||ambiguous.test(filename)))return result('YAML','YAML-style keys in file contents');
  if(ambiguous.test(filename)&&/\.(?:cfg|conf|config|cnf|settings)$/i.test(filename))return result('Properties files','Generic config extension; select a language to override');
  if(known)return byName(known.name);
  return result('Plain text','No recognizable text format; select a language to override');
}

export function isBinaryText(text:string){
  const sample=text.slice(0,8192);
  return sample.includes('\0')||((sample.match(/[\x01-\x08\x0E-\x1F]/g)?.length||0)>Math.max(3,sample.length*.01));
}

export function decodeEditorFile(buffer:ArrayBuffer){
  let text:string;
  try{text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(buffer)}catch{throw new Error('This file is not UTF-8 text. Download it to use an editor that supports its encoding.')}
  if(isBinaryText(text))throw new Error('This appears to be a binary file. Download it to use a compatible editor.');
  return text;
}
