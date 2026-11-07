'use strict';
function parseProgress(text){const result={};for(const line of text.split(/\r?\n/)){const at=line.indexOf('=');if(at>0)result[line.slice(0,at)]=line.slice(at+1);}return result;}
function recordingStats(progress){
 const number=key=>{const raw=progress[key];if(typeof raw!=='string'||!/^\d+(?:\.\d+)?$/.test(raw.trim()))return null;const n=Number(raw);return Number.isFinite(n)&&n>=0?n:null;};
 const micros=number('out_time_us');
 return {source:'ffmpeg-progress',frames:number('frame'),outputDurationSeconds:micros===null?null:micros/1000000,complete:progress.progress==='end'};
}
module.exports={parseProgress,recordingStats};
