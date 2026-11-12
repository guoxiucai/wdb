'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {error,client,json,locate}=require('./npm-client');
const PACKAGE='@tsingwill/wdb';
function stable(value){if(typeof value!=='string'||!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value))throw error('UPDATE_METADATA_INVALID','Only stable X.Y.Z releases are supported.');const parts=value.split('.').map(Number);if(parts.some(v=>!Number.isSafeInteger(v)))throw error('UPDATE_METADATA_INVALID','Invalid release version.');return parts;}
function compare(a,b){const x=stable(a),y=stable(b);for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]>y[i]?1:-1;return 0;}
function same(a,b){const normalize=s=>process.platform==='win32'?path.resolve(s).toLowerCase():path.resolve(s);return normalize(a)===normalize(b);}
function installation(root=path.resolve(__dirname,'..')){
 root=fs.realpathSync(root);const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
 const unsupported={supported:false,root,currentVersion:pkg.version,reason:'Use the original installer for server/portable/source/local installations.'};
 if(pkg.name!==PACKAGE||pkg.private||pkg.bin?.wdb!=='bin/wdb.js'||!fs.existsSync(path.join(root,'BUILD-INFO.json')))return unsupported;
 const info=JSON.parse(fs.readFileSync(path.join(root,'BUILD-INFO.json'),'utf8'));if(info.development)return unsupported;
 const modules=path.dirname(path.dirname(root));if(path.basename(modules)!=='node_modules'||path.basename(path.dirname(root))!=='@tsingwill')return unsupported;
 let prefix=path.dirname(modules);if(process.platform!=='win32'){if(path.basename(prefix)!=='lib')return unsupported;prefix=path.dirname(prefix);}
 if(prefix.split(path.sep).includes('_npx')||fs.existsSync(path.join(prefix,'package.json')))return unsupported;
 stable(pkg.version);return {supported:true,root,prefix,currentVersion:pkg.version,pkg};
}
async function inspect({root,npm}={}){
 const install=installation(root);if(!install.supported)return {install,npm,data:{package:PACKAGE,currentVersion:install.currentVersion,state:'unsupported_installation',updated:false,installationType:'unsupported',reason:install.reason}};
 npm ||= client();
 const cwd=os.tmpdir();const actualRoot=(await npm.run(['root','--global','--prefix',install.prefix],{cwd,timeout:30000})).trim();
 if(!same(fs.realpathSync(path.join(actualRoot,PACKAGE)),install.root))throw error('UPDATE_INSTALLATION_UNSUPPORTED','npm global layout does not match the running CLI.');
 const runtime=json(await npm.run(['--versions','--json'],{cwd,timeout:30000}));if(runtime.node!==process.versions.node)throw error('UPDATE_NPM_RUNTIME_MISMATCH','npm uses a different Node runtime. Select the matching Node/npm installation.');
 let registry=(await npm.run(['config','get','@tsingwill:registry'],{cwd,timeout:30000})).trim();if(!registry||registry==='undefined'||registry==='null')registry=(await npm.run(['config','get','registry'],{cwd,timeout:30000})).trim();
 let endpoint;try{endpoint=new URL(registry);}catch{throw error('UPDATE_METADATA_INVALID','Invalid npm registry.');}
 if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||endpoint.search||endpoint.hash)throw error('UPDATE_REGISTRY_UNSUPPORTED','Updates require an HTTPS registry without URL credentials. Use npm authentication configuration.');
 const registryArgs=['--registry',endpoint.href,'--@tsingwill:registry='+endpoint.href];
 const candidate=json(await npm.run(['view',PACKAGE+'@latest','name','version','engines','dist','--json','--prefer-online',...registryArgs],{cwd,timeout:45000}));
 if(candidate.name!==PACKAGE||!/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(candidate.dist?.integrity||''))throw error('UPDATE_METADATA_INVALID','Release identity or SHA512 integrity is missing.');
 const order=compare(candidate.version,install.currentVersion),pathEntry=locate('wdb'),shim=path.join(install.prefix,process.platform==='win32'?'wdb.cmd':'bin/wdb');
 return {install,npm,candidate,registryArgs,data:{package:PACKAGE,currentVersion:install.currentVersion,latestVersion:candidate.version,state:order>0?'update_available':order===0?'up_to_date':'newer_than_release',updateAvailable:order>0,updated:false,installationType:'npm-global',targetPath:install.root,registry:endpoint.href,pathShadowed:!!pathEntry&&!same(pathEntry,shim)}};
}
async function update(options,io,dependencies={}){
 if(options.check&&options.yes)throw error('INVALID_ARGUMENT','--check and --yes cannot be combined.');
 const context=await inspect(dependencies);
 if(options.check||options.json&&!options.yes||!context.install.supported)return context.data;
 if(!context.data.updateAvailable)return context.data;
 throw error('UPDATE_NOT_READY','Update execution is not available yet. Use --check.');
}
module.exports={PACKAGE,stable,compare,same,installation,inspect,update};
