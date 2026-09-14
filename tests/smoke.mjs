import {fork} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {selectKDNA,createKDNAWebClient} from '../src/client.mjs';
const child=fork(new URL('../../host-fixture/server.mjs',import.meta.url),{stdio:['ignore','inherit','inherit','ipc']});
try {
 const {port}=await new Promise(r=>child.once('message',r));
 const selected=await selectKDNA(new Uint8Array(readFileSync(new URL('../../fixtures/valid.kdna',import.meta.url))));
 console.log('selected',JSON.stringify(selected));
 if(selected.status!=='selected')throw Error('not selected');
 const s=selected.selection;
 for(const route of ['valid','deny','failure']){
 const endpointUrl=`http://127.0.0.1:${port}/read/${route}`;
 const request={request_id:'request:legacy',tuple:s.tuple,budget_bytes:1000000,mode:'exact_selection',selection:{asset_id:s.asset.asset_id,asset_version:s.asset.asset_version,judgment_id:'judgment:0'},handle:null};
 const context={association_id:'association:'+route,endpoint_id:'endpoint:legacy',session_id:'session:legacy',endpoint_url:endpointUrl,issued_at_ms:Date.now(),expires_at_ms:Date.now()+60000,outbound_request_json:JSON.stringify(request),correlation:{state:'validated',request_id:request.request_id},expected_tuple:s.tuple,expected_asset:s.asset,expected_digests:Object.fromEntries(['A','C','E'].map(k=>[k,s.digests[k].observed])),expected_snapshot_id:null,max_response_bytes:1000000,max_read_ms:5000,admission_response_limit_bytes:4096};
 const c=createKDNAWebClient({endpointUrl,endpointId:context.endpoint_id,sessionId:context.session_id});
 const result=await c.read(s,context);console.log(route,JSON.stringify(result)); c.dispose();
 }
}finally{child.send('stop');await new Promise(r=>child.once('exit',r));}
