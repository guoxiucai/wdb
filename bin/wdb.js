#!/usr/bin/env node
'use strict';
// Keep this bootstrap parseable on older Node versions: fail before loading CLI.
const version = process.versions.node.split('.').map(Number);
if (version[0] !== 24 || version[1] < 15) {
  const error = {code:'UNSUPPORTED_NODE',message:'WDB requires Node >=24.15.0 <25; current '+process.version+'. Install Node 24 LTS from https://nodejs.org/.'};
  if (process.argv.includes('--json') || process.argv.includes('--json=true')) process.stdout.write(JSON.stringify({requestId:null,taskId:null,deviceId:null,status:'failed',durationMs:0,artifacts:[],data:null,error})+'\n');
  else process.stderr.write(error.code+': '+error.message+'\n');
  process.exitCode=1;
} else {
  require('../src/cli').main().then(code=>{process.exitCode=code;}).catch(error=>{process.stderr.write('CLIENT_ERROR: '+error.message+'\n');process.exitCode=1;});
}
