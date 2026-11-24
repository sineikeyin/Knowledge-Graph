import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {evaluateNeighborRule} from '../src/rules.js';
import {defaultNeighborRule} from '../src/data.js';
import {buildJointAnalysis} from '../src/joint-analysis.js';
import {makeDatabase,activeUser,workspace,business,mutate} from '../src/access-model.js';
import {createApp} from '../server/app.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const baseInput={scenario:'neighbor',focus:'厚度变化是否支持地层对比',targetLayer:'长 8₁',candidateLayer:'长 8₁',radius:3,distance:1.6,targetThickness:8,candidateThickness:9,layerMatch:true,withinRange:true,dataComplete:true,evidenceIds:['w1-stratum','w2-stratum']};
const neighborRun=(overrides={})=>{const input={...baseInput,...overrides};return {id:'RUN-N-1',time:'2026/11/23 11:00:00',wellName:'JH-01',referenceWellName:'JH-02',scenario:'neighbor',result:evaluateNeighborRule(input,defaultNeighborRule)};};
const targetWell={id:'w1',short:'JH-01',layer:'长 8₁',depth:'3,120–3,128 m',thickness:8,version:'data-v1.0',source:'JH-01 分层记录'};
const referenceWell={id:'w2',short:'JH-02',layer:'长 8₁',depth:'3,108–3,119 m',thickness:9,version:'data-v1.0',source:'JH-02 分层记录'};
const evidence=[
  {id:'ev:well:w1:stratum',role:'target',kind:'stratum',label:'JH-01 分层记录',detail:'长 8₁ · 3,120–3,128 m · 8 m',source:'JH-01 分层记录',version:'data-v1.0',wellId:'w1'},
  {id:'ev:well:w2:stratum',role:'reference',kind:'stratum',label:'JH-02 分层记录',detail:'长 8₁ · 3,108–3,119 m · 9 m',source:'JH-02 分层记录',version:'data-v1.0',wellId:'w2'},
];

test('邻井规则覆盖推荐、待复核、不建议、资料不足和无规则',()=>{
  assert.equal(neighborRun().result.status,'recommended');
  assert.equal(neighborRun({candidateThickness:11}).result.status,'review');
  assert.equal(neighborRun({candidateLayer:'长 8₂',layerMatch:false}).result.status,'not_recommended');
  assert.equal(neighborRun({distance:4,withinRange:false}).result.status,'not_recommended');
  assert.equal(neighborRun({candidateThickness:null,dataComplete:false}).result.status,'insufficient');
  assert.equal(neighborRun({scenario:'strata'}).result.status,'no_rule');
  assert.equal(evaluateNeighborRule({...baseInput},{...defaultNeighborRule,enabled:false}).status,'no_rule');
  const invalid=neighborRun();invalid.result.rule.maxThicknessDifference=0;
  assert.equal(evaluateNeighborRule(baseInput,{...defaultNeighborRule,maxThicknessDifference:0}).executionStatus,'failed');
});
test('邻井联合分析带距离、厚度差和引用，不伪造历史案例',()=>{
  const result=buildJointAnalysis({run:neighborRun(),targetWell,referenceWell,evidence,now:new Date('2026-11-23T03:00:00.000Z')});
  assert.equal(result.scenario,'neighbor');
  assert.equal(result.conclusion.tone,'teal');
  assert.match(result.conclusion.title,/可作为参考邻井/);
  const ids=new Set(result.citations.map(item=>item.id));
  for(const reason of result.reasons)for(const id of reason.citationIds)assert.ok(ids.has(id));
  assert.ok(result.reasons.some(item=>/距离 1.6 km/.test(item.text)));
  assert.ok(result.uncertainties.some(item=>/未纳入测井曲线/.test(item.text)));
  const review=buildJointAnalysis({run:neighborRun({candidateThickness:11}),targetWell,referenceWell,evidence});
  assert.equal(review.conclusion.tone,'amber');
  assert.ok(review.opposing.length);
});
test('邻井大模型示例模式生成模型报告',()=>{
  const result=buildJointAnalysis({run:neighborRun(),targetWell,referenceWell,evidence,mode:'demo-llm'});
  assert.equal(result.scenario,'neighbor');
  assert.equal(result.analysisMode,'demo-llm');
  assert.equal(result.provider.simulated,true);
  assert.ok(result.narrative.reasoningChain.some(item=>/距离 1.6 km/.test(item)));
  assert.match(result.modelNotice,/示例模式/);
  assert.match(result.disclaimer,/示例模式/);
});
test('候选邻井遵循项目、距离和字段授权，跨项目候选被拒绝',()=>{
  const db=makeDatabase(),engineer=activeUser(db,'u2'),reader=activeUser(db,'u4'),admin=activeUser(db,'u1');
  const list=business(db,admin,'neighbors',{projectId:'p1',wellId:'w1',radius:3});
  assert.deepEqual(list.candidates.map(item=>item.wellId),['w2','w3']);
  assert.equal(list.candidates[0].sameLayer,true);assert.equal(list.candidates[0].thicknessDifference,3);
  const narrow=business(db,admin,'neighbors',{projectId:'p1',wellId:'w1',radius:1});
  assert.equal(narrow.candidates.length,0);assert.equal(narrow.outOfRange,2);
  assert.throws(()=>business(db,reader,'neighbors',{projectId:'p1',wellId:'w1',radius:3}),{status:403});
  const grant=mutate(db,admin,'grants',{projectId:'p1',userId:engineer.id,resourceType:'well',resourceId:'w2',actions:['view','run','export'],hiddenFields:['distance']});
  assert.ok(!business(db,engineer,'neighbors',{projectId:'p1',wellId:'w1',radius:3}).candidates.some(item=>item.wellId==='w2'));
  mutate(db,admin,'grants',{id:grant.id,projectId:'p1',userId:engineer.id,resourceType:'well',resourceId:'w2',remove:true});
  assert.throws(()=>business(db,engineer,'neighbor-run',{projectId:'p1',wellId:'w1',candidateWellId:'w4',radius:3}),{status:403});
});
test('邻井联合分析可由有校核权限的专家查看和登记意见，普通工程师不能审核',()=>{
  const db=makeDatabase(),engineer=activeUser(db,'u2'),expert=activeUser(db,'u3'),reader=activeUser(db,'u4');
  const run=business(db,engineer,'neighbor-run',{projectId:'p1',wellId:'w1',candidateWellId:'w2',radius:3,focus:'厚度变化是否支持地层对比'});
  assert.equal(run.result.status,'review');
  const analysis=business(db,engineer,'joint-run',{projectId:'p1',wellId:'w1',runId:run.id});
  assert.equal(analysis.scenario,'neighbor');assert.equal(workspace(db,reader).jointRuns.length,0);
  assert.equal(workspace(db,expert).jointRuns.length,1);
  assert.throws(()=>business(db,engineer,'neighbor-review',{projectId:'p1',wellId:'w1',analysisId:analysis.id,decision:'accepted',note:'同意'}),{status:403});
  const reviewed=business(db,expert,'neighbor-review',{projectId:'p1',wellId:'w1',analysisId:analysis.id,decision:'modified',note:'厚度差异需补充测井曲线后再参考'});
  assert.equal(reviewed.review.decision,'modified');assert.equal(reviewed.review.reviewer,'李专家');
  assert.equal(workspace(db,engineer).jointRuns[0].review.decision,'modified');
  assert.throws(()=>business(db,expert,'neighbor-review',{projectId:'p1',wellId:'w1',analysisId:analysis.id,decision:'rejected',note:''}),/请填写/);
});
test('HTTP 邻井候选、判定、联合分析与人工意见闭环',async()=>{
  const dir=await fs.mkdtemp(path.join(root,'tests','.neighbor-'));let server;
  try{
    server=await createApp({root,dataFile:path.join(dir,'db.json')});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const base=`http://127.0.0.1:${server.address().port}`;
    async function call(url,{cookie,csrf,body}={}){const response=await fetch(base+url,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{}),...(csrf?{'X-CSRF-Token':csrf}:{})},body:body?JSON.stringify(body):undefined});return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};}
    const login=await call('/api/auth/login',{body:{account:'admin',password:'GeoDemo!2026'}});const auth={cookie:login.cookie,csrf:login.data.csrf};
    const list=await call('/api/business/neighbors',{...auth,body:{projectId:'p1',wellId:'w1',radius:3}});
    assert.equal(list.status,200);assert.deepEqual(list.data.candidates.map(item=>item.wellId),['w2','w3']);
    const run=await call('/api/business/neighbor-run',{...auth,body:{projectId:'p1',wellId:'w1',candidateWellId:'w2',radius:3,focus:'厚度变化是否支持地层对比'}});
    assert.equal(run.status,200);assert.equal(run.data.result.status,'review');
    const joint=await call('/api/business/joint-run',{...auth,body:{projectId:'p1',wellId:'w1',runId:run.data.id}});
    assert.equal(joint.status,200);assert.equal(joint.data.scenario,'neighbor');
    const demo=await call('/api/business/joint-run',{...auth,body:{projectId:'p1',wellId:'w1',runId:run.data.id,mode:'demo-llm'}});
    assert.equal(demo.status,200);assert.equal(demo.data.mode,'demo-llm');assert.equal(demo.data.result.analysisMode,'demo-llm');assert.match(demo.data.result.modelNotice,/示例模式/);
    const review=await call('/api/business/neighbor-review',{...auth,body:{projectId:'p1',wellId:'w1',analysisId:joint.data.id,decision:'accepted',note:'同意作为参考井'}});
    assert.equal(review.status,200);assert.equal(review.data.review.decision,'accepted');
    const view=await call('/api/workspace',{cookie:auth.cookie});const reviewedView=view.data.jointRuns.find(item=>item.id===joint.data.id);assert.equal(reviewedView.review.note,'同意作为参考井');
  }finally{if(server?.listening)await new Promise(resolve=>server.close(resolve));const resolved=path.resolve(dir);assert.ok(resolved.startsWith(path.resolve(root,'tests')+path.sep));await fs.rm(resolved,{recursive:true,force:true});}
});