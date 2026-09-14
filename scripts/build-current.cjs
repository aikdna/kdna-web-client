'use strict';
const {resolve}=require('node:path'),{mkdirSync,writeFileSync}=require('node:fs');
const tool=process.argv[2]?require(resolve(process.argv[2])):require('esbuild');
(async()=>{const out=resolve(__dirname,'../dist/components');mkdirSync(out,{recursive:true});const r=await tool.build({entryPoints:[resolve(__dirname,'../src/client.mjs')],bundle:true,platform:'browser',format:'iife',globalName:'KDNAWebClient',outfile:resolve(out,'client.js'),metafile:true});writeFileSync(resolve(out,'metafile.json'),JSON.stringify(r.metafile,null,2)+'\n');})().catch(e=>{console.error(e);process.exitCode=1});
