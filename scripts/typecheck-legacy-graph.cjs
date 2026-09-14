'use strict';
const {spawnSync}=require('node:child_process');
if(!process.env.KDNA_TSC_JS)throw Error('KDNA_TSC_JS must name the evidence-pinned TypeScript tool');
const r=spawnSync(process.execPath,[process.env.KDNA_TSC_JS,'--noEmit','--strict','--skipLibCheck','false','--module','NodeNext','--moduleResolution','NodeNext','--target','ES2022','--lib','ES2022,DOM','--ignoreConfig','tests/types.mts','tests/types.cts'],{cwd:require('node:path').resolve(__dirname,'..'),stdio:'inherit'});process.exit(r.status??1);
