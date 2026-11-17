'use strict';
const {ffmpegPath}=require('./recording-backends');
let cached,pending,expires=0;
async function capabilities(ctx){
 if(cached&&Date.now()<expires)return cached;
 if(pending)return pending;
 pending=(async()=>{const native=await require('./recording-native').probe(ctx);cached={defaultBackend:'native',audio:false,backends:{native,ffmpeg:{available:!!ffmpegPath()}}};expires=Date.now()+5000;return cached;})();
 try{return await pending;}finally{pending=null;}
}
module.exports={capabilities};
