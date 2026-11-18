import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, isPanelRequest, PANEL_HEADER, PANEL_MARKER } from '../lib/http.js';

const panelHeaders={host:'127.0.0.1:43123',origin:'http://127.0.0.1:43123','content-type':'application/json',[PANEL_HEADER]:PANEL_MARKER,'sec-fetch-site':'same-origin'};
function request(body,headers=panelHeaders){return new Request('http://dsh.internal/api/plugin-update-doctor',{method:'POST',headers,body:JSON.stringify(body)});}
function fixture(){
 const calls=[];
 const service={redact:value=>value,
  prepareBatch:async items=>{calls.push(['prepare',items]);return{ticket:'test-ticket',items,taskPolicies:['wait-for-idle','cancel-active']};},
  commit:async(ticket,choices)=>{calls.push(['commit',ticket,choices]);return{operationId:'test-job'};},
  locks:async name=>{calls.push(['locks',name]);return{status:'checked'};},
  cancelWait:id=>{calls.push(['cancel-wait',id]);return{cancelled:true};},
 };
 return{handler:createHandler(service),calls};
}
test('physical same-origin panel request survives DSH synthetic internal URL',async()=>{
 const {handler,calls}=fixture();
 const response=await handler(request({action:'prepare-batch',items:[{name:'sample',version:'1.0.1'}]}));
 assert.equal(response.status,200);assert.equal((await response.json()).ticket,'test-ticket');
 assert.deepEqual(calls,[['prepare',[{name:'sample',version:'1.0.1'}]]]);
});
test('authenticated carrier without Origin works only with JSON and panel marker',async()=>{
 const headers={...panelHeaders};delete headers.origin;delete headers['sec-fetch-site'];
 assert.equal(isPanelRequest(request({action:'locks',name:'sample'},headers)),true);
 const {handler}=fixture();assert.equal((await handler(request({action:'locks',name:'sample'},headers))).status,200);
});
test('foreign/opaque origins, cross-site, same-site, form posts and absent marker remain refused',async()=>{
 const cases=[{...panelHeaders,origin:'https://attacker.example'}, {...panelHeaders,origin:'null'}, {...panelHeaders,'sec-fetch-site':'cross-site'}, {...panelHeaders,'sec-fetch-site':'same-site'}, {...panelHeaders,'content-type':'text/plain'}, {...panelHeaders,[PANEL_HEADER]:'wrong'}];
 const missing={...panelHeaders};delete missing[PANEL_HEADER];cases.push(missing);
 for(const headers of cases){const {handler,calls}=fixture();assert.equal((await handler(request({action:'commit',ticket:'test-ticket'},headers))).status,403);assert.deepEqual(calls,[]);}
});
test('forwarded headers never substitute for trusted original authority',()=>{
 assert.equal(isPanelRequest(request({}, {...panelHeaders,host:'127.0.0.1:50000','x-forwarded-host':'127.0.0.1:43123'})),false);
 assert.equal(isPanelRequest(request({}, {...panelHeaders,origin:'http://127.0.0.1:43123/other'})),false);
});
test('successful panel admission still requires confirmation ticket and stop consent is not invented',async()=>{
 const {handler,calls}=fixture();assert.equal((await handler(request({action:'commit'}))).status,400);assert.deepEqual(calls,[]);
 const result=await handler(request({action:'commit',ticket:'test-ticket'}));assert.equal(result.status,200);
 assert.deepEqual(calls[0],['commit','test-ticket',{taskPolicy:'wait-for-idle',confirmCancel:false}]);
});
