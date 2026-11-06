'use strict';
function checkRuntime() {
  const [major,minor]=process.versions.node.split('.').map(Number);
  if(!/^\d+\.\d+\.\d+$/.test(process.versions.node)||major!==24||minor<15){console.error('WDB_RUNTIME_UNSUPPORTED: '+process.execPath+' is '+process.version+'; required >=24.15.0 <25. Repair the bound runtime; PATH fallback is disabled.');process.exit(78);}
}
module.exports={checkRuntime};
