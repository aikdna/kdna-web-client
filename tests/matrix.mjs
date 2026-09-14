// D-authored consumer matrix, shared across actual Node/Chrome/WebKit; no transport oracle imports.
export async function runMatrix(api, base) {
 const rows=[]; let serial=0;
 const eq=(actual,expected)=>{if(actual!==expected)throw Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);};
 const ok=(value,message='assertion failed')=>{if(!value)throw Error(message);};
 async function test(name,fn) {const start=performance.now();try {const detail=await fn();rows.push({name,pass:true,ms:performance.now()-start,detail:detail??null});}catch(e){rows.push({name,pass:false,ms:performance.now()-start,error:String(e),stack:e.stack});}}
 const bytes=new Uint8Array(await (await fetch(base+'/fixture.kdna')).arrayBuffer());
 const selection=(await api.selectKDNA(bytes)).selection;ok(selection,'fixture rejected by public Core');
 function config(route='valid',extra={}){return {endpointUrl:base+'/read/'+route,endpointId:'endpoint:legacy',sessionId:'session:legacy',...extra};}
 function context(route='valid',requestOverrides={},extra={}){
  const request={request_id:'request:legacy',tuple:selection.tuple,budget_bytes:1000000,mode:'exact_selection',selection:{asset_id:selection.asset.asset_id,asset_version:selection.asset.asset_version,judgment_id:'judgment:0'},handle:null,...requestOverrides};
  return {association_id:'association:legacy:'+Date.now()+':'+(++serial),endpoint_id:'endpoint:legacy',session_id:'session:legacy',endpoint_url:config(route).endpointUrl,issued_at_ms:Date.now(),expires_at_ms:Date.now()+60000,outbound_request_json:JSON.stringify(request),correlation:{state:'validated',request_id:request.request_id},expected_tuple:selection.tuple,expected_asset:selection.asset,expected_digests:Object.fromEntries(['A','C','E'].map(k=>[k,selection.digests[k].observed])),expected_snapshot_id:null,max_response_bytes:1000000,max_read_ms:5000,admission_response_limit_bytes:4096,...extra};
 }
 async function read(route='valid',overrides={},extra={},options={}) {const c=api.createKDNAWebClient(config(route,options));try{return await c.read(selection,context(route,overrides,extra));}finally{c.dispose();}}
 function received(r,channel){eq(r.status,'received');eq(r.view.response.channel,channel);eq(r.view.response,r.admission.response);eq(r.view.origin,'remote');eq(r.view.proof_limits,r.admission.proof_limits);ok(Object.values(r.view.capabilities).every(v=>v===false));eq(r.view.proof_limits.remote_authorization,'NOT_PROVEN');ok(Object.isFrozen(r.view.response));return {channel,http:r.view.response.http_status,bytes:r.view.response.byte_length};}
 function rejected(r,code){eq(r.code,code);ok(r.status==='rejected'||r.status==='failed');eq(r.view,null);return {status:r.status,code:r.code};}
 await test('selection arraybuffer',async()=>eq((await api.selectKDNA(bytes.buffer)).status,'selected'));
 await test('selection file and name',async()=>{const r=await api.selectKDNA(new File([bytes],'own.kdna'));eq(r.status,'selected');eq(r.selection.fileName,'own.kdna');api.releaseKDNASelection(r.selection);});
 await test('selection blob',async()=>{const r=await api.selectKDNA(new Blob([bytes]));eq(r.status,'selected');api.releaseKDNASelection(r.selection);});
 await test('selection exact byte limit',async()=>eq((await api.selectKDNA(bytes,{maxFileBytes:bytes.length})).status,'selected'));
 await test('selection limit minus one',async()=>eq((await api.selectKDNA(bytes,{maxFileBytes:bytes.length-1})).code,'CLIENT_FILE_TOO_LARGE'));
 await test('selection unsupported object',async()=>eq((await api.selectKDNA({arrayBuffer:()=>bytes.buffer})).code,'CLIENT_FILE_REQUIRED'));
 await test('selection malformed Core rejection',async()=>eq((await api.selectKDNA(new Uint8Array([1,2,3]))).status,'rejected'));
 await test('selection encrypted Core rejection',async()=>{const b=await(await fetch(base+'/encrypted.kdna')).arrayBuffer();eq((await api.selectKDNA(b)).status,'rejected');});
 await test('selection invalid size option',async()=>{let error;try{await api.selectKDNA(bytes,{maxFileBytes:Infinity});}catch(e){error=e;}ok(error instanceof TypeError);});
 let responseBytes;
 await test('legal ready envelope and public remote view',async()=>{const r=await read();const d=received(r,'read_envelope');eq(r.view.response.body.status,'ready');ok(!JSON.stringify(r.view.response.body.content).includes('RESULT_SENTINEL_1'));responseBytes=d.bytes;return d;});
 await test('legal denied envelope remains denied',async()=>{const r=await read('deny');const d=received(r,'read_envelope');eq(r.view.response.body.status,'rejected');eq(r.view.response.body.content,null);return d;});
 await test('legal admission rejection',async()=>received(await read('valid',{unknown:true}),'admission_rejection'));
 await test('legal no body control',async()=>{const r=await read('valid',{budget_bytes:0});const d=received(r,'no_body_control');eq(r.view.response.body,null);eq(r.view.response.byte_length,0);return d;});
 await test('legal transport failure is not ready',async()=>received(await read('failure'),'transport_failure'));
 await test('legal catalog',async()=>{const r=await read('valid',{mode:'catalog',selection:null});const d=received(r,'read_envelope');eq(r.view.response.body.content.closure.length,0);eq(r.view.response.body.content.catalog.length,2);return d;});
 await test('local endpoint binding mismatch',async()=>rejected(await read('valid',{}, {endpoint_url:base+'/read/deny'}),'CLIENT_CONTEXT_MISMATCH'));
 await test('local session binding mismatch',async()=>rejected(await read('valid',{}, {session_id:'session:wrong'}),'CLIENT_CONTEXT_MISMATCH'));
 await test('local endpoint id mismatch',async()=>rejected(await read('valid',{}, {endpoint_id:'endpoint:wrong'}),'CLIENT_CONTEXT_MISMATCH'));
 await test('local selected asset mismatch',async()=>rejected(await read('valid',{}, {expected_asset:{...selection.asset,asset_id:'asset:other'}}),'CLIENT_SELECTION_MISMATCH'));
 await test('local selected digest mismatch',async()=>rejected(await read('valid',{}, {expected_digests:{A:'sha256:'+'0'.repeat(64),C:selection.digests.C.observed,E:selection.digests.E.observed}}),'CLIENT_SELECTION_MISMATCH'));
 await test('local selected tuple mismatch',async()=>rejected(await read('valid',{}, {expected_tuple:{...selection.tuple,read:'kdna.read/9.0.0'}}),'CLIENT_SELECTION_MISMATCH'));
 await test('official correlation mismatch',async()=>rejected(await read('valid',{}, {correlation:{state:'validated',request_id:'request:other'}}),'READ_TRANSPORT_CONTEXT_INVALID'));
 await test('official stale association',async()=>rejected(await read('valid',{}, {issued_at_ms:Date.now()-10000,expires_at_ms:Date.now()-1}),'READ_TRANSPORT_ASSOCIATION_STALE'));
 await test('official future association',async()=>rejected(await read('valid',{}, {issued_at_ms:Date.now()+10000}),'READ_TRANSPORT_ASSOCIATION_STALE'));
 for(const route of ['status','type','channel','code','no-body-extra'])await test('HTTP '+route,async()=>rejected(await read(route),'READ_TRANSPORT_HTTP_MISMATCH'));
 for(const route of ['session','request-header','request-body','asset','selection','digest','snapshot','handle'])await test('remote binding '+route,async()=>rejected(await read(route),'READ_TRANSPORT_BINDING_MISMATCH'));
 for(const route of ['json','utf8','duplicate-key'])await test('JSON '+route,async()=>rejected(await read(route),'READ_TRANSPORT_JSON_INVALID'));
 for(const route of ['schema','failure-invalid'])await test('schema '+route,async()=>rejected(await read(route),'READ_TRANSPORT_SCHEMA_INVALID'));
 await test('byte boundary fixture seed',async()=>{const r=await read('limit-seed');responseBytes=r.view.response.byte_length;return received(r,'read_envelope');});
 await test('response max bytes exact',async()=>received(await read('limit-exact',{}, {max_response_bytes:responseBytes}),'read_envelope'));
 await test('response max bytes minus one',async()=>rejected(await read('limit-minus',{}, {max_response_bytes:responseBytes-1}),'READ_TRANSPORT_LIMIT_EXCEEDED'));
 await test('chunked response exact',async()=>received(await read('limit-stream',{}, {max_response_bytes:responseBytes}),'read_envelope'));
 await test('chunked over limit',async()=>rejected(await read('limit-over',{}, {max_response_bytes:responseBytes}),'READ_TRANSPORT_LIMIT_EXCEEDED'));
 await test('official body timeout',async()=>rejected(await read('body-delay',{}, {max_read_ms:30}),'READ_TRANSPORT_TIMEOUT'));
 await test('client overall timeout',async()=>rejected(await read('delay',{}, {},{timeoutMs:30}),'CLIENT_TIMEOUT'));
 await test('duplicate association once',async()=>{const c=api.createKDNAWebClient(config());try{const ctx=context();received(await c.read(selection,ctx),'read_envelope');return rejected(await c.read(selection,ctx),'READ_TRANSPORT_ASSOCIATION_REPLAYED');}finally{c.dispose();}});
 await test('pre-abort no fetch',async()=>{let calls=0;const c=api.createKDNAWebClient(config('valid',{fetch:()=>{calls++;throw Error('unexpected');}}));try{const r=await c.read(selection,context(),{signal:AbortSignal.abort()});eq(calls,0);return rejected(r,'CLIENT_CANCELLED');}finally{c.dispose();}});
 await test('abort in flight',async()=>{const c=api.createKDNAWebClient(config('delay'));const ac=new AbortController();try{const pending=c.read(selection,context('delay'),{signal:ac.signal});setTimeout(()=>ac.abort(),20);return rejected(await pending,'CLIENT_CANCELLED');}finally{c.dispose();}});
 await test('dispose in flight and repeated',async()=>{const c=api.createKDNAWebClient(config('delay'));const p=c.read(selection,context('delay'));setTimeout(()=>c.dispose(),20);rejected(await p,'CLIENT_DISPOSED');c.dispose();return rejected(await c.read(selection,context('delay')),'CLIENT_DISPOSED');});
 await test('release selection in flight',async()=>{const s=(await api.selectKDNA(bytes)).selection;const c=api.createKDNAWebClient(config('delay'));try{const p=c.read(s,context('delay'));setTimeout(()=>api.releaseKDNASelection(s),20);return rejected(await p,'CLIENT_SELECTION_RELEASED');}finally{c.dispose();}});
 await test('forged selection no fetch',async()=>{const c=api.createKDNAWebClient(config());try{return rejected(await c.read({...selection},context()),'CLIENT_SELECTION_INVALID');}finally{c.dispose();}});
 await test('concurrency cap and recovery',async()=>{const c=api.createKDNAWebClient(config('delay',{maxConcurrentRequests:1}));try{const p=c.read(selection,context('delay'));rejected(await c.read(selection,context('delay')),'CLIENT_BUSY');received(await p,'read_envelope');return received(await c.read(selection,context('delay')),'read_envelope');}finally{c.dispose();}});
 await test('late ignored-abort response is never published',async()=>{let finished=false;const c=api.createKDNAWebClient(config('valid',{timeoutMs:20,fetch:async(url,init)=>{const response=await fetch(url,{...init,signal:undefined});await new Promise(r=>setTimeout(r,100));finished=true;return response;}}));try{const r=await c.read(selection,context());rejected(r,'CLIENT_TIMEOUT');await new Promise(r=>setTimeout(r,150));ok(finished);eq(r.view,null);return {lateFetchFinished:finished,published:false};}finally{c.dispose();}});
 await test('network errors sanitized',async()=>{const c=api.createKDNAWebClient(config('valid',{fetch:async()=>{throw Error('SECRET_TOKEN_RAW_BODY');}}));try{const r=await c.read(selection,context());ok(!JSON.stringify(r).includes('SECRET'));return rejected(r,'CLIENT_NETWORK_ERROR');}finally{c.dispose();}});
 await test('request upper bound before fetch',async()=>rejected(await read('valid',{}, {outbound_request_json:' '.repeat(65537)}),'CLIENT_REQUEST_INVALID'));
 await test('read after selection release',async()=>{const s=(await api.selectKDNA(bytes)).selection;api.releaseKDNASelection(s);api.releaseKDNASelection(s);const c=api.createKDNAWebClient(config());try{return rejected(await c.read(s,context()),'CLIENT_SELECTION_INVALID');}finally{c.dispose();}});
 await test('selection captures input bytes',async()=>{const input=bytes.slice(),s=(await api.selectKDNA(input)).selection;input.fill(0);const c=api.createKDNAWebClient(config());try{return received(await c.read(s,context()),'read_envelope');}finally{c.dispose();api.releaseKDNASelection(s);}});
 await test('invalid AbortSignal rejected without retained work',async()=>{const c=api.createKDNAWebClient(config());try{return rejected(await c.read(selection,context(),{signal:{}}),'CLIENT_SIGNAL_INVALID');}finally{c.dispose();}});
 await test('ignored abort retains concurrency slot until settlement',async()=>{
  let settle;const c=api.createKDNAWebClient(config('valid',{timeoutMs:10,maxConcurrentRequests:1,fetch:()=>new Promise(r=>{settle=r;})}));
  try{rejected(await c.read(selection,context()),'CLIENT_TIMEOUT');rejected(await c.read(selection,context()),'CLIENT_BUSY');settle(new Response(null));await new Promise(r=>setTimeout(r,0));return {bounded:true};}finally{c.dispose();}
 });
 await test('invalid endpoint configuration',async()=>{for(const endpointUrl of ['https://user:pass@example.invalid/','file:///tmp/x',base+'/read/valid#fragment']){let threw=false;try{api.createKDNAWebClient(config('valid',{endpointUrl}));}catch{threw=true;}ok(threw);}});
 await test('foreign file selection cannot substitute digest identity',async()=>{
  const other=(await api.selectKDNA(await(await fetch(base+'/other.kdna')).arrayBuffer())).selection;
  const c=api.createKDNAWebClient(config());try{return rejected(await c.read(other,context()),'CLIENT_SELECTION_MISMATCH');}finally{c.dispose();api.releaseKDNASelection(other);}
 });
 await test('default file ceiling',async()=>eq((await api.selectKDNA(new Uint8Array(10*1024*1024+1))).code,'CLIENT_FILE_TOO_LARGE'));
 api.releaseKDNASelection(selection);
 return {total:rows.length,passed:rows.filter(x=>x.pass).length,failed:rows.filter(x=>!x.pass).length,rows};
}
