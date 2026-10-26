import {getServerArtwork} from './serverArtwork.ts';
import communityArtwork from './minecraftCommunityArtwork.json' with {type:'json'};

type Server = Parameters<typeof getServerArtwork>[0];
export type ServerSoftwareArtwork = {id:string;name:string;src:string};

export function getServerSoftwareArtwork(server:Server):ServerSoftwareArtwork|undefined{
  if(getServerArtwork(server).id!=='minecraft')return;
  const variables=server.relationships?.variables?.data?.map(variable=>variable.attributes??{})??[];
  const declared=variables.find(variable=>variable.env_variable==='MINECRAFT_LOADER');
  // An explicit unknown loader must not borrow a badge from the launch command.
  const id=declared?String(declared.server_value??declared.default_value??'').trim().toLowerCase():
    `${server.egg_name??''} ${server.invocation??''}`.toLowerCase().match(/\b(neoforge|fabric|quilt|forge|paper|purpur|velocity|arclight|cuberite|glowstone|mohist|nukkit)\b/)?.[1];
  if(id==='vanilla')return {id,name:'Vanilla',src:'/game-icons/minecraft-official.png'};
  const artwork=id?(communityArtwork as Record<string,{title:string;src:string}>)[id]:undefined;
  // Use bundled images only. Entries without a supplied local image stay absent.
  if(artwork?.src.startsWith('/game-icons/'))return {id:id!,name:artwork.title,src:artwork.src};
}
