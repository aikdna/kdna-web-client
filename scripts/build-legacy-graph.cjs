'use strict';
const {mkdirSync,writeFileSync}=require('node:fs');
const {resolve}=require('node:path');
if(!process.env.KDNA_ESBUILD_MODULE)throw Error('KDNA_ESBUILD_MODULE must name the evidence-pinned build tool');
const esbuild=require(process.env.KDNA_ESBUILD_MODULE);
(async()=>{mkdirSync(resolve(__dirname,'../dist'),{recursive:true});const r=await esbuild.build({entryPoints:[resolve(__dirname,'../src/client.mjs')],bundle:true,platform:'browser',format:'iife',globalName:'KDNAWebClient',outfile:resolve(__dirname,'../dist/client.js'),metafile:true});writeFileSync(resolve(__dirname,'../dist/metafile.json'),JSON.stringify(r.metafile,null,2));})();
