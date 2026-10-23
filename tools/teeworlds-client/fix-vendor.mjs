import fs from 'node:fs';import {fileURLToPath} from 'node:url';import path from 'node:path';
const root=path.dirname(fileURLToPath(import.meta.url)),base=path.join(root,'vendor/github.com/teeworlds-go/protocol');
function change(text,before,after,count=1){
 const matches=text.split(before).length-1;
 if(matches===count)return text.replaceAll(before,after);
 if(matches===0&&text.split(after).length-1>=count)return text;
 throw Error('Pinned dependency patch anchor changed');
}
function edit(file,apply,notice){
 const target=path.join(base,file);let text=fs.readFileSync(target,'utf8').replaceAll('\r\n','\n');
 text=apply(text);if(!text.includes(notice))text=notice+'\n'+text;
 fs.writeFileSync(target,text);
}
edit('teeworlds7/system.go',text=>change(change(text,'client.SnapshotStorage.CurrentRecvTick < msg.GameTick','client.SnapshotStorage.CurrentRecvTick > msg.GameTick',3),'client.SnapshotStorage.SnapshotParts != msg.NumParts-1','client.SnapshotStorage.SnapshotParts != (1<<msg.NumParts)-1'),'// Voltra alterations: reject older snapshot ticks and compare complete part masks.');
edit('chunk7/chunk.go',text=>{
 for(const [before,after]of [
  ['((byte(header.Size) >> 6) & 0x3f)','byte((header.Size>>6)&0x3f)'],
  ['(byte(header.Seq) >> 2) & 0xc0','byte((header.Seq >> 2) & 0xc0)'],
  ['int((data[1]&0xC0)<<2)','(int(data[1]&0xC0) << 2)'],
 ])text=change(text,before,after,before.startsWith('int(')?2:1);
 return text;
},'// Voltra alteration: preserve high size and sequence bits before byte conversion.');
edit('teeworlds7/packet.go',text=>change(text,'\t\tclient.Session.Ack++',`\t\t// Voltra alteration: acknowledge reliable sequence numbers once. Repeated
\t\t// chunks must not advance ACK; request missing chunks before later ones.
\t\texpected := (client.Session.Ack + 1) & 1023
\t\tsequence := msg.Header().Seq
\t\tif sequence != expected {
\t\t\tif (sequence-expected+1024)&1023 < 512 {
\t\t\t\tresponse.Header.Flags.Resend = true
\t\t\t}
\t\t\treturn false, nil
\t\t}
\t\tclient.Session.Ack = sequence`),'// Voltra alteration: handle duplicate and out-of-order reliable chunks.');
for(const [folder,name]of [['chunk7','voltra_width_test.go'],['teeworlds7','voltra_snapshot_age_test.go'],['teeworlds7','voltra_reliable_test.go']])fs.copyFileSync(path.join(root,'regressions',name+'.txt'),path.join(base,folder,name));
console.log('Pinned development-probe fixes and regression tests applied.');
