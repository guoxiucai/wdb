'use strict';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),crypto=require('node:crypto');
const {error}=require('./npm-client'),{safeRelative,bundle}=require('./update-skills');
function unpack(file,destination,expected){
 if(fs.statSync(file).size>8*1024*1024)throw error('UPDATE_PACKAGE_INVALID','Package exceeds update size limit.');const bytes=fs.readFileSync(file);if('sha512-'+crypto.createHash('sha512').update(bytes).digest('base64')!==expected.integrity)throw error('UPDATE_INTEGRITY_MISMATCH','Downloaded package differs from the confirmed release.');
 const tar=zlib.gunzipSync(bytes,{maxOutputLength:16*1024*1024}),entries=new Map(),names=new Set();
 for(let offset=0;offset+512<=tar.length;){const header=tar.subarray(offset,offset+512);if(header.every(b=>b===0))break;const str=(a,b)=>header.subarray(a,b).toString('utf8').replace(/\0.*$/s,'');const name=(str(345,500)?str(345,500)+'/':'')+str(0,100),size=parseInt(str(124,136).trim(),8),type=str(156,157),relative=name.slice(8);
  if(!name.startsWith('package/')||!safeRelative(relative)||!['0',''].includes(type)||!Number.isSafeInteger(size)||size<0||offset+512+size>tar.length||names.has(relative.toLowerCase()))throw error('UPDATE_PACKAGE_INVALID','Unsafe package archive.');
  names.add(relative.toLowerCase());entries.set(relative,tar.subarray(offset+512,offset+512+size));offset+=512+Math.ceil(size/512)*512;
 }
 let pkg;try{pkg=JSON.parse(entries.get('package.json'));}catch{throw error('UPDATE_PACKAGE_INVALID','Package metadata is missing.');}
 if(pkg.name!=='@tsingwill/wdb'||pkg.version!==expected.version||pkg.private||pkg.bin?.wdb!=='bin/wdb.js'||Object.keys(pkg.scripts||{}).length||!entries.has('bin/wdb.js'))throw error('UPDATE_PACKAGE_INVALID','Candidate is not the confirmed npm CLI.');
 fs.mkdirSync(destination,{recursive:true,mode:0o700});for(const [relative,data] of entries){const out=path.join(destination,...relative.split('/'));fs.mkdirSync(path.dirname(out),{recursive:true,mode:0o700});fs.writeFileSync(out,data,{flag:'wx',mode:0o600});}
 bundle(destination);return pkg;
}
module.exports={unpack};
