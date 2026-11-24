import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {makeDatabase,activeUser,business} from '../src/access-model.js';
import {igMutation} from '../src/integration-model.js';
import {opDashboard,opMutation} from '../src/operations-model.js';
import {createApp} from '../server/app.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
function fixture(){
  const db=makeDatabase(),admin=activeUser(db,'u1'),engineer=activeUser(db,'u2');
  const run=business(db,engineer,'run',{projectId:'p1',wellId:'w1',referenceWellId:'w2',scenario:'strata',aligned:true,sameBasis:true,targetThickness:8,referenceThickness:11});
  business(db,engineer,'joint-run',{projectId:'p1',wellId:'w1',runId:run.id});
  igMutation(db,admin,'send',{projectId:'p1',endpointId:'graph-entities',scenario:'normal'});
  igMutation(db,admin,'tool-call',{projectId:'p1',toolId:'push_recommendation',scenario:'normal'});
  return {db,admin,engineer};
}
test('运行概览汇总导入、抽取、检索、推理和接口日志',()=>{
  const {db,admin}=fixture();const view=opDashboard(db,admin,'p1');
  assert.ok(view.logs.some(item=>item.category==='推理'));assert.ok(view.logs.some(item=>item.category==='检索'));assert.ok(view.logs.some(item=>item.category==='接口'));
  assert.ok(view.summary.apiCount>=1);assert.ok(view.summary.agentCount>=1);assert.equal(view.health.length,4);assert.equal(view.deployment.mode,'本机私有化');
});
test('逻辑备份与恢复核查比较当前对象数量并记录差异',()=>{
  const {db,admin,engineer}=fixture();let view=opMutation(db,admin,'backup',{projectId:'p1'});const backup=view.backups[0];assert.equal(backup.status,'完成');assert.equal(backup.progress,100);assert.ok(backup.checksum);
  view=opMutation(db,admin,'restore',{projectId:'p1',backupId:backup.id});assert.equal(view.restores[0].status,'一致');
  const run=business(db,engineer,'run',{projectId:'p1',wellId:'w1',referenceWellId:'w2',scenario:'strata',aligned:true,sameBasis:true,targetThickness:8,referenceThickness:9});
  business(db,engineer,'joint-run',{projectId:'p1',wellId:'w1',runId:run.id});
  view=opMutation(db,admin,'restore',{projectId:'p1',backupId:backup.id});assert.equal(view.restores[0].status,'存在差异');assert.ok(view.restores[0].checks.some(item=>item.key==='runs'&&item.status==='差异'));
});
test('导出策略保护敏感字段和凭据，导出记录保留脱敏范围',()=>{
  const {db,admin}=fixture();let view=opMutation(db,admin,'toggle-policy',{projectId:'p1',key:'well',masked:false});assert.equal(view.exportPolicies.find(item=>item.key==='well').masked,false);
  assert.throws(()=>opMutation(db,admin,'toggle-policy',{projectId:'p1',key:'credential',masked:false}),/不允许/);
  view=opMutation(db,admin,'test-export',{projectId:'p1'});assert.equal(view.exportRecords[0].status,'已生成');assert.ok(view.exportRecords[0].maskedFields.includes('坐标'));assert.ok(!view.exportRecords[0].maskedFields.includes('井号'));
  assert.match(view.exportRecords[0].note,/凭据字段不进入导出/);
});
test('部署记录支持升级、回退和健康检查，运行管理权限受控',()=>{
  const {db,admin}=fixture();let view=opMutation(db,admin,'deploy-record',{projectId:'p1',kind:'upgrade',version:'0.11.1',note:'升级验证'});assert.equal(view.deployment.version,'0.11.1');assert.equal(view.deployment.records[0].kind,'升级');
  view=opMutation(db,admin,'deploy-record',{projectId:'p1',kind:'rollback',version:'0.11.0',note:'回退验证'});assert.equal(view.deployment.version,'0.11.0');assert.equal(view.deployment.records[0].kind,'回退');
  view=opMutation(db,admin,'health-check',{projectId:'p1'});assert.ok(view.deployment.lastChecked);
  assert.throws(()=>opDashboard(db,activeUser(db,'u4'),'p1'),{status:403});
  assert.throws(()=>opDashboard(db,activeUser(db,'u6'),'p1'),{status:403});
});
test('HTTP 运行日志、备份恢复、导出和部署闭环',async()=>{
  const dir=await fs.mkdtemp(path.join(root,'tests','.operations-'));let server;
  try{
    server=await createApp({root,dataFile:path.join(dir,'db.json')});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const base=`http://127.0.0.1:${server.address().port}`;
    async function call(url,{cookie,csrf,body}={}){const response=await fetch(base+url,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{}),...(csrf?{'X-CSRF-Token':csrf}:{})},body:body?JSON.stringify(body):undefined});return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};}
    const login=await call('/api/auth/login',{body:{account:'admin',password:'GeoDemo!2026'}});const auth={cookie:login.cookie,csrf:login.data.csrf};
    let view=await call('/api/operations?projectId=p1',{cookie:auth.cookie});assert.equal(view.status,200);assert.ok(Array.isArray(view.data.logs));
    view=await call('/api/operations/mutate',{...auth,body:{action:'backup',projectId:'p1'}});const backup=view.data.backups[0];
    view=await call('/api/operations/mutate',{...auth,body:{action:'restore',projectId:'p1',backupId:backup.id}});assert.equal(view.data.restores[0].status,'一致');
    view=await call('/api/operations/mutate',{...auth,body:{action:'test-export',projectId:'p1'}});assert.equal(view.data.exportRecords[0].status,'已生成');
    view=await call('/api/operations/mutate',{...auth,body:{action:'deploy-record',projectId:'p1',kind:'upgrade',version:'0.11.1',note:'HTTP 升级'}});assert.equal(view.data.deployment.version,'0.11.1');
    view=await call('/api/operations/mutate',{...auth,body:{action:'health-check',projectId:'p1'}});assert.ok(view.data.deployment.lastChecked);
    const finalView=await call('/api/operations?projectId=p1',{cookie:auth.cookie});assert.equal(finalView.data.backups.length,1);assert.equal(finalView.data.restores.length,1);assert.equal(finalView.data.exportRecords.length,1);
  }finally{if(server?.listening)await new Promise(resolve=>server.close(resolve));const resolved=path.resolve(dir);assert.ok(resolved.startsWith(path.resolve(root,'tests')+path.sep));await fs.rm(resolved,{recursive:true,force:true});}
});