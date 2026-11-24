import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {makeDatabase,activeUser,business,mutate} from '../src/access-model.js';
import {rgDashboard,rgMutation} from '../src/regression-model.js';
import {createApp} from '../server/app.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
function analysisFixture(){
  const db=makeDatabase(),engineer=activeUser(db,'u2'),expert=activeUser(db,'u3');
  const run=business(db,engineer,'run',{projectId:'p1',wellId:'w1',referenceWellId:'w2',scenario:'strata',aligned:true,sameBasis:true,targetThickness:8,referenceThickness:11});
  const baseline=business(db,engineer,'joint-run',{projectId:'p1',wellId:'w1',runId:run.id});
  const run2=business(db,engineer,'run',{projectId:'p1',wellId:'w1',referenceWellId:'w2',scenario:'strata',aligned:true,sameBasis:true,targetThickness:8,referenceThickness:9});
  const candidate=business(db,engineer,'joint-run',{projectId:'p1',wellId:'w1',runId:run2.id});
  return {db,engineer,expert,baseline,candidate};
}
function createCase(db,user,analysis){return rgMutation(db,user,'create-case',{projectId:'p1',analysisId:analysis.id,name:'JH-01 厚度差异复核',note:'典型井整改回归测试'});}

test('典型井案例完成校核、问题、整改回归与人工关闭',()=>{
  const f=analysisFixture();let view=createCase(f.db,f.engineer,f.baseline);const item=view.cases[0];
  assert.equal(item.status,'待校核');assert.equal(view.capabilities.run,true);assert.equal(view.capabilities.review,false);
  assert.throws(()=>rgMutation(f.db,f.engineer,'review-case',{projectId:'p1',caseId:item.id,decision:'accepted',note:''}),{status:403});
  view=rgMutation(f.db,f.expert,'review-case',{projectId:'p1',caseId:item.id,decision:'accepted',note:'同意进入整改'});
  assert.equal(view.cases[0].status,'已校核');assert.equal(view.cases[0].expertReview.reviewer,'李专家');
  view=rgMutation(f.db,f.engineer,'create-issue',{projectId:'p1',caseId:item.id,title:'厚度差异未解释',description:'补充测井曲线',severity:'高',owner:'张工',expectedStatus:'not_triggered'});
  const issue=view.issues[0];assert.equal(issue.status,'待整改');assert.equal(view.cases[0].status,'整改中');
  assert.throws(()=>rgMutation(f.db,f.expert,'close-issue',{projectId:'p1',caseId:item.id,issueId:issue.id,note:'直接关闭'}),/待关闭/);
  view=rgMutation(f.db,f.engineer,'fix-issue',{projectId:'p1',caseId:item.id,issueId:issue.id,candidateAnalysisId:f.candidate.id,fixNote:'补充测井曲线后重新判定',affectedCaseIds:[]});
  assert.equal(view.regressions[0].result,'通过');assert.equal(view.issues[0].status,'待关闭');assert.equal(view.issues[0].actualStatus,'not_triggered');
  assert.throws(()=>rgMutation(f.db,f.engineer,'close-issue',{projectId:'p1',caseId:item.id,issueId:issue.id,note:'工程师关闭'}),{status:403});
  view=rgMutation(f.db,f.expert,'close-issue',{projectId:'p1',caseId:item.id,issueId:issue.id,note:'原失败用例复测通过'});
  assert.equal(view.issues[0].status,'已关闭');assert.equal(view.cases[0].status,'已关闭');assert.equal(view.issues[0].closedBy,'李专家');
});
test('回归状态与期望不一致时保持待整改，不能直接关闭',()=>{
  const f=analysisFixture();let view=createCase(f.db,f.engineer,f.baseline);const item=view.cases[0];
  view=rgMutation(f.db,f.expert,'review-case',{projectId:'p1',caseId:item.id,decision:'accepted',note:'同意'});
  view=rgMutation(f.db,f.engineer,'create-issue',{projectId:'p1',caseId:item.id,title:'期望仍未触发',description:'',severity:'中',owner:'张工',expectedStatus:'triggered'});
  const issue=view.issues[0];
  view=rgMutation(f.db,f.engineer,'fix-issue',{projectId:'p1',caseId:item.id,issueId:issue.id,candidateAnalysisId:f.candidate.id,fixNote:'整改后为未触发',affectedCaseIds:[]});
  assert.equal(view.regressions[0].result,'未通过');assert.equal(view.issues[0].status,'待整改');
  assert.throws(()=>rgMutation(f.db,f.expert,'close-issue',{projectId:'p1',caseId:item.id,issueId:issue.id,note:'关闭'}),/待关闭/);
});
test('整改回归遵循项目、井、字段和校核权限，撤权后案例不可见',()=>{
  const f=analysisFixture(),reader=activeUser(f.db,'u4');let view=createCase(f.db,f.engineer,f.baseline);const item=view.cases[0];
  assert.throws(()=>rgDashboard(f.db,reader,'p1'),{status:403});
  assert.throws(()=>rgMutation(f.db,f.engineer,'create-case',{projectId:'p1',analysisId:'JA-404',name:'越权案例'}),/不存在|无权/);
  const grant=mutate(f.db,activeUser(f.db,'u1'),'grants',{projectId:'p1',userId:f.engineer.id,resourceType:'well',resourceId:'w2',actions:['view','run','export'],hiddenFields:['thickness']});
  assert.equal(rgDashboard(f.db,f.engineer,'p1').cases.length,0);
  assert.throws(()=>rgMutation(f.db,f.engineer,'review-case',{projectId:'p1',caseId:item.id,decision:'accepted',note:''}),{status:403});
  mutate(f.db,activeUser(f.db,'u1'),'grants',{id:grant.id,projectId:'p1',userId:f.engineer.id,resourceType:'well',resourceId:'w2',remove:true});
  assert.equal(rgDashboard(f.db,f.engineer,'p1').cases.length,1);
});
test('HTTP 典型案例、校核、问题、回归和关闭闭环',async()=>{
  const dir=await fs.mkdtemp(path.join(root,'tests','.regression-'));let server;
  try{
    server=await createApp({root,dataFile:path.join(dir,'db.json')});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const base=`http://127.0.0.1:${server.address().port}`;
    async function call(url,{cookie,csrf,body}={}){const response=await fetch(base+url,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{}),...(csrf?{'X-CSRF-Token':csrf}:{})},body:body?JSON.stringify(body):undefined});return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};}
    const login=await call('/api/auth/login',{body:{account:'admin',password:'GeoDemo!2026'}});const auth={cookie:login.cookie,csrf:login.data.csrf};
    const run=await call('/api/business/run',{...auth,body:{projectId:'p1',wellId:'w1',referenceWellId:'w2',scenario:'strata',aligned:true,sameBasis:true,targetThickness:8,referenceThickness:11}});
    const baseline=await call('/api/business/joint-run',{...auth,body:{projectId:'p1',wellId:'w1',runId:run.data.id}});
    const run2=await call('/api/business/run',{...auth,body:{projectId:'p1',wellId:'w1',referenceWellId:'w2',scenario:'strata',aligned:true,sameBasis:true,targetThickness:8,referenceThickness:9}});
    const candidate=await call('/api/business/joint-run',{...auth,body:{projectId:'p1',wellId:'w1',runId:run2.data.id}});
    let view=await call('/api/regression?projectId=p1',{cookie:auth.cookie});assert.equal(view.status,200);assert.equal(view.data.analyses.length,2);
    view=await call('/api/regression/mutate',{...auth,body:{action:'create-case',projectId:'p1',analysisId:baseline.data.id,name:'HTTP 典型案例'}});const tc=view.data.cases[0];assert.equal(tc.status,'待校核');
    view=await call('/api/regression/mutate',{...auth,body:{action:'review-case',projectId:'p1',caseId:tc.id,decision:'accepted',note:'同意'}});assert.equal(view.data.cases[0].status,'已校核');
    view=await call('/api/regression/mutate',{...auth,body:{action:'create-issue',projectId:'p1',caseId:tc.id,title:'HTTP 问题',description:'',severity:'中',owner:'张工',expectedStatus:'not_triggered'}});const issue=view.data.issues[0];
    view=await call('/api/regression/mutate',{...auth,body:{action:'fix-issue',projectId:'p1',caseId:tc.id,issueId:issue.id,candidateAnalysisId:candidate.data.id,fixNote:'整改完成',affectedCaseIds:[]}});assert.equal(view.data.regressions[0].result,'通过');
    view=await call('/api/regression/mutate',{...auth,body:{action:'close-issue',projectId:'p1',caseId:tc.id,issueId:issue.id,note:'关闭'}});assert.equal(view.data.cases[0].status,'已关闭');
    const finalView=await call('/api/regression?projectId=p1',{cookie:auth.cookie});assert.equal(finalView.data.cases[0].status,'已关闭');assert.equal(finalView.data.regressions.length,1);
  }finally{if(server?.listening)await new Promise(resolve=>server.close(resolve));const resolved=path.resolve(dir);assert.ok(resolved.startsWith(path.resolve(root,'tests')+path.sep));await fs.rm(resolved,{recursive:true,force:true});}
});