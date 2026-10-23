import fs from 'node:fs';
const catalog=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json')),prior=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json')),profiles={};
const recipes=[['classicube/mcgalaxy/egg-classi-cube--m-g-c.json','mcgalaxy'],['minecraft/java/cuberite/egg-cuberite.json','cuberite'],['minecraft/java/vanillacord/egg-vanilla-cord.json','vanillacord'],['minecraft/crossplay/purpur-geysermc-floodgate/egg-purpur-geyser-floodgate.json','crossplay']];
for(const[path,game]of recipes){
 const original=catalog.entries.find(e=>e.path===path);if(!original)throw Error(path);
 const egg=structuredClone(original.egg),revision=game+'-managed-special-v1',java=['vanillacord','crossplay'].includes(game);
 const add=(key,value,rules,description)=>egg.variables.push({name:key,env_variable:key,default_value:value,rules,description,user_viewable:true,user_editable:true,field_type:'text'});
 const variable=key=>egg.variables.find(v=>v.env_variable===key);
 const role=environment=>({environment,condition:'nonzero',allocated_value:true,exclude_primary:true,minimum:1,maximum:65535,count:2});
 const portRules=[];let required=1,files=JSON.parse(egg.config.files);
 if(java){
  const major=game==='crossplay'?25:21;
  egg.features=[...new Set([...(egg.features||[]),'minecraft'])];
  egg.voltra={java_config:{enabled:true,required_major:game==='crossplay'?25:8,default_major:major,memory_mode:'command',jvm_args:'-Dterminal.jline=false -Dterminal.ansi=false'}};
  egg.docker_images={['Java '+major+' default']:'ghcr.io/pterodactyl/yolks:java_'+major,...egg.docker_images};
  egg.startup='java -Xms128M -jar "{{SERVER_JARFILE}}" nogui';
  variable('SERVER_JARFILE').rules='required|regex:/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,74}\\.jar$/|max:80';
  if(game==='vanillacord'){
   variable('VANILLA_VERSION').default_value='1.21.4';
   variable('VANILLA_VERSION').description='Exact original Mojang server version. Default1.21.4 is reviewed; latest resolves the current Mojang release and may exceed the archived publisher patcher compatibility. Failures never substitute a different version.';
  }else{
   variable('MINECRAFT_VERSION').default_value='26.3';variable('BUILD_NUMBER').default_value='2654';
   add('BEDROCK_PORT','19132','required|integer|between:1,65535','Distinct additional allocation. Bedrock RakNet uses UDP and NetherNet built-in signaling uses TCP.');
   add('WEBRTC_PORT','19133','required|integer|between:1,65535|different:environment.BEDROCK_PORT','Third distinct additional allocation for NetherNet UDP media. Keep separate from Java and BEDROCK_PORT.');
   add('GEYSER_TRANSPORT','both','required|in:raknet,nethernet,both','Both retains legacy RakNet and modern NetherNet. Three allocations stay reserved in every mode.');
   add('DL_PATH','','nullable|url|max:2048','Original installer custom URL control, now visible. Literal PROJECT/version/build/jar placeholders only; requires reviewed DOWNLOAD_SHA256.');
   add('DOWNLOAD_SHA256','','nullable|regex:/^[0-9a-fA-F]{64}$/','Required for an explicit historical Purpur build or custom URL. Reviewed default server and plugins are strongly pinned.');
   required=3;portRules.push(role('BEDROCK_PORT'),role('WEBRTC_PORT'));
   files['plugins/Geyser-Spigot/config.yml']={parser:'yaml',find:{'bedrock.address':'0.0.0.0','bedrock.port':'{{server.build.env.BEDROCK_PORT}}','bedrock.webrtc-port':'{{server.build.env.WEBRTC_PORT}}','bedrock.transport':'{{server.build.env.GEYSER_TRANSPORT}}','java.auth-type':'floodgate'}};
  }
 }else{
  egg.features=[];
  egg.docker_images=game==='mcgalaxy'?{'Pinned publisher Mono runtime':'ghcr.io/ptero-eggs/yolks@sha256:d2e2ecddc65c1db67e756ad232119775f4230db4746ec9dc00e93d17572fcfb6'}:{'Pinned Debian native runtime':'ghcr.io/ptero-eggs/yolks@sha256:d7b83c285632be9c9dd03b909378200c4f4c664035d72ad4b5b694af03dc75ac'};
  if(game==='mcgalaxy'){
   add('PUBLIC_SERVER','false','required|in:true,false','Explicit opt-in to publisher public server-list heartbeat. Private LAN setup is the default; name verification remains enabled.');
   files={'properties/server.properties':{parser:'properties',find:{'server-name':'{{server.build.env.HOSTNAME}}',motd:'{{server.build.env.MOTD}}',public:'{{server.build.env.PUBLIC_SERVER}}',port:'{{server.build.default.port}}'}}};
  }else{
   variable('WEB_PORT').user_editable=true;variable('WEB_PORT').description='Distinct additional same-address allocation for private WebAdmin HTTP. Restrict access to trusted operators or terminate HTTPS externally.';
   variable('ADMIN_PASS').default_value='';variable('ADMIN_PASS').rules='required|string|min:12|max:128|not_regex:/[\\x00-\\x1f\\x7f]/';variable('ADMIN_PASS').description='Operator-chosen private WebAdmin admin password. Stored only in private native webadmin.ini; choose a unique password.';
   variable('SERV_DESC').rules='nullable|string|max:200|not_regex:/[\\x00-\\x1f\\x7f]/';
   required=2;portRules.push(role('WEB_PORT'));files={};egg.startup='python3 .voltra/minecraft_special_runtime.py';
  }
 }
 egg.config={files:JSON.stringify(files),startup:original.egg.config.startup,logs:'{}',stop:original.egg.config.stop};
 let script='#!/bin/bash\nset -euo pipefail\nexport DEBIAN_FRONTEND=noninteractive\napt-get update\napt-get install -y --no-install-recommends python3 ca-certificates'+(game==='vanillacord'?' default-jdk-headless':'')+'\ncd /mnt/server\nmkdir -p .voltra\n';
 for(const[source,target]of[['minecraft-special-runtime.py','minecraft_special_runtime.py'],['native-config.py','native_config.py'],['limbo-install.py','limbo_install.py'],['native-release.py','native_release.py'],['native-zip-release.py','native_zip_release.py'],['minecraft-special-install.py','minecraft_special_install.py'],['minecraft-special-releases.json','minecraft-special-releases.json']])script+=`cat > .voltra/${target} <<'VOLTRA_SPECIAL_SOURCE'\n${fs.readFileSync('internal/panel/game_library/scripts/'+source,'utf8')}\nVOLTRA_SPECIAL_SOURCE\n`;
 script+=`python3 .voltra/minecraft_special_install.py ${game}\n`;
 egg.scripts.installation={script,container:'debian:bookworm-slim',entrypoint:'bash'};
 profiles[path]={upstream_sha256:original.sha256,revision,platforms:['linux/amd64'],defaults:{memory:game==='crossplay'?4096:java?2048:1024,disk:8192},required_ports:required,port_rules:portRules,egg,verification:prior[path]?.revision===revision?prior[path].verification:'not_verified',detail:prior[path]?.revision===revision?prior[path].detail:'Scoped native setup staged; acceptance pending.',setup_steps:[
  game==='mcgalaxy'?'Classic/ClassiCube server using the publisher Mono binary, GPL3 source and license. Native CLI/commands, worlds, ranks, plugins and property controls remain available. Public listing is an explicit choice. The publisher still contacts ClassiCube to obtain an unlisted server URL in private mode.':game==='cuberite'?'Native C++ Cuberite build445 supports Java clients1.8 through1.12.2, not current Minecraft versions. Apache2 publisher plugins/protocol data are seeded once and remain editable.':'Use the shared managed Java settings, files, console, EULA choice, content manager and lifecycle controls. No Microsoft account is created or authenticated by setup.',
  game==='crossplay'?'Pinned Purpur26.3/2654 needs Java25. Pinned Geyser2.12.0/1269 and Floodgate2.2.5/141 support the matching Java protocol. Allocate three distinct numbers: Java TCP, Bedrock TCP+UDP, WebRTC UDP. Bedrock and WebRTC settings must select different allocations.':game==='vanillacord'?'The original publisher binary/Maven hosts are unavailable. Setup builds the exact pinned official VanillaCord and Bridge public MPL2 source, replacing their unpublished placeholder build version with24w25a. Source archives/licenses and build receipts remain in .voltra/minecraft-special.':'Native original name/description/ports and WebAdmin or MOTD controls use editable native configuration through Files and Startup.',
  game==='crossplay'?'Default BOTH supports legacy RakNet and modern NetherNet with built-in signaling. STUN discovery is off for private LAN setup. Configure real advertise addresses/TLS and your own router rules for public access. Floodgate keys, NetherNet identity and operator plugin settings are retained; never publish private key files.':game==='vanillacord'?'Keep online-mode=true and configure the real BungeeCord/BungeeGuard/Velocity forwarding settings and secrets for your network. Native status does not prove a proxy login or authenticated forwarding.':'Private credentials remain in native files and use masked form controls. WebAdmin HTTP should remain on a private trusted network.',
  'Reinstall replaces verified program assets while preserving native worlds, settings, ranks, plugins, EULA and identities. Use native save/stop commands before maintenance. Acceptance reports distinguish status/protocol proof from real client joins or gameplay.',
 ]};
}
fs.mkdirSync('.local/minecraft-special',{recursive:true});fs.writeFileSync('.local/minecraft-special/profiles.json',JSON.stringify(profiles,null,2)+'\n');console.log('Staged four exact Minecraft services.');
