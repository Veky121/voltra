import fs from 'node:fs';
const key='americas_army/proving_grounds/egg-america-s-army--proving-grounds.json';
const report=JSON.parse(fs.readFileSync('artifacts/aapg-native-acceptance.json'));
if(report.rows.length!==30||report.native_gameplay_tested!==false)throw Error('Final acceptance receipt missing');
const profile=structuredClone(JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'))[key]);
profile.verification='runtime_partial';
profile.detail='Anonymous Linux build8671920 installed; actual native readiness, assigned game/query UDP sockets and three normal Stop0/noOOM generations observed. Corrected actual AAGame configuration/Cloud/log preservation passed strict45- and49-file API Reinstalls. Original full server name now matches native A2S query after restoring engine quotes; initial truncation evidence retained. AUTH_PORT28005 had no observed listener, native TeamSpeak8765 remains unmapped, and online authentication, client gameplay and embedded quote/backslash name encoding remain unverified. See artifacts/aapg-native-acceptance.json.';
fs.mkdirSync('.local/aapg-native-stage',{recursive:true});fs.writeFileSync('.local/aapg-native-stage/profiles.json',JSON.stringify({[key]:profile},null,2)+'\n');
console.log('Staged AAPG verification/detail only; canonical untouched.');
