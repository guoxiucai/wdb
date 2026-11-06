'use strict';
const crypto=require('node:crypto');
const LEGACY_UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function newDeviceId(){return crypto.randomBytes(8).toString('hex');}
function normalizeDeviceId(value){
 if(typeof value!=='string')return value;
 if(LEGACY_UUID.test(value))return crypto.createHash('sha256').update('wdb-device-id-v1:'+value.toLowerCase()).digest('hex').slice(0,16);
 return /^[a-f0-9]{16}$/i.test(value)?value.toLowerCase():value;
}
module.exports={newDeviceId,normalizeDeviceId};
