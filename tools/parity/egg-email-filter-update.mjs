import {readFile,writeFile} from 'node:fs/promises';
const target='internal/panel/egg_email.go';let source=await readFile(target,'utf8');
const start=source.indexOf('func eggEmailFilter('),end=source.indexOf('\nvar eggEmailIDNA',start);if(start<0||end<0)throw Error('Filter function markers unavailable');
source=source.slice(0,start)+`func eggEmailFilter(s string,allowUnicode bool)(bool,error){
 if len(s)>320{return false,nil};pattern:=eggEmailPHPFilterPattern;if allowUnicode{pattern=eggEmailPHPFilterUnicodePattern};compiled,err:=compileEggPCRE(pattern);if err!=nil{return false,err};return compiled.MatchString(s)
}
`+source.slice(end);await writeFile(target,source);
