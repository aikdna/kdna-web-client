'use strict';
const {resolve,join,dirname}=require('node:path'),{spawnSync}=require('node:child_process');
const tsc=process.argv[2]?resolve(process.argv[2]):join(dirname(require.resolve('typescript/package.json')),'lib','tsc.js');
const r=spawnSync(process.execPath,[tsc,'--noEmit','--ignoreConfig','--strict','--module','NodeNext','--moduleResolution','NodeNext','--target','ES2022','--lib','ES2022,DOM','tests/components/public-types.mts','tests/components/public-types.cts'],{cwd:resolve(__dirname,'..'),stdio:'inherit'});process.exit(r.status??1);
