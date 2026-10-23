import type {StreamParser} from '@codemirror/language';

/** Tolerant token highlighting for game configs, without enforcing a schema or rewriting values. */
export function configSyntax(kind:string):StreamParser<{blockComment:boolean;quote:string}>{
  return {
    name:kind,
    startState:()=>({blockComment:false,quote:''}),
    token(stream,state){
      if(state.blockComment){if(stream.skipTo('*/')){stream.match('*/');state.blockComment=false}else stream.skipToEnd();return 'comment'}
      if(state.quote){
        while(!stream.eol()){
          if(stream.match(state.quote)){state.quote='';break}
          if(stream.next()==='\\')stream.next();
        }
        return 'string';
      }
      if(stream.eatSpace())return null;
      if(stream.match('/*')){state.blockComment=true;return 'comment'}
      if(stream.match('//')||stream.match('#')){stream.skipToEnd();return 'comment'}
      if(stream.match('"""')){state.quote='"""';return 'string'}
      const quote=stream.peek();
      if(quote==='"'||quote==="'"){
        stream.next();
        while(!stream.eol()){const char=stream.next();if(char==='\\')stream.next();else if(char===quote)break}
        return stream.match(/^\s*[:=]/,false)?'propertyName':'string';
      }
      if(kind==='forge'&&stream.match(/[BIDS]:(?=[^=\n]*=)/))return 'typeName';
      if(stream.match(/\$\{[^}]*\}/))return 'variableName';
      if(stream.match(/@[pares](?:\[[^\]]*\])?/))return 'variableName';
      if(stream.match(/-?(?:0x[\da-fA-F]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?)[bBsSlLfFdD]?\b/))return 'number';
      if(stream.match(/(?:true|false|null|on|off|yes|no)\b/i))return 'atom';
      if(stream.match(/[\w.$/:-]+(?=\s*[=:])/))return 'propertyName';
      if(kind==='mcfunction'&&stream.sol()&&stream.match(/\/?[a-z]+\b/))return 'keyword';
      if(kind==='skript'&&stream.match(/(?:on|command|trigger|options|variables|function|if|else|loop|set|to|send|execute|wait|stop)\b/))return 'keyword';
      if(stream.match(/[{}\[\]<>]/))return 'bracket';
      if(stream.match(/[=:,;]/))return 'operator';
      if(stream.match(/[\w.$/:-]+/))return 'variableName';
      stream.next();return null;
    },
    languageData:{commentTokens:{line:kind==='hocon'?'//':'#'},closeBrackets:{brackets:['(', '[', '{', '"', "'"]}},
  };
}
