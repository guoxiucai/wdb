'use strict';
// Compare frozen bytes with signed bytes, allowing only Authenticode's excluded
// PE fields/certificate append or an appended PowerShell signature block.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
function sameContent(original,signed){
 const a=fs.readFileSync(original),b=fs.readFileSync(signed);
 if(a.equals(b))return true;
 if(/\.ps[1m]1?$/.test(original)){
  const strip=buffer=>buffer.toString('utf8').split('# SIG # Begin signature block')[0].replace(/[\r\n]+$/,'');
  assert.equal(strip(a),strip(b),'Signed PowerShell content differs from Prepare');return true;
 }
 assert.ok(/\.(exe|dll)$/i.test(original),'Non-signable file changed');
 assert.equal(a.toString('ascii',0,2),'MZ');assert.equal(b.toString('ascii',0,2),'MZ');
 const pe=a.readUInt32LE(60);assert.equal(b.readUInt32LE(60),pe);const opt=pe+24;
 const directory=opt+(a.readUInt16LE(opt)===0x20b?112:96)+4*8;
 const certificate=b.readUInt32LE(directory),length=b.readUInt32LE(directory+4);
 assert.ok(certificate>=a.length&&certificate<=Math.ceil(a.length/8)*8&&certificate+length===b.length,'Only an appended certificate table is accepted');
 assert.ok(b.subarray(a.length,certificate).every(x=>x===0),'Nonzero signature alignment padding');
 const normalized=Buffer.from(b.subarray(0,a.length));a.copy(normalized,opt+64,opt+64,opt+68);a.copy(normalized,directory,directory,directory+8);
 assert.ok(a.equals(normalized),'Signed PE executable content differs from Prepare');return true;
}
if(require.main===module){try{sameContent(process.argv[2],process.argv[3]);}catch(e){console.error(path.basename(process.argv[3])+': '+e.message);process.exitCode=1;}}
module.exports={sameContent};
