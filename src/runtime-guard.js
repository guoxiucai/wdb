'use strict';
function checkRuntime() {
  const [major]=process.versions.node.split('.').map(Number);
  if(!/^\d+\.\d+\.\d+$/.test(process.versions.node)||major<22){console.error('WDB_RUNTIME_UNSUPPORTED: '+process.execPath+' is '+process.version+'; required >=22.0.0. Repair the bound runtime; PATH fallback is disabled.');process.exit(78);}
}
module.exports={checkRuntime};
