import fs from 'node:fs';
const key='openttd/egg-open-t-t-d-server.json';
const all=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'));
const override=structuredClone(all[key]);
const original=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json')).entries.find(e=>e.path===key).egg;
const variable=(name,value,description,rules)=>({...structuredClone(original.variables.find(v=>v.env_variable===name)),default_value:value,description,rules});
override.revision='openttd-15.3-compat-v4';
override.egg.variables=override.egg.variables.filter(v=>!['srv_advertise','OPENTTD_VERSION','OPENGFX_VERSION'].includes(v.env_variable));
override.egg.variables.push(
 variable('srv_advertise','false','Legacy public-list control: true selects public, false selects local when Server visibility is auto. Explicit Server visibility takes precedence.','required|in:true,false'),
 variable('OPENTTD_VERSION','15.3','Exact publisher release, including RC versions. Installation resolves its SHA-256 from the publisher manifest. Other releases need native acceptance; changing this requires reinstall.','required|string|max:40|regex:/^[0-9][0-9A-Za-z.-]*$/'),
 variable('OPENGFX_VERSION','8.0','Exact publisher OpenGFX release, verified through the publisher manifest. Changing this requires reinstall.','required|string|max:40|regex:/^[0-9][0-9A-Za-z.-]*$/'));
const visibility=override.egg.variables.find(v=>v.env_variable==='SERVER_VISIBILITY');
visibility.default_value='auto'; visibility.rules='required|in:auto,local,public,invite-only';
visibility.description='Auto uses legacy srv_advertise; default false keeps LAN/local. Explicit local, public or invite-only overrides the legacy switch. Existing explicit visibility values are retained.';
override.egg.startup='exec sh .voltra/openttd-start.sh';
const files=JSON.parse(override.egg.config.files); delete files['openttd.cfg'].find['network.server_game_type']; override.egg.config.files=JSON.stringify(files);
let install=fs.readFileSync('internal/panel/game_library/scripts/openttd-install.sh','utf8');
const resolver=fs.readFileSync('internal/panel/game_library/scripts/openttd-resolve.sh','utf8');
const launcher=fs.readFileSync('internal/panel/game_library/scripts/openttd-start.sh','utf8');
const setup=`\n${resolver}\nOPENTTD_VERSION=\${OPENTTD_VERSION:-15.3}\nOPENGFX_VERSION=\${OPENGFX_VERSION:-8.0}\nTTD_SHA=$(resolve_release openttd "$OPENTTD_VERSION" "openttd-$OPENTTD_VERSION-linux-generic-amd64.tar.xz" 15.3 f49eb25d61b00f8f4d332fee02b530ad75552d1efb8f2bb01e7ca5e6540fe059)\nGFX_SHA=$(resolve_release opengfx "$OPENGFX_VERSION" "opengfx-$OPENGFX_VERSION-all.zip" 8.0 43a0c1dabf39cb865394f3a6cc36d4da5c10ecfaaf55652043104806810903be)\nmkdir -p .voltra\ncat > .voltra/openttd-start.sh <<'VOLTRA_OPENTTD_START'\n${launcher}\nVOLTRA_OPENTTD_START\n`;
install=install.replace('cd /mnt/server\n','cd /mnt/server\n'+setup);
install=install.replaceAll('openttd-releases/15.3/openttd-15.3-','openttd-releases/${OPENTTD_VERSION}/openttd-${OPENTTD_VERSION}-').replaceAll('opengfx-releases/8.0/opengfx-8.0-','opengfx-releases/${OPENGFX_VERSION}/opengfx-${OPENGFX_VERSION}-');
install=install.replace("printf '%s  %s\\n' f49eb25d61b00f8f4d332fee02b530ad75552d1efb8f2bb01e7ca5e6540fe059", "printf '%s  %s\\n' \"$TTD_SHA\"").replace("printf '%s  %s\\n' 43a0c1dabf39cb865394f3a6cc36d4da5c10ecfaaf55652043104806810903be", "printf '%s  %s\\n' \"$GFX_SHA\"");
install=install.replaceAll('curl --fail --location --retry 3','curl --fail --location --proto \'=https\' --proto-redir \'=https\' --max-time 300 --retry 3');
install=install.replace("echo 'OpenTTD 15.3 and OpenGFX 8.0 installed with verified checksums.'",'echo "OpenTTD $OPENTTD_VERSION and OpenGFX $OPENGFX_VERSION installed with verified checksums."');
override.egg.scripts.installation.script=install;
fs.mkdirSync('.local/openttd-compat',{recursive:true});
fs.writeFileSync('.local/openttd-compat/profiles.json',JSON.stringify({[key]:override},null,2)+'\n');
console.log('Staged OpenTTD compatibility profile; no overrides changed.');
