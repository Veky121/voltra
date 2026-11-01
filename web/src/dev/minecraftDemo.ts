import type {QuickField} from '../client/gameSetupModel';

// Static UI samples, never used as installation defaults or live configuration.
const image='ghcr.io/pterodactyl/yolks:java_21';
const command='java -Xms1024M -Xmx{{JAVA_MAX_HEAP}}M -XX:+UseG1GC -jar {{SERVER_JARFILE}} nogui';
const list=(entries:unknown[])=>({object:'list',data:entries.map(attributes=>({attributes}))});
type Server={id:number;uuid:string;name:string;node_id:number;limits:{memory:number};allocation:{id:number;port:number}};
export const minecraftVariables=[
 {env_variable:'SERVER_JARFILE',name:'Server JAR',description:'The JAR file used to start Minecraft.',default_value:'server.jar',rules:'required|string'},
 {env_variable:'MINECRAFT_VERSION',name:'Minecraft version',description:'The game version installed on this server.',default_value:'1.21.1',rules:'required|string'},
 {env_variable:'PAPER_BUILD',name:'Paper build',description:'The Paper build used during installation.',default_value:'132',rules:'required|string'},
].map((variable,index)=>({...variable,id:9401+index,egg_id:9001,server_value:variable.default_value,user_viewable:true,user_editable:true,is_editable:true}));
export const minecraftEgg={id:9001,nest_id:9001,name:'Minecraft Paper',startup:command,docker_images:{'Java 21 (Temurin)':image},relationships:{variables:list(minecraftVariables)}};
export function minecraftAdminRecord<T extends Server>(server:T){
 return {...server,node:server.node_id,allocation:server.allocation.id,egg:9001,nest:9001,
  container:{installed:1,image,startup_command:command,skip_scripts:false},
  relationships:{variables:list(minecraftVariables),allocations:list([server.allocation])}};
}
const folders=[{label:'World',path:'/world'},{label:'Plugins',path:'/plugins'},{label:'Configuration',path:'/config'}];
const field=(key:string,type:QuickField['type'],value:QuickField['value'],help:string,extra:Partial<QuickField>={}):QuickField=>({key,label:key,type,value,help,...extra});
const select=(key:string,value:string,values:string[],help:string)=>field(key,'select',value,help,{options:values.map(value=>({value,label:value.charAt(0).toUpperCase()+value.slice(1)}))});
export function minecraftSettings(server:Server){
 const creative=server.uuid==='demo-creative';
 return {game:'minecraft',file:'/server.properties',documents:[{path:'/server.properties',label:'server.properties'}],
  revision:`demo-minecraft-${server.id}-1`,requires_stop:true,folders,help:[],fields:[
   field('motd','text',creative?'Creative building world':'Welcome to the survival world','The message shown in the server list.'),
   field('max-players','number',creative?10:20,'The maximum number of players online.',{min:1,max:100}),
   select('gamemode',creative?'creative':'survival',['survival','creative','adventure','spectator'],'The default game mode for new players.'),
   select('difficulty',creative?'peaceful':'normal',['peaceful','easy','normal','hard'],'Controls mob strength and survival difficulty.'),
   field('online-mode','boolean',true,'Verify Minecraft accounts when players join.'),
   field('white-list','boolean',!creative,'Only allow players on the whitelist.'),
   field('pvp','boolean',!creative,'Allow players to damage each other.'),
   field('hardcore','boolean',false,'Players cannot respawn after dying.'),
   field('allow-flight','boolean',creative,'Allow flight without kicking players.'),
   field('level-name','text','world','The folder containing the active world.'),
   field('level-seed','text',creative?'':'8675309','The seed used when generating a new world.'),
   select('level-type','minecraft:normal',['minecraft:normal','minecraft:flat','minecraft:large_biomes'],'The terrain generator for new worlds.'),
   field('generate-structures','boolean',true,'Generate villages and other structures.'),
   field('spawn-protection','number',16,'Protected radius around world spawn.',{min:0,max:100}),
   field('allow-nether','boolean',true,'Allow travel to the Nether.'),
   field('player-idle-timeout','number',15,'Disconnect idle players after this many minutes; zero disables it.',{min:0,max:120}),
   field('enforce-secure-profile','boolean',true,'Require signed player profiles.'),
   field('enable-command-block','boolean',creative,'Allow command blocks to execute commands.'),
   field('view-distance','number',10,'How many chunks players can see.',{min:2,max:32}),
   field('simulation-distance','number',8,'How far away world activity is simulated.',{min:2,max:32}),
   field('max-tick-time','number',60000,'Stop the server if a tick takes too long.',{min:-1}),
   field('server-port','number',server.allocation.port,'Managed by the primary network allocation.',{readonly:true}),
   field('enable-query','boolean',false,'Allow external tools to query server information.'),
   field('network-compression-threshold','number',256,'Compress network packets above this size.',{min:-1}),
   field('resource-pack','text','','Optional URL for a server resource pack.'),
   field('require-resource-pack','boolean',false,'Require players to accept the resource pack.'),
  ]};
}
export function minecraftClientFixture(server:Server,section:string|undefined):unknown|undefined{
 if(section==='game-settings')return {attributes:minecraftSettings(server)};
 if(section==='game-settings/folders')return {attributes:{folders}};
 if(section==='startup')return {...list(minecraftVariables),meta:{startup_command:command.replace('{{JAVA_MAX_HEAP}}',String(server.limits.memory-1024)).replace('{{SERVER_JARFILE}}','server.jar'),raw_startup_command:command,docker_images:minecraftEgg.docker_images,docker_image:image,java_managed:true}};
 if(section==='java')return {attributes:{
  config:{enabled:true,runtime_id:'temurin-21',required_major:21,required_distribution:'temurin',xms_mib:1024,xmx_mib:0,extra_args:''},
  egg:{enabled:true,required_major:21,default_major:21,required_distribution:'temurin',jvm_args:'-XX:+UseG1GC',memory_mode:'auto'},
  runtimes:[{id:'temurin-21',name:'Java 21 (Temurin)',major:21,distribution:'temurin',image,enabled:true},{id:'temurin-17',name:'Java 17 (Temurin)',major:17,distribution:'temurin',image:'ghcr.io/pterodactyl/yolks:java_17',enabled:true}],
  effective:{runtime_id:'temurin-21',image,major:21,xms_mib:1024,xmx_mib:server.limits.memory-1024,reserved_mib:1024,jvm_args:'-XX:+UseG1GC'},can_update:true,can_change_runtime:true,
 }};
 if(section==='configuration'){
  const defaults={config_files:{'server.properties':{parser:'properties',find:{'server-port':'{{server.build.default.port}}'}}},config_startup:{done:'Done ('},config_stop:'stop',script_install:'# Static demo: no installer is connected.\n',script_container:'ghcr.io/pterodactyl/installers:debian',script_entry:'bash'};
  return {attributes:{revision:`demo-config-${server.id}-1`,template:{id:9001,name:'Minecraft Paper',nest_id:9001},managed:true,overrides:{},effective:defaults,defaults,can_update:true,applies:{process:'next_start',installation:'next_install'}}};
 }
 return undefined;
}
