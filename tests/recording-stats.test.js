'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{execFileSync}=require('node:child_process');
const {parseProgress,recordingStats}=require('../src/recording-stats');const {checkRecording}=require('../scripts/check-recording');
test('recording progress uses final measured counters and leaves missing/invalid values unknown',()=>{
 const p=parseProgress('frame=1\r\nout_time_us=12\r\nprogress=continue\r\nframe=45\nout_time_us=3000000\nprogress=end\n');
 assert.deepEqual(recordingStats(p),{source:'ffmpeg-progress',frames:45,outputDurationSeconds:3,complete:true});
 assert.deepEqual(recordingStats({frame:'N/A',out_time_us:'Infinity'}),{source:'ffmpeg-progress',frames:null,outputDurationSeconds:null,complete:false});
});
const ffmpeg=path.resolve(__dirname,'../.runtime/ffmpeg/ffmpeg.exe');
test('FFmpeg-only verification decodes a real MP4 and rejects truncation and wrong codec',{skip:process.platform!=='win32'||!fs.existsSync(ffmpeg)},t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wdb-record-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const video=path.join(dir,'video.mp4');
 const make=codec=>execFileSync(ffmpeg,['-v','error','-f','lavfi','-i','testsrc2=size=320x240:rate=15','-t','1','-c:v',codec,'-y',video],{windowsHide:true});
 make('libx264');const r=checkRecording(ffmpeg,video,dir);assert.equal(r.frames,15);assert.equal(r.width,320);assert.equal(r.height,240);assert.ok(r.durationSeconds>=0.9);
 fs.truncateSync(video,80);assert.throws(()=>checkRecording(ffmpeg,video,dir));
 make('mpeg4');assert.throws(()=>checkRecording(ffmpeg,video,dir));
});
