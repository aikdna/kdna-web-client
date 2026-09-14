const {test}=require('node:test');
const assert=require('node:assert/strict');
const {fork}=require('node:child_process');
const {mkdirSync,writeFileSync}=require('node:fs');
const {resolve}=require('node:path');
test('public source client over actual HTTP, independent Host process',async()=>{
 const child=fork(resolve(__dirname,'../../host-fixture/server.mjs'),{stdio:['ignore','inherit','inherit','ipc']});
 try {
  const {port}=await new Promise((r,j)=>{child.once('message',r);child.once('error',j);});
  const {runMatrix}=await import('./matrix.mjs');
  const result=await runMatrix(require('../src/client.cjs'),`http://127.0.0.1:${port}`);
  const p=process.env.KDNA_HOST_EVIDENCE;mkdirSync(p,{recursive:true});writeFileSync(resolve(p,'matrix.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify({total:result.total,passed:result.passed,failures:result.rows.filter(x=>!x.pass)}));assert.equal(result.failed,0);
 }finally{child.send('stop');await new Promise(r=>child.once('exit',r));}
});
