import fs from 'node:fs';
let watch=fs.readFileSync('tools/runtime/craftopia-native-watch.mjs','utf8').replaceAll('craftopia-native','mordhau-native').replaceAll('World is loaded!','Session GameSession successfully created');
fs.writeFileSync('tools/runtime/mordhau-native-watch.mjs',watch,{flag:'wx'});
let live=fs.readFileSync('tools/runtime/mordhau-native-live.mjs','utf8').replace("'Mordhau.x86_64'in argv[0]","'MordhauServer-Linux-Shipping'in argv[0]").replace("['DedicatedServerSave','PPSave','.config','.local/share','BepInEx','mods']","['Mordhau/Saved','.config','.local/share','mods']");
fs.writeFileSync('tools/runtime/mordhau-native-live.mjs',live);
let pre=fs.readFileSync('tools/runtime/battalion-native-preboot.mjs','utf8').replaceAll('battalion-native','mordhau-native').replaceAll('Battalion/Binaries/Linux/BattalionServer-Linux-Shipping','Mordhau/Binaries/Linux/MordhauServer-Linux-Shipping').replaceAll('BattalionServer/BattalionServer.sh','MordhauServer.sh');
fs.writeFileSync('tools/runtime/mordhau-native-preboot.mjs',pre,{flag:'wx'});
