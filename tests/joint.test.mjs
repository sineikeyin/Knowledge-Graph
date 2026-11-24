import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildJointAnalysis, JOINT_PROVIDER, DEMO_LLM_PROVIDER} from '../src/joint-analysis.js';
import {evaluateThicknessRule} from '../src/rules.js';
import {defaultRule} from '../src/data.js';
import {makeDatabase,activeUser,workspace,business,mutate} from '../src/access-model.js';
import {createApp} from '../server/app.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const targetWell={id:'w1',short:'JH-01',layer:'长 8₁',depth:'3,120–3,128 m',thickness:8,version:'data-v1.0',source:'JH-01 分层记录'};
const referenceWell={id:'w2',short:'JH-02',layer:'长 8₁',depth:'3,108–3,119 m',thickness:11,version:'data-v1.0',source:'JH-02 分层记录'};
const evidence=[
  {id:'ev:well:w1:stratum',role:'target',kind:'stratum',label:'JH-01 分层记录',detail:'长 8₁ · 3,120–3,128 m · 8 m',source:'JH-01 分层记录',version:'data-v1.0',wellId:'w1'},
  {id:'ev:well:w2:stratum',role:'reference',kind:'stratum',label:'JH-02 分层记录',detail:'长 8₁ · 3,108–3,119 m · 11 m',source:'JH-02 分层记录',version:'data-v1.0',wellId:'w2'},
];
function makeRun(overrides={}){
  const input={scenario:'strata',aligned:true,sameBasis:true,conflict:false,targetThickness:8,referenceThickness:11,evidenceIds:['well:w1:stratum','well:w2:stratum'],...overrides};
  return {id:'RUN-TEST-1',time:'2026/11/23 10:00:00',wellName:'JH-01',referenceWellName:'JH-02',result:evaluateThicknessRule(input,defaultRule)};
}
function analyze(overrides={}){return buildJointAnalysis({run:makeRun(overrides),targetWell,referenceWell,evidence,now:new Date('2026-11-23T02:00:00.000Z')});}

test('联合分析解释规则结论并保留引用与输入快照',()=>{
  const result=analyze();
  assert.equal(result.conclusion.tone,'amber');
  assert.match(result.conclusion.title,/厚度差超限/);
  assert.ok(result.reasons.length>=3);
  const ids=new Set(result.citations.map(item=>item.id));
  for(const reason of result.reasons)for(const id of reason.citationIds)assert.ok(ids.has(id));
  assert.ok(result.supporting.some(item=>item.role==='target'));
  assert.ok(result.supporting.some(item=>item.role==='reference'));
  assert.equal(result.provider.isModel,false);
  assert.match(result.disclaimer,/未调用外部大模型/);
  const run=makeRun();const frozen=buildJointAnalysis({run,targetWell,referenceWell,evidence});
  run.result.input.targetThickness=999;run.result.rule.threshold=99;
  assert.equal(frozen.inputSnapshot.run.result.input.targetThickness,8);
  assert.equal(frozen.inputSnapshot.run.result.rule.threshold,2);
});
test('大模型示例模式生成报告结构和示例模式声明',()=>{
  const result=buildJointAnalysis({run:makeRun(),targetWell,referenceWell,evidence,mode:'demo-llm'});
  assert.equal(result.analysisMode,'demo-llm');
  assert.equal(result.provider.simulated,true);
  assert.equal(result.provider.isModel,false);
  assert.equal(result.model.modelId,'geo-reasoner-demo-0.1');
  assert.equal(result.model.promptTemplateVersion,'jp-llm-demo-v1');
  assert.ok(result.narrative.reasoningChain.length);
  assert.ok(result.narrative.executiveSummary);
  assert.ok(result.narrative.evidenceAssessment);
  assert.match(result.modelNotice,/示例模式/);
  assert.match(result.disclaimer,/示例模式/);
  assert.equal(DEMO_LLM_PROVIDER.simulated,true);
});
test('未触发、资料不足、无规则与冲突分别给出不同结论',()=>{
  const notTriggered=analyze({referenceThickness:9});
  assert.equal(notTriggered.status,'not_triggered');
  assert.match(notTriggered.conclusion.title,/未超过阈值/);
  const insufficient=analyze({referenceThickness:null});
  assert.equal(insufficient.status,'insufficient');
  assert.match(insufficient.conclusion.title,/证据不足/);
  assert.ok(insufficient.uncertainties.some(item=>/不等于“未触发”/.test(item.text)));
  const noRule=analyze({aligned:false});
  assert.equal(noRule.status,'no_rule');
  assert.doesNotMatch(noRule.conclusion.summary,/未触发/);
  const conflict=analyze({conflict:true});
  assert.equal(conflict.status,'conflict');
  assert.match(conflict.conclusion.title,/人工裁决/);
});
test('未知场景联合分析明确未开放，不伪造结论',()=>{
  const result=analyze({scenario:'other'});
  assert.equal(result.status,'unsupported');
  assert.equal(result.reasons.length,0);
  assert.match(result.conclusion.title,/尚未开放/);
  assert.match(result.disclaimer,/尚未实现/);
});
test('联合分析按用户隔离，证据权限撤销后不可回看或导出',()=>{
  const db=makeDatabase(),user=activeUser(db,'u2'),root=activeUser(db,'u1');
  const run=business(db,user,'run',{projectId:'p1',wellId:'w1',referenceWellId:'w2',scenario:'strata',aligned:true,sameBasis:true,targetThickness:8,referenceThickness:11});
  const analysis=business(db,user,'joint-run',{projectId:'p1',wellId:'w1',runId:run.id});
  assert.equal(analysis.result.conclusion.tone,'amber');
  const demo=business(db,user,'joint-run',{projectId:'p1',wellId:'w1',runId:run.id,mode:'demo-llm'});
  assert.equal(demo.mode,'demo-llm');assert.equal(demo.result.analysisMode,'demo-llm');assert.equal(demo.result.provider.simulated,true);
  assert.equal(workspace(db,user).jointRuns.length,2);
  assert.equal(workspace(db,activeUser(db,'u4')).jointRuns.length,0);
  const distanceGrant=mutate(db,root,'grants',{projectId:'p1',userId:user.id,resourceType:'well',resourceId:'w2',actions:['view','run','export'],hiddenFields:['distance']});
  const safe=business(db,user,'joint-run',{projectId:'p1',wellId:'w1',runId:run.id});
  assert.ok(!('distance' in safe.result.inputSnapshot.referenceWell));
  mutate(db,root,'grants',{id:distanceGrant.id,projectId:'p1',userId:user.id,resourceType:'well',resourceId:'w2',remove:true});
  const visibleCount=workspace(db,user).jointRuns.length;
  const grant=mutate(db,root,'grants',{projectId:'p1',userId:user.id,resourceType:'well',resourceId:'w2',actions:['view'],hiddenFields:['thickness']});
  assert.equal(workspace(db,user).jointRuns.length,0);
  assert.throws(()=>business(db,user,'joint-export',{projectId:'p1',wellId:'w1',analysisId:analysis.id}),{status:403});
  mutate(db,root,'grants',{id:grant.id,projectId:'p1',userId:user.id,resourceType:'well',resourceId:'w2',remove:true});
  assert.equal(workspace(db,user).jointRuns.length,visibleCount);
  assert.equal(business(db,user,'joint-export',{projectId:'p1',wellId:'w1',analysisId:analysis.id}).id,analysis.id);
});
test('HTTP 联合分析生成、持久返回与导出',async()=>{
  const dir=await fs.mkdtemp(path.join(root,'tests','.joint-'));let server;
  try{
    server=await createApp({root,dataFile:path.join(dir,'db.json')});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const base=`http://127.0.0.1:${server.address().port}`;
    async function call(url,{cookie,csrf,body}={}){const response=await fetch(base+url,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{}),...(csrf?{'X-CSRF-Token':csrf}:{})},body:body?JSON.stringify(body):undefined});return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};}
    const login=await call('/api/auth/login',{body:{account:'admin',password:'GeoDemo!2026'}});const auth={cookie:login.cookie,csrf:login.data.csrf};
    const run=await call('/api/business/run',{...auth,body:{projectId:'p1',wellId:'w1',referenceWellId:'w2',scenario:'strata',aligned:true,sameBasis:true,targetThickness:8,referenceThickness:11}});
    assert.equal(run.status,200);assert.equal(run.data.result.status,'triggered');
    const joint=await call('/api/business/joint-run',{...auth,body:{projectId:'p1',wellId:'w1',runId:run.data.id}});
    assert.equal(joint.status,200);assert.match(joint.data.id,/^JA-/);assert.equal(joint.data.result.provider.isModel,false);
    const workspaceView=await call('/api/workspace',{cookie:auth.cookie});
    assert.equal(workspaceView.data.jointRuns.length,1);assert.equal(workspaceView.data.jointRuns[0].id,joint.data.id);
    const exported=await call('/api/business/joint-export',{...auth,body:{projectId:'p1',wellId:'w1',analysisId:joint.data.id}});
    assert.equal(exported.status,200);assert.equal(exported.data.runId,run.data.id);
  }finally{if(server?.listening)await new Promise(resolve=>server.close(resolve));const resolved=path.resolve(dir);assert.ok(resolved.startsWith(path.resolve(root,'tests')+path.sep));await fs.rm(resolved,{recursive:true,force:true});}
});