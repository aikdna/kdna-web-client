import * as api from '@aikdna/kdna-web-client';
export {api};
export async function immediateLifecycle(base,bytes){
 const rows=[];let serial=0;
 const assert=(v,m)=>{if(!v)throw Error(m);};
 function context(s,route){const request={request_id:'request:lifecycle',tuple:s.tuple,budget_bytes:1000000,mode:'exact_selection',selection:{asset_id:s.asset.asset_id,asset_version:s.asset.asset_version,judgment_id:'judgment:0'},handle:null};return{association_id:'association:lifecycle:'+Date.now()+':'+(++serial),endpoint_id:'endpoint:lifecycle',session_id:'session:lifecycle',endpoint_url:base+'/read/'+route,issued_at_ms:Date.now(),expires_at_ms:Date.now()+60000,outbound_request_json:JSON.stringify(request),correlation:{state:'validated',request_id:request.request_id},expected_tuple:s.tuple,expected_asset:s.asset,expected_digests:Object.fromEntries(['A','C','E'].map(k=>[k,s.digests[k].observed])),expected_snapshot_id:null,max_response_bytes:1000000,max_read_ms:5000,admission_response_limit_bytes:4096};}
 for(const mode of ['pre-abort','same-stack-abort','same-stack-release','same-stack-dispose']){
  for(let i=0;i<20;i++){
   const selection=(await api.selectKDNA(bytes)).selection,ctx=context(selection,'delay');const c=api.createKDNAWebClient({endpointUrl:ctx.endpoint_url,endpointId:ctx.endpoint_id,sessionId:ctx.session_id});const ac=new AbortController();if(mode==='pre-abort')ac.abort();const pending=c.read(selection,ctx,{signal:ac.signal});if(mode.endsWith('abort'))ac.abort();if(mode.endsWith('release'))api.releaseKDNASelection(selection);if(mode.endsWith('dispose'))c.dispose();const r=await pending;
   const expected=mode.endsWith('release')?'CLIENT_SELECTION_RELEASED':mode.endsWith('dispose')?'CLIENT_DISPOSED':'CLIENT_CANCELLED';assert(r.code===expected,mode+':'+r.code);assert(r.view===null,'late view');c.dispose();api.releaseKDNASelection(selection);rows.push({mode,iteration:i,code:r.code,pass:true});
  }
 }
 for(const mode of ['in-flight-abort','in-flight-release','in-flight-timeout']){
  let signalResponse;const receivedHeaders=new Promise(r=>signalResponse=r);const s=(await api.selectKDNA(bytes)).selection,ctx=context(s,'body-delay');let fetchSignal;
  const c=api.createKDNAWebClient({endpointUrl:ctx.endpoint_url,endpointId:ctx.endpoint_id,sessionId:ctx.session_id,timeoutMs:mode.endsWith('timeout')?100:5000,fetch:async(url,init)=>{fetchSignal=init.signal;const response=await fetch(url,init);signalResponse();return response;}});const ac=new AbortController();const pending=c.read(s,ctx,{signal:ac.signal});await receivedHeaders;
  if(mode.endsWith('abort'))ac.abort();if(mode.endsWith('release'))api.releaseKDNASelection(s);const r=await pending;const expected=mode.endsWith('abort')?'CLIENT_CANCELLED':mode.endsWith('release')?'CLIENT_SELECTION_RELEASED':'CLIENT_TIMEOUT';assert(r.code===expected,mode+':'+r.code);assert(fetchSignal.aborted,'native Fetch not aborted');assert(r.view===null,'unexpected view');c.dispose();api.releaseKDNASelection(s);rows.push({mode,code:r.code,nativeSignalAborted:fetchSignal.aborted,receivedActualHTTPHeaders:true,pass:true});
 }
 return {total:rows.length,passed:rows.length,rows};
}
