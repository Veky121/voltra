import assert from 'node:assert/strict';
export function decodeSoldatDownload(data, expectedPath) {
 assert(/^maps\/[A-Za-z0-9_-]+\.(pms|PMS)$/.test(expectedPath),'Only reviewed map file paths');
 const start=Buffer.from('STARTFILES\r\n'),end=Buffer.from('ENDFILES\r\n');assert(data.subarray(0,start.length).equals(start),'Native transfer header');
 let offset=start.length;assert(data.length>=offset+4);const overall=data.readUInt32LE(offset);offset+=4;
 const newline=data.indexOf(Buffer.from('\r\n'),offset);assert(newline>=offset&&newline-offset<256,'Bounded native path');assert.equal(data.subarray(offset,newline).toString('utf8'),expectedPath);offset=newline+2;assert(data.length>=offset+4);const size=data.readUInt32LE(offset);offset+=4;assert(size<=4*1024**2&&data.length>=offset+size,'Bounded complete map payload');const body=data.subarray(offset,offset+size),trailer=data.subarray(offset+size);assert(trailer.indexOf(end)>=0,'Native transfer terminator');return{overall_bytes:overall,file_bytes:size,body};
}
