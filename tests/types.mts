import {selectKDNA,releaseKDNASelection,createKDNAWebClient,type KDNASelection} from '@aikdna/kdna-web-client';
import type {ReadTransportContext} from '@aikdna/kdna-read/transport';
declare const file:File;declare const context:ReadTransportContext;
const chosen=await selectKDNA(file);
if(chosen.status==='selected'){
 const client=createKDNAWebClient({endpointUrl:'http://127.0.0.1/read',endpointId:'endpoint:1',sessionId:'session:1'});
 const result=await client.read(chosen.selection,context,{signal:new AbortController().signal});
 if(result.status==='received'){const remote:'remote'=result.view.origin;const noAction:false=result.view.capabilities.action;void remote;void noAction;}
 else {const absent:null=result.view;void absent;}
 client.dispose();releaseKDNASelection(chosen.selection);
}
// @ts-expect-error selections require the private public-API brand
const forged:KDNASelection={kind:'kdna.web-client-selection/1'};
// @ts-expect-error retired API is absent
import {KDNALoadPlanManager} from '@aikdna/kdna-web-client';
// @ts-expect-error arbitrary string is not a file selection
await selectKDNA('payload');
