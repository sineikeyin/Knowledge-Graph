import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {makeDatabase,clone,mutate} from '../src/access-model.js';
import {ingParse} from '../src/ingestion-core.js';
import {ingRecordUpload,ingSetParsed,ingMutation} from '../src/ingestion-model.js';
import {ontoEnsure,ontoMutation} from '../src/ontology-model.js';
import {kcEnsure,kcDashboard,kcDetail,kcGraph,kcMutation,kcAdvance,kcDispatch} from '../src/construction-model.js';
import {kcMetric,kcEvaluationItems} from '../src/construction-core.js';
import {createApp} from '../server/app.mjs';

const kcTestLas=`~Version Information
VERS. 2.0 : LAS version
WRAP. NO
~Well Information
WELL. JH-01 : Well name
NULL. -999.25
~Curve Information
DEPT.M : Depth
GR.API : Gamma ray
~Parameter Information
DEPTTYPE. MD
DREF. KB
~ASCII
100 80
100.5 82
`;
const root=fileURLToPath(new URL('..',import.meta.url));
function fixture(){
  const db=makeDatabase(),admin=db.users[0],engineer=db.users[1],expert=db.users[2];ontoEnsure(db);kcEnsure(db);
  let ontology=ontoMutation(db,admin,'create',{projectId:'p1',templateId:'geosteering'});
  for(const action of ['submit','approve','publish'])ontology=ontoMutation(db,admin,action,{projectId:'p1',versionId:ontology.id,expectedRevision:ontology.revision,note:'专家核对',confirmImpact:true});
  const add=(options={})=>{
    const text=options.text||`井名,层位,顶深,底深,深度单位,深度类型,参考基准,岩性\nJH-01,长 8₁,100,${options.bottom||108},m,MD,KB,sandstone\n`;
    const upload=ingRecordUpload(db,admin,{projectId:'p1',wellId:'w1',objectType:options.objectType||'stratum',name:options.name||'地层.csv',hash:'hash-'+db.sequence,fileId:'file',size:text.length,encoding:'utf-8',...(options.assetId?{assetId:options.assetId,expectedVersionId:options.expectedVersionId}:{})});
    ingSetParsed(db,upload.jobId,ingParse(text,options.format||'csv'));
    const input={assetId:upload.assetId,versionId:upload.versionId};assert.equal(ingMutation(db,admin,'validate',input).status,'通过');return {...upload,handoff:ingMutation(db,admin,'handoff',input)};
  };
  const input=add();
  const create=(user=engineer,extra={})=>kcMutation(db,user,'create',{projectId:'p1',name:'抽取与审核测试',handoffIds:[input.handoff.id],ontologyVersionId:ontology.id,...extra});
  const get=id=>kcDetail(db,admin,'p1',id),run=id=>{for(let i=0;i<7;i++)kcAdvance(db,engineer,id);return get(id);};
  const change=(action,task,extra={},user=admin)=>kcMutation(db,user,action,{projectId:'p1',taskId:task.id,expectedRevision:task.revision,...extra});
  const review=(task,c,decision='accept',extra={},user=expert)=>change('review',task,{candidateId:c.id,candidateRevision:c.revision,decision,note:'核对固定原件与本体通过',...extra},user);
  const acceptAll=id=>{let task=get(id);for(const c of task.candidates){review(task,c);task=get(id);}return task;};
  return {db,admin,engineer,expert,ontology,input,add,create,get,run,change,review,acceptAll};
}
test('05 LAS 2.x ASCII 保留头段行号、曲线单位与原件数据位置；不猜测深度基准',()=>{
  const parsed=ingParse(kcTestLas,'las');assert.equal(parsed.rows.length,2);assert.equal(parsed.rows[0][2],'GR');assert.equal(parsed.rows[0][4],'API');assert.equal(parsed.rows[0][6],'MD');assert.equal(parsed.rows[0][7],'KB');assert.equal(parsed.lasHeader.find(h=>h.mnemonic==='GR').line,9);assert.equal(parsed.locations[0],14);
  const missing=ingParse(kcTestLas.replace('DEPTTYPE. MD\nDREF. KB\n',''),'las');assert.equal(missing.rows[0][6],'');assert.equal(missing.rows[0][7],'');
  assert.throws(()=>ingParse(kcTestLas.replace('WRAP. NO','WRAP. YES'),'las'),/WRAP/);assert.throws(()=>ingParse(kcTestLas.replace('VERS. 2.0','VERS. 3.0'),'las'),/2.x/);assert.throws(()=>ingParse(kcTestLas.replace('100 80','100 bad'),'las'),/不合法/);assert.equal(ingParse(kcTestLas.replace('100 80','100 -999.25'),'las').rows[0][3],'');
});
test('05 任务绑定固定资料、本体与抽取配置，分七阶段产生实体和关系，不自动发布',()=>{
  const f=fixture(),created=f.create();assert.equal(created.status,'queued');assert.equal(created.candidates.length,0);const pinned=clone(created.sources);
  assert.equal(created.stages.length,7);const task=f.run(created.id);assert.equal(task.status,'review');assert.ok(task.stages.every(s=>s.status==='done'&&s.attempt===1));assert.equal(task.candidates.filter(c=>c.kind==='entity').length,4);assert.equal(task.candidates.filter(c=>c.kind==='relation').length,3);
  const rock=task.candidates.find(c=>c.typeId==='lithology');assert.equal(rock.value.name,'砂岩');assert.equal(rock.normalization.before.name,'sandstone');assert.match(rock.evidence.raw,/sandstone/);assert.equal(rock.evidence.line,2);assert.equal(rock.evidence.versionId,f.input.versionId);assert.ok(rock.evidence.span);assert.deepEqual(task.sources,pinned);assert.equal(f.db.construction.publications.length,0);
  const other=f.run(f.create(f.engineer,{config:{extractRelations:false,normalizeTerms:false}}).id);assert.ok(!other.candidates.some(c=>c.kind==='relation'));assert.equal(other.candidates.find(c=>c.typeId==='lithology').value.name,'sandstone');
});
test('05 拒绝跨项目、未发布本体、重复资产版本及未治理输入，版本不随资料更新漂移',()=>{
  const f=fixture();assert.throws(()=>f.create(f.engineer,{projectId:'p2'}),{status:403});assert.throws(()=>f.create(f.engineer,{ontologyVersionId:'missing'}),/已发布/);assert.throws(()=>f.create(f.engineer,{handoffIds:[]}),/请选择/);
  const task=f.create(),next=f.add({assetId:f.input.assetId,expectedVersionId:f.input.versionId,bottom:111});assert.throws(()=>f.create(f.engineer,{handoffIds:[f.input.handoff.id,next.handoff.id]}),/不同版本/);assert.equal(f.get(task.id).sources[0].versionId,f.input.versionId);assert.equal(f.get(task.id).sources[0].rows[0].bottom,108);
});
test('05 已确认井别名生成标准井号实体，修正副本的证据仍指向未改写原件',()=>{
  const f=fixture();ingMutation(f.db,f.admin,'alias',{projectId:'p1',wellId:'w1',kind:'well',rawName:'旧井名',standardName:'JH-01'});
  const added=f.add({name:'原件与修正.csv',text:'井名,层位,顶深,底深,深度单位,深度类型,参考基准\n旧井名,长 8₁,100,108,m,MD,KB\n'});
  const corrected=ingMutation(f.db,f.admin,'correct',{assetId:added.assetId,versionId:added.versionId,row:1,field:'bottom',value:'111'});ingMutation(f.db,f.admin,'validate',corrected);const handoff=ingMutation(f.db,f.admin,'handoff',corrected);
  const task=f.run(f.create(f.engineer,{handoffIds:[handoff.id]}).id);assert.equal(task.candidates.find(c=>c.typeId==='well').value.code,'JH-01');const stratum=task.candidates.find(c=>c.typeId==='stratum');assert.equal(stratum.value.bottom,111);assert.match(stratum.evidence.raw,/底深: 108/);assert.equal(stratum.evidence.originalVersionId,added.versionId);assert.equal(stratum.evidence.versionId,corrected.versionId);assert.match(stratum.evidence.processingReason,/修正/);
});
test('05 审核保存前后值、理由、人和版本；并发冲突、非法属性与工程师越权被拒绝',()=>{
  const f=fixture();let task=f.run(f.create().id),c=task.candidates.find(c=>c.typeId==='stratum');assert.throws(()=>f.review(task,c,'accept',{},f.engineer),{status:403});assert.throws(()=>f.review(task,c,'accept',{note:''}),/理由/);
  assert.throws(()=>f.review(task,c,'modify',{value:{...c.value,top:500}}),/候选校验失败/);assert.throws(()=>f.review(task,c,'modify',{value:{...c.value,unknown:'bad'}}),/未定义/);
  const revised=f.review(task,c,'modify',{value:{...c.value,lithology:'砂岩'},note:'对照原件核对岩性译名'});assert.equal(revised.state,'accepted');assert.equal(revised.history[0].reviewer,f.expert.name);assert.equal(revised.history[0].before.value.lithology,'sandstone');assert.equal(revised.history[0].after.value.lithology,'砂岩');assert.equal(revised.history[0].ontologyVersionId,f.ontology.id);assert.throws(()=>f.review(task,c),{status:409});
  task=f.get(task.id);const issue=f.change('issue',task,{candidateId:c.id,note:'请专家核对分层对应关系'},f.expert);assert.equal(issue.status,'open');assert.equal(f.get(task.id).issues[0].evidence.versionId,f.input.versionId);
});
test('05 未审候选、悬空关系及无发布权限不能发布，发布事务保留证据并禁止再审核',()=>{
  const f=fixture();let task=f.run(f.create().id);assert.throws(()=>f.change('publish',task),/全部候选/);task=f.acceptAll(task.id);assert.throws(()=>f.change('publish',task,{},f.expert),{status:403});
  const rock=task.candidates.find(c=>c.typeId==='lithology');f.review(task,rock,'reject',{note:'暂不发布岩性'});task=f.get(task.id);assert.throws(()=>f.change('publish',task),/端点/);
  const relation=task.candidates.find(c=>c.typeId==='has_lithology');f.review(task,relation,'reject',{note:'岩性端点已驳回'});task=f.get(task.id);const publication=f.change('publish',task);assert.equal(publication.entityCount,3);assert.equal(publication.relationCount,2);assert.ok(Object.values(publication.refresh).every(s=>s.includes('本机')));
  const facts=kcGraph(f.db,f.admin,'p1').facts;assert.equal(facts.length,5);assert.ok(facts.every(fact=>fact.evidence.versionId===f.input.versionId));assert.equal(f.db.construction.caches.p1.entityCount,3);assert.ok(Object.keys(f.db.construction.indexes.p1.entries).length);assert.equal(f.change('publish',task).id,publication.id);
  const current=f.get(task.id);assert.throws(()=>f.review(current,current.candidates[0]),/已经发布/);
});
test('05 撤销资料、对象或字段权限后任务、标注、发布和证据不可绕过读取',()=>{
  const f=fixture(),task=f.run(f.create().id);f.change('sample',task,{name:'独立专家标注',expected:kcEvaluationItems(task)},f.expert);f.change('publish',f.acceptAll(task.id));
  assert.equal(kcDashboard(f.db,f.expert,'p1').tasks.length,1);assert.ok(kcGraph(f.db,f.expert,'p1').facts.length);
  mutate(f.db,f.admin,'grants',{projectId:'p1',userId:f.expert.id,resourceType:'well',resourceId:'w1',actions:['view'],hiddenFields:['source']});
  const visible=kcDashboard(f.db,f.expert,'p1');assert.equal(visible.tasks.length,0);assert.equal(visible.samples.length,0);assert.equal(visible.publications.length,0);assert.equal(kcGraph(f.db,f.expert,'p1').facts.length,0);assert.throws(()=>kcDetail(f.db,f.expert,'p1',task.id),{status:403});
});
test('05 指标按严格预期与实际匹配计算，重复、漏抽和多抽不虚增分数',()=>{
  const item={kind:'entity',typeId:'well',value:{code:'A'}};const result=kcMetric([item,item],[item,{...item,value:{code:'B'}}]);assert.equal(result.tp,1);assert.equal(result.fp,1);assert.equal(result.fn,1);assert.equal(result.precision,0.5);assert.equal(result.recall,0.5);assert.equal(result.f1,0.5);assert.equal(result.accuracy,1/3);assert.ok(result.details.some(d=>d.error.includes('漏抽')));assert.equal(kcMetric([],[]).f1,0);
});
test('05 专家标注版本与评价明细持久保存，审核修改不会污染原始预测',()=>{
  const f=fixture();let task=f.run(f.create().id);const expected=kcEvaluationItems(task),sample=f.change('sample',task,{name:'专家标签v1',expected},f.expert);const second=f.change('sample',task,{name:'专家标签v2',expected:expected.slice(1)},f.expert);assert.equal(second.number,2);
  f.review(task,task.candidates[0],'modify',{value:{...task.candidates[0].value,name:'人工更正名'}});task=f.get(task.id);const result=f.change('evaluate',task,{sampleId:sample.id});assert.equal(result.f1,1);assert.equal(result.details.length,7);const partial=f.change('evaluate',task,{sampleId:second.id});assert.equal(partial.fp,1);assert.equal(partial.fn,0);assert.equal(kcDashboard(f.db,f.expert,'p1').evaluations.length,2);
  assert.equal(f.change('export-evaluation',task,{evaluationId:result.id}).id,result.id);assert.throws(()=>f.change('export-evaluation',task,{evaluationId:result.id},f.expert),{status:403});
  mutate(f.db,f.admin,'grants',{projectId:'p1',userId:f.engineer.id,resourceType:'well',resourceId:'w1',actions:['view'],hiddenFields:[]});assert.throws(()=>f.change('export-evaluation',task,{evaluationId:result.id},f.engineer),{status:403});
});
test('05 失败流水线可在恢复授权后从失败步骤重试，已有步骤与候选不重复',()=>{
  const f=fixture(),task=f.create();kcAdvance(f.db,f.engineer,task.id);const role=f.db.roles.find(r=>r.id==='engineer');role.permissions=role.permissions.filter(p=>p!=='construction');kcAdvance(f.db,f.engineer,task.id);assert.equal(f.get(task.id).status,'failed');assert.throws(()=>f.change('retry',f.get(task.id),{},f.engineer),{status:403});role.permissions.push('construction');const retry=f.change('retry',f.get(task.id),{},f.engineer);const done=f.run(retry.id);assert.equal(done.status,'review');assert.equal(done.stages[0].attempt,1);assert.equal(done.stages[1].attempt,2);assert.equal(done.candidates.length,7);
});
test('05 增量只对配置后的合格新版本触发一次，停用停止建任务，旧发布不能覆盖新版本',()=>{
  const f=fixture();let old=f.run(f.create().id);old=f.acceptAll(old.id);const trigger=kcMutation(f.db,f.engineer,'trigger',{projectId:'p1',enabled:true,objectType:'stratum',ontologyVersionId:f.ontology.id});assert.equal(kcDispatch(f.db),false);
  const next=f.add({assetId:f.input.assetId,expectedVersionId:f.input.versionId,bottom:111});assert.equal(kcDispatch(f.db),true);assert.equal(kcDispatch(f.db),false);assert.equal(f.db.construction.events.length,1);let updated=f.run(f.db.construction.events[0].taskId);updated=f.acceptAll(updated.id);f.change('publish',updated);assert.throws(()=>f.change('publish',old),/更新版本/);assert.ok(kcGraph(f.db,f.admin,'p1').facts.every(fact=>fact.evidence.versionId===next.versionId));
  kcMutation(f.db,f.engineer,'trigger',{...trigger,expectedRevision:trigger.revision,enabled:false});f.add({name:'另一个地层.csv'});assert.equal(kcDispatch(f.db),false);
});
test('05 同资料后续发布替代现行知识，旧事实和任务证据保留',()=>{
  const f=fixture(),first=f.acceptAll(f.run(f.create().id).id);const p1=f.change('publish',first),next=f.add({assetId:f.input.assetId,expectedVersionId:f.input.versionId,bottom:111});const second=f.acceptAll(f.run(f.create(f.engineer,{handoffIds:[next.handoff.id]}).id).id),p2=f.change('publish',second);
  const facts=kcGraph(f.db,f.admin,'p1').facts;assert.ok(facts.every(f=>f.publicationId===p2.id));assert.ok(f.db.construction.facts.some(f=>f.publicationId===p1.id&&!f.active));assert.equal(f.get(first.id).sources[0].rows[0].bottom,108);assert.equal(f.get(second.id).sources[0].rows[0].bottom,111);
});
test('05 增量事件创建失败保留错误，恢复本体后可重试且不重复消费输入',()=>{
  const f=fixture();kcMutation(f.db,f.engineer,'trigger',{projectId:'p1',enabled:true,objectType:'stratum',ontologyVersionId:f.ontology.id});f.add({name:'增量新资料.csv'});const ontology=f.db.ontology.versions.find(v=>v.id===f.ontology.id);ontology.status='draft';assert.equal(kcDispatch(f.db),true);const event=f.db.construction.events[0];assert.equal(event.status,'failed');assert.match(event.error,/已发布/);ontology.status='published';const retry=kcMutation(f.db,f.engineer,'event-retry',{projectId:'p1',eventId:event.id});assert.equal(retry.status,'created');assert.ok(retry.taskId);assert.equal(kcDispatch(f.db),false);assert.equal(f.db.construction.tasks.length,1);
});
test('05 HTTP 创建到审核发布、LAS上传、CSRF、静态保护与重启恢复完整闭环',async()=>{
  const dir=await fs.mkdtemp(path.join(root,'tests','.construction-')),dataFile=path.join(dir,'db.json');let server,base;
  const start=async()=>{server=await createApp({root,dataFile});await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}`;};
  async function call(endpoint,auth={},body){const response=await fetch(base+'/api'+endpoint,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),...(auth.cookie?{Cookie:auth.cookie}:{}),...(auth.csrf?{'X-CSRF-Token':auth.csrf}:{})},body:body?JSON.stringify(body):undefined});return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};}
  const login=async()=>{const result=await call('/auth/login',{}, {account:'admin',password:'GeoDemo!2026'});return {cookie:result.cookie,csrf:result.data.csrf};};
  try{
    await start();assert.equal((await call('/construction?projectId=p1')).status,401);let auth=await login();assert.equal((await call('/construction/create',{cookie:auth.cookie},{projectId:'p1'})).status,403);
    let v=(await call('/ontology/create',auth,{projectId:'p1',templateId:'geosteering'})).data;for(const action of ['submit','approve','publish'])v=(await call('/ontology/'+action,auth,{projectId:'p1',versionId:v.id,expectedRevision:v.revision,note:'核对通过',confirmImpact:true})).data;
    const dashboard=(await call('/construction?projectId=p1',auth)).data;assert.ok(dashboard.sources.length);const created=await call('/construction/create',auth,{projectId:'p1',ontologyVersionId:v.id,handoffIds:[dashboard.sources[0].id]});assert.equal(created.status,200);
    let task;for(let i=0;i<100;i++){task=(await call('/construction/task?'+new URLSearchParams({projectId:'p1',taskId:created.data.id}),auth)).data;if(task.status==='review')break;await new Promise(r=>setTimeout(r,20));}assert.equal(task.status,'review');
    for(const c of task.candidates){const result=await call('/construction/review',auth,{projectId:'p1',taskId:task.id,expectedRevision:task.revision,candidateId:c.id,candidateRevision:c.revision,decision:'accept',note:'HTTP原文校核'});assert.equal(result.status,200,JSON.stringify(result.data));task=(await call(`/construction/task?projectId=p1&taskId=${task.id}`,auth)).data;}
    const release=await call('/construction/publish',auth,{projectId:'p1',taskId:task.id,expectedRevision:task.revision});assert.equal(release.status,200);assert.ok((await call('/construction/graph?projectId=p1',auth)).data.facts.length);
    for(const module of ['construction.js','construction-core.js','las-core.js'])assert.equal((await fetch(base+'/src/'+module)).status,200);for(const module of ['construction-model.js','offline-service.js'])assert.equal((await fetch(base+'/src/'+module)).status,404);
    const lasResponse=await fetch(base+'/api/ingestion/upload?'+new URLSearchParams({projectId:'p1',wellId:'w1',objectType:'log',name:'实测曲线.las'}),{method:'POST',headers:{'Content-Type':'application/octet-stream',Cookie:auth.cookie,'X-CSRF-Token':auth.csrf},body:kcTestLas});assert.equal(lasResponse.status,202);const las=await lasResponse.json();let detail;
    for(let i=0;i<100;i++){detail=(await call('/ingestion/assets/'+las.assetId,auth)).data;if(detail.versions[0]?.parsed)break;await new Promise(r=>setTimeout(r,20));}assert.equal(detail.versions[0].parsed.lasHeader.length,8);assert.equal((await call('/ingestion/validate',auth,{assetId:las.assetId,versionId:las.versionId})).data.status,'通过');
    await new Promise(r=>server.close(r));await start();auth=await login();const restored=(await call(`/construction/task?projectId=p1&taskId=${task.id}`,auth)).data;assert.equal(restored.status,'published');assert.equal(restored.candidates[0].history[0].note,'HTTP原文校核');assert.equal((await call('/construction?projectId=p1',auth)).data.publications[0].id,release.data.id);
  }finally{if(server?.listening)await new Promise(r=>server.close(r));const resolved=path.resolve(dir);assert.ok(resolved.startsWith(path.resolve(root,'tests')+path.sep));await fs.rm(resolved,{recursive:true,force:true});}
});
