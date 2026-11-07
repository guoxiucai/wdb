'use strict';
function checkRuntime() {
  const [major,minor]=process.versions.node.split('.').map(Number);
  if(!/^\d+\.\d+\.\d+$/.test(process.versions.node)||major<18||(major===18&&minor<17)){console.error('WDB_RUNTIME_UNSUPPORTED: '+process.execPath+' is '+process.version+'; required >=18.17.0. Repair the bound runtime; PATH fallback is disabled.');process.exit(78);}
}
module.exports={checkRuntime};
