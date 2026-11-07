'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const {parseProgress,recordingStats}=require('../src/recording-stats');
function checkRecording(ffmpeg,file,output){
 const run=args=>execFileSync(ffmpeg,args,{encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:1024*1024});
 const text=run(['-v','error','-nostats','-xerror','-err_detect','explode','-i',file,'-map','0:v:0','-progress','pipe:1','-f','null','-']);
 const stats=recordingStats(parseProgress(text));assert.equal(stats.complete,true,'decode must reach EOF');assert.ok(stats.frames>0,'decoded frames required');
 // This filter accepts H.264 input; do not infer codec from the recording settings.
 run(['-v','error','-xerror','-i',file,'-map','0:v:0','-c:v','copy','-bsf:v','h264_mp4toannexb','-f','h264','-y',process.platform==='win32'?'NUL':'/dev/null']);
 const frame=path.join(output,'frame.png');run(['-v','error','-i',file,'-frames:v','1','-y',frame]);const png=fs.readFileSync(frame);
 assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
 return {file,bytes:fs.statSync(file).size,durationSeconds:stats.outputDurationSeconds,frames:stats.frames,width:png.readUInt32BE(16),height:png.readUInt32BE(20),codec:'h264',verification:'ffmpeg-full-decode-and-h264-bitstream',decoded:true,visualFrame:frame};
}
module.exports={checkRecording};
