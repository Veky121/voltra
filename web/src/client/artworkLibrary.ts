export type ArtworkMapping = {server:Record<string,string>;library:Record<string,string>};
let mapping:ArtworkMapping={server:{},library:{}};
const listeners=new Set<()=>void>();
export const subscribeArtwork=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener)}};
export const artworkSnapshot=()=>mapping;
export function setArtworkMapping(value:unknown){
 const next:ArtworkMapping={server:{},library:{}};
 if(value&&typeof value==='object')for(const group of ['server','library'] as const){
  const entries=(value as Record<string,unknown>)[group];
  if(entries&&typeof entries==='object')for(const [id,src] of Object.entries(entries))if(typeof src==='string'&&/^\/api\/client\/artwork\/[a-f0-9]{64}\.png$/.test(src))next[group][id]=src;
 }
 mapping=next;listeners.forEach(listener=>listener());
}
export function panelArtwork<T extends {src:string}>(group:'server'|'library',id:string,base:T):T{return mapping[group][id]?{...base,src:mapping[group][id]}:base}
