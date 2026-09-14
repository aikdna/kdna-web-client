import http from 'node:http';
import {once} from 'node:events';
import {createKDNARouter} from '@aikdna/kdna-web-server/express';
import {createReferenceHost,readResultResponse} from '@aikdna/kdna-web-server';
import {allowAll,context,bytesFor} from './fixtures.mjs';
export async function startFixture(){
 const state={epoch:'epoch:client-components',revoked:false},timers=new Set(),sockets=new Set();
 const policy=({snapshot})=>state.revoked?{decision:'deny',scope:[],epoch:state.epoch,policyId:'policy:client'}:{decision:'allow',scope:snapshot.ir.nodes.map(n=>n.id),epoch:state.epoch,policyId:'policy:client'};
 const normal=createKDNARouter({observePolicy:allowAll}),denied=createKDNARouter(),retained=createKDNARouter({observePolicy:policy,retainedSession:{binding_id:'binding:client-fixture',authorization_domain_id:'domain:client-fixture',verifyContext:c=>c===context},getContext:()=>context});
 const projectionHost=createReferenceHost({observePolicy:allowAll});
 const server=http.createServer(async(req,res)=>{
  const route=new URL(req.url,'http://127.0.0.1').pathname;
  try{
   if(route==='/delay'){const timer=setTimeout(()=>{timers.delete(timer);if(!res.destroyed){req.url='/read';normal(req,res);}},120);timers.add(timer);return;}
   if(['/valid','/denied','/retained'].includes(route)){req.url='/read';return (route==='/retained'?retained:route==='/denied'?denied:normal)(req,res);}
   const chunks=[];for await(const c of req)chunks.push(c);const incoming=new Request('http://127.0.0.1/fixture',{method:'POST',headers:req.headers,body:Buffer.concat(chunks)}),form=await incoming.formData();
   const selected=new Uint8Array(await form.get('file').arrayBuffer());const actual=route==='/blocked'?bytesFor('taxonomy-cycle.kdna'):selected;
   const result=await projectionHost.read(actual,JSON.parse(form.get('request')),route==='/failure'?{deliver:()=>false}:{});const response=readResultResponse(result);const headers=Object.fromEntries(response.headers);let body=Buffer.from(await response.arrayBuffer()),status=response.status;
   if(route==='/tamper-digest'){const v=JSON.parse(body);v.digests.A.observed='sha256:'+'0'.repeat(64);body=Buffer.from(JSON.stringify(v));}
   if(route==='/tamper-schema'){if(body[0]!==123)throw Error('CANONICAL_OBJECT_REQUIRED');body=Buffer.concat([Buffer.from('{"000-injected":true,'),body.subarray(1)]);}
   if(route==='/bare-200'){status=200;body=Buffer.from('{}');delete headers['x-kdna-channel'];}
   if(route==='/malformed-json')body=Buffer.from('{not-json');
   delete headers['content-length'];headers['content-length']=String(body.length);res.writeHead(status,headers);res.end(body);
  }catch{if(!res.destroyed){res.writeHead(500);res.end();}}
 });
 server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});if(process.env.KDNA_WEB_CLIENT_BOUND_FD!==undefined){
  const fd=Number(process.env.KDNA_WEB_CLIENT_BOUND_FD),expected=JSON.parse(process.env.KDNA_WEB_CLIENT_BOUND_ADDRESS||'null');
  if(!Number.isSafeInteger(fd)||fd<3||!Array.isArray(expected)||expected.length!==2||expected[0]!=='127.0.0.1'||!Number.isSafeInteger(expected[1])||expected[1]<1||expected[1]>65535)throw Error('SUPERVISED_BOUND_IPV4_FD_REQUIRED');
  server.listen({fd,exclusive:true});await once(server,'listening');
  const actual=server.address();if(actual.family!=='IPv4'||actual.address!==expected[0]||actual.port!==expected[1]){server.close();throw Error('SUPERVISED_BOUND_IPV4_ADDRESS_MISMATCH');}
  console.log(JSON.stringify({fixtureListening:{fd,address:actual},pid:process.pid}));
 }else{
  // Ordinary source tests require an environment that permits this listener.
  server.listen(0,'127.0.0.1');await once(server,'listening');
 }

 return {base:'http://127.0.0.1:'+server.address().port,state,async close(){for(const t of timers)clearTimeout(t);timers.clear();normal.dispose();denied.dispose();retained.dispose();projectionHost.dispose();for(const s of sockets)s.destroy();await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));if(sockets.size)await new Promise(r=>setImmediate(r));return {listening:server.listening,open_sockets:sockets.size};}};
}
