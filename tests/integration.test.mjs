import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {makeDatabase,activeUser} from '../src/access-model.js';
import {igDashboard,igMutation} from '../src/integration-model.js';
import {createApp} from '../server/app.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
test('接口目录覆盖实体关系、检索与推理，并保留鉴权和示例',()=>{
  const db=makeDatabase(),admin=activeUser(db,'u1');const view=igDashboard(db,admin,'p1');
  assert.ok(view.endpoints.length>=6);assert.ok(view.tools.length>=5);assert.equal(view.scenarios.length,8);
  const ids=view.endpoints.map(item=>item.id);for(const id of ['graph-entities','graph-paths','retrieval-neighbors','reasoning-rule','reasoning-joint','regression-view'])assert.ok(ids.includes(id));
  assert.ok(view.endpoints.every(item=>item.auth&&item.requestFields.length&&item.responseFields.length&&item.errors.length));
  assert.equal(view.config.mode,'模拟');
});
test('接口联调覆盖正常、越权、超时、限流、重复、恢复和连续调用',()=>{
  const db=makeDatabase(),admin=activeUser(db,'u1');let view=igDashboard(db,admin,'p1');
  view=igMutation(db,admin,'send',{projectId:'p1',endpointId:'graph-entities',scenario:'normal'});assert.equal(view.requests[0].state,'成功');assert.equal(view.requests[0].mode,'模拟');
  view=igMutation(db,admin,'send',{projectId:'p1',endpointId:'graph-entities',scenario:'unauthorized'});assert.equal(view.requests[0].statusCode,401);
  view=igMutation(db,admin,'send',{projectId:'p1',endpointId:'graph-paths',scenario:'timeout'});assert.equal(view.requests[0].state,'超时');assert.equal(view.requests[0].retryCount,1);
  view=igMutation(db,admin,'send',{projectId:'p1',endpointId:'retrieval-neighbors',scenario:'rate-limit'});assert.equal(view.requests[0].statusCode,429);
  view=igMutation(db,admin,'send',{projectId:'p1',endpointId:'reasoning-rule',scenario:'duplicate'});assert.equal(view.requests[0].duplicate,true);
  view=igMutation(db,admin,'send',{projectId:'p1',endpointId:'reasoning-joint',scenario:'reconnect'});assert.equal(view.requests[0].state,'恢复');assert.equal(view.requests[0].retryCount,2);
  view=igMutation(db,admin,'send',{projectId:'p1',endpointId:'graph-entities',scenario:'continuous'});assert.equal(view.requests.length,11);assert.equal(view.requests[0].state,'成功');assert.equal(view.requests[0].statusCode,200);
});
test('智能体工具链路串联图谱/推理目标软件并保留回执',()=>{
  const db=makeDatabase(),admin=activeUser(db,'u1');let view=igMutation(db,admin,'tool-call',{projectId:'p1',toolId:'push_recommendation',scenario:'normal'});
  assert.equal(view.chains[0].state,'成功');assert.ok(view.chains[0].steps.some(step=>step.actor==='智能体'));assert.ok(view.chains[0].steps.some(step=>step.actor==='目标软件'));assert.equal(view.receipts[0].status,'已接收');
  const joint=igMutation(db,admin,'tool-call',{projectId:'p1',toolId:'joint_analysis',scenario:'normal'});assert.equal(joint.chains[0].state,'成功');assert.equal(joint.receipts.filter(item=>item.chainId===joint.chains[0].id).length,0);
  view=igMutation(db,admin,'tool-call',{projectId:'p1',toolId:'search_entities',scenario:'unauthorized'});assert.equal(view.chains[0].state,'越权');assert.equal(view.receipts.filter(item=>item.chainId===view.chains[0].id).length,0);
  view=igMutation(db,admin,'tool-call',{projectId:'p1',toolId:'push_recommendation',scenario:'timeout'});assert.equal(view.chains[0].state,'超时');assert.equal(view.receipts[0].status,'未接收');
});
test('目标软件配置保存字段映射，接口联调权限受控',()=>{
  const db=makeDatabase(),admin=activeUser(db,'u1'),engineer=activeUser(db,'u2'),reader=activeUser(db,'u4');
  const view=igMutation(db,admin,'config',{projectId:'p1',softwareName:'导向软件 A',version:'2.0',endpoint:'http://127.0.0.1:6100/ingest',authMode:'Bearer',enabled:true,mappings:{well:'wellNo',interval:'intervalNo',layer:'layerNo',recommendation:'advice',status:'receipt'}});
  assert.equal(view.config.softwareName,'导向软件 A');assert.equal(view.config.mappings.well,'wellNo');assert.equal(view.config.mode,'模拟');
  assert.throws(()=>igDashboard(db,engineer,'p1'),{status:403});assert.throws(()=>igDashboard(db,reader,'p1'),{status:403});assert.throws(()=>igMutation(db,engineer,'send',{projectId:'p1',endpointId:'graph-entities',scenario:'normal'}),{status:403});
});
test('HTTP 接口目录、请求、工具链路和配置闭环',async()=>{
  const dir=await fs.mkdtemp(path.join(root,'tests','.integration-'));let server;
  try{
    server=await createApp({root,dataFile:path.join(dir,'db.json')});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const base=`http://127.0.0.1:${server.address().port}`;
    async function call(url,{cookie,csrf,body}={}){const response=await fetch(base+url,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{}),...(csrf?{'X-CSRF-Token':csrf}:{})},body:body?JSON.stringify(body):undefined});return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};}
    const login=await call('/api/auth/login',{body:{account:'admin',password:'GeoDemo!2026'}});const auth={cookie:login.cookie,csrf:login.data.csrf};
    let view=await call('/api/integration?projectId=p1',{cookie:auth.cookie});assert.equal(view.status,200);assert.ok(view.data.endpoints.length>=6);
    view=await call('/api/integration/mutate',{...auth,body:{action:'send',projectId:'p1',endpointId:'reasoning-rule',scenario:'normal'}});assert.equal(view.status,200);assert.equal(view.data.requests[0].state,'成功');
    view=await call('/api/integration/mutate',{...auth,body:{action:'tool-call',projectId:'p1',toolId:'push_recommendation',scenario:'normal'}});assert.equal(view.data.chains[0].state,'成功');assert.equal(view.data.receipts[0].status,'已接收');
    view=await call('/api/integration/mutate',{...auth,body:{action:'config',projectId:'p1',softwareName:'目标软件 HTTP',version:'1.2',endpoint:'http://127.0.0.1:7000/ingest',authMode:'Bearer',enabled:true,mappings:{well:'well',interval:'interval',layer:'layer',recommendation:'advice',status:'status'}}});assert.equal(view.data.config.softwareName,'目标软件 HTTP');
    const finalView=await call('/api/integration?projectId=p1',{cookie:auth.cookie});assert.equal(finalView.data.requests.length,2);assert.equal(finalView.data.chains.length,1);assert.equal(finalView.data.receipts.length,1);
  }finally{if(server?.listening)await new Promise(resolve=>server.close(resolve));const resolved=path.resolve(dir);assert.ok(resolved.startsWith(path.resolve(root,'tests')+path.sep));await fs.rm(resolved,{recursive:true,force:true});}
});