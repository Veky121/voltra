export type ThemePreferences={version:1;backgroundA:string;backgroundB:string;accentA:string;accentB:string;backgroundGradient:boolean;accentGradient:boolean;glassCards:boolean;cardOpacity:number};
export const defaultTheme:ThemePreferences={version:1,backgroundA:'#1b202b',backgroundB:'#141820',accentA:'#4d78c9',accentB:'#326f73',backgroundGradient:true,accentGradient:true,glassCards:true,cardOpacity:57};
export function parseTheme(value:unknown):ThemePreferences|null{
 if(!value||typeof value!=='object')return null;
 const v=value as Record<string,unknown>;
 if(v.version!==1||!['backgroundA','backgroundB','accentA','accentB'].every(k=>typeof v[k]==='string'&&/^#[\da-f]{6}$/i.test(v[k] as string))||typeof v.backgroundGradient!=='boolean'||typeof v.accentGradient!=='boolean')return null;
 if(v.glassCards!==undefined&&typeof v.glassCards!=='boolean')return null;
 if(v.cardOpacity!==undefined&&(typeof v.cardOpacity!=='number'||!Number.isInteger(v.cardOpacity)||v.cardOpacity<35||v.cardOpacity>100))return null;
 return {version:1,backgroundA:String(v.backgroundA).toLowerCase(),backgroundB:String(v.backgroundB).toLowerCase(),accentA:String(v.accentA).toLowerCase(),accentB:String(v.accentB).toLowerCase(),backgroundGradient:v.backgroundGradient,accentGradient:v.accentGradient,glassCards:(v.glassCards as boolean|undefined)??defaultTheme.glassCards,cardOpacity:(v.cardOpacity as number|undefined)??defaultTheme.cardOpacity};
}
export function themeKey(origin:string,account:string){return `voltra.theme.v1:${encodeURIComponent(origin)}:${encodeURIComponent(account)}`}
function channels(hex:string){return [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16))}
export function contrast(a:string,b:string){const luminance=(hex:string)=>channels(hex).map(c=>{const n=c/255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4}).reduce((n,c,i)=>n+c*[.2126,.7152,.0722][i],0);const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)}
function mix(a:string,b:string,t:number){const end=channels(b);return '#'+channels(a).map((n,i)=>Math.round(n+(end[i]-n)*t).toString(16).padStart(2,'0')).join('')}
// Keep both ends readable, including when users pick a very light/dark pair.
export function readablePair(a:string,b:string,forceWhite=false){
 const white='#ffffff',black='#101319';
 const ink=forceWhite||Math.min(contrast(a,white),contrast(b,white))>=Math.min(contrast(a,black),contrast(b,black))?white:black;
 const shade=ink===white?black:white;
 const minimum=forceWhite?10.5:4.5;
 const adjust=(color:string)=>{for(let step=0;step<=100;step++){const result=mix(color,shade,step/100);if(contrast(result,ink)>=minimum)return result}return shade};
 const start=adjust(a),end=adjust(b);
 for(let step=0;step<=100;step++){
  const first=mix(start,shade,step/100),second=mix(end,shade,step/100);
  if(Array.from({length:21},(_,i)=>contrast(mix(first,second,i/20),ink)).every(ratio=>ratio>=minimum))return {a:first,b:second,ink};
 }
 return {a:shade,b:shade,ink};
}
export function themeVariables(theme:ThemePreferences):Record<string,string>{
 const bg=readablePair(theme.backgroundA,theme.backgroundGradient?theme.backgroundB:theme.backgroundA,true);
 const accent=readablePair(theme.accentA,theme.accentGradient?theme.accentB:theme.accentA);
 const opacity=theme.glassCards?theme.cardOpacity/100:1;
 return {'--theme-background':`linear-gradient(155deg,${bg.a},${bg.b})`,'--theme-primary':`linear-gradient(110deg,${accent.a},${accent.b})`,'--theme-primary-ink':accent.ink,'--theme-accent-a':accent.a,'--theme-accent-b':accent.b,'--theme-shell-a':bg.a,'--theme-shell-b':bg.b,'--accent':mix(accent.a,'#ffffff',.45),'--blue':mix(accent.a,'#ffffff',.45),'--primary':accent.a,'--accent-ink':accent.ink,'--theme-card-surface':`rgba(24,28,37,${opacity})`,'--theme-card-blur':theme.glassCards?'24px':'0px','--theme-console-surface':`rgba(15,18,24,${Math.max(.85,opacity)})`,'--theme-card-sheen':theme.glassCards?'linear-gradient(145deg,#ffffff04,transparent 65%)':'linear-gradient(transparent,transparent)'};
}
