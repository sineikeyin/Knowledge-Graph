import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {makeDatabase,clone,mutate} from '../src/access-model.js';
import {ingRecordUpload,ingSetParsed,ingMutation} from '../src/ingestion-model.js';
import {ingParse} from '../src/ingestion-core.js';
import {ontoEnsure,ontoMutation} from '../src/ontology-model.js';
import {kcEnsure,kcMutation,kcDetail,kcAdvance} from '../src/construction-model.js';
import {gmEnsure,gmSeedDemo,gmDashboard,gmQuery,gmMutation} from '../src/graph-model.js';
import {gmPaths,gmAlgorithm,gmCoordinate,gmDistance,gmSpatial,gmSimilar,gmDiff} from '../src/graph-core.js';
import {createApp} from '../server/app.mjs';

const gmTestRoot=fileURLToPath(new URL('..',import.meta.url));
function graphFixture(){
  const db=makeDatabase(),admin=db.users[0],engineer=db.users[1],expert=db.users[2],reader=db.users[3];kcEnsure(db);ontoEnsure(db);gmEnsure(db);gmSeedDemo(db,'p1');
  let ontology=ontoMutation(db,admin,'create',{projectId:'p1',templateId:'geosteering'});for(const action of ['submit','approve','publish'])ontology=ontoMutation(db,admin,action,{projectId:'p1',versionId:ontology.id,expectedRevision:ontology.revision,note:'图谱验收',confirmImpact:true});
  const dashboard=(user=admin,dataset='published')=>gmDashboard(db,user,'p1',dataset);
  const query=(action,body={},user=admin)=>gmQuery(db,user,action,{projectId:'p1',...body});
  const change=(action,body={},user=admin)=>gmMutation(db,user,action,{projectId:'p1',...body});
  const publish=(bottom=108,previous)=>{
    const text=`井名,层位,顶深,底深,深度单位,深度类型,参考基准,岩性\nJH-01,长 8₁,100,${bottom},m,MD,KB,砂岩\n`;
    const input=ingRecordUpload(db,admin,{projectId:'p1',wellId:'w1',objectType:'stratum',name:'图谱版本验收.csv',hash:`gm-hash-${db.sequence}`,fileId:'gm-file',size:text.length,encoding:'utf-8',...(previous?{assetId:previous.assetId,expectedVersionId:previous.versionId}:{})});
    ingSetParsed(db,input.jobId,ingParse(text,'csv'));const version={assetId:input.assetId,versionId:input.versionId};assert.equal(ingMutation(db,admin,'validate',version).status,'通过');const handoff=ingMutation(db,admin,'handoff',version);
    let task=kcMutation(db,admin,'create',{projectId:'p1',handoffIds:[handoff.id],ontologyVersionId:ontology.id});for(let i=0;i<7;i++)kcAdvance(db,admin,task.id);task=kcDetail(db,admin,'p1',task.id);
    for(const c of task.candidates){kcMutation(db,admin,'review',{projectId:'p1',taskId:task.id,expectedRevision:task.revision,candidateId:c.id,candidateRevision:c.revision,decision:'accept',note:'逐项对照原件'});task=kcDetail(db,admin,'p1',task.id);}
    const publication=kcMutation(db,admin,'publish',{projectId:'p1',taskId:task.id,expectedRevision:task.revision});return {...input,publication,task};
  };
  return {db,admin,engineer,expert,reader,dashboard,query,change,publish};
}
const graphNode=id=>({id}),graphEdge=(id,a,b)=>({id,subjectId:a,objectId:b,typeId:'links'});

test('06 正式图与虚构图隔离，五类知识均有属性、关系和明确证据，示例初始化幂等',()=>{
  const f=graphFixture();assert.equal(f.dashboard().nodes.length,0);const demo=f.dashboard(f.admin,'demo');assert.equal(demo.nodes.length,21);assert.ok(demo.nodes.every(n=>n.demo&&n.evidence.demo));for(const type of ['stratum','log','trajectory','model','instruction'])assert.ok(demo.nodes.some(n=>n.typeId===type&&n.evidence.assetId));
  const ids=demo.nodes.map(n=>n.id);gmSeedDemo(f.db,'p1');assert.deepEqual(f.dashboard(f.admin,'demo').nodes.map(n=>n.id),ids);assert.equal(f.db.construction.facts.length,0);
  f.db.projects.push({id:'custom',name:'用户工区',block:'实际工区',wells:['w1']});gmSeedDemo(f.db,'custom');assert.equal(f.db.graph.demoFacts.filter(n=>n.projectId==='custom').length,0);
});
test('06 多跳查询返回真实最短优先路径、节点与关系证据，覆盖五类对象',()=>{
  const f=graphFixture(),demo=f.dashboard(f.admin,'demo'),target=demo.nodes.find(n=>n.typeId==='instruction'&&n.wellId==='w1');
  for(const type of ['stratum','log','trajectory','model']){const start=demo.nodes.find(n=>n.typeId===type&&n.wellId==='w1');const result=f.query('paths',{dataset:'demo',start:start.id,end:target.id,maxHops:6});assert.ok(result.paths.length);assert.ok(result.paths.every(p=>p.edges.length<=6&&new Set(p.nodes).size===p.nodes.length));assert.ok(result.nodes.every(n=>n.evidence.assetId));assert.equal(result.edges.filter(e=>!e.computed).every(e=>e.evidence.assetId),true);}
  const from=demo.nodes.find(n=>n.typeId==='well'&&n.wellId==='w1'),to=demo.nodes.find(n=>n.typeId==='interval'&&n.wellId==='w1');assert.equal(f.query('paths',{dataset:'demo',start:from.id,end:to.id,relation:'belongs',directed:true,maxHops:3}).paths.length,0);assert.equal(f.query('paths',{dataset:'demo',start:to.id,end:from.id,relation:'belongs',directed:true,maxHops:3}).paths.length,1);
});
test('06 路径边界、无路径、方向、循环及搜索数量上限可验证',()=>{
  const nodes=['a','b','c','d','z'].map(graphNode),edges=[graphEdge('ab','a','b'),graphEdge('bc','b','c'),graphEdge('cd','c','d'),graphEdge('ca','c','a')];
  const result=gmPaths(nodes,edges,{start:'a',end:'d',maxHops:3});assert.deepEqual(result.paths[0].nodes,['a','c','d']);assert.equal(gmPaths(nodes,edges,{start:'a',end:'z',maxHops:6}).paths.length,0);assert.equal(gmPaths(nodes,edges,{start:'d',end:'a',maxHops:6,directed:true}).paths.length,0);
  for(const maxHops of [2,7,3.5,'bad',false])assert.throws(()=>gmPaths(nodes,edges,{start:'a',end:'d',maxHops}));assert.throws(()=>gmPaths(nodes,edges,{start:'a',end:'a',maxHops:3}));
  const dense=Array.from({length:10},(_,i)=>graphNode(String(i))),denseEdges=dense.flatMap((a,i)=>dense.slice(i+1).map(b=>graphEdge(a.id+b.id,a.id,b.id)));const limited=gmPaths(dense,denseEdges,{start:'0',end:'9',maxHops:6});assert.equal(limited.paths.length,20);assert.equal(limited.truncated,true);
});
test('06 已发布知识直接进入图管理，未校核候选不进入，源版本与索引可追溯',()=>{
  const f=graphFixture(),published=f.publish(),view=f.dashboard();assert.ok(view.nodes.length);assert.ok(view.nodes.every(n=>n.publicationId===published.publication.id&&n.evidence.versionId===published.versionId));assert.equal(view.storage.index,published.publication.id);assert.equal(view.revision,2);assert.equal(view.versions.at(-1).referenceId,published.publication.id);assert.ok(view.nodes.every(n=>!n.demo));
});
test('06 所有查询在计算前过滤项目、井、资料和字段权限，历史及快照不会绕过',()=>{
  const f=graphFixture(),published=f.publish(),snapshot=f.change('snapshot',{name:'权限测试',expectedRevision:f.dashboard().revision});assert.ok(f.dashboard(f.expert).nodes.length);assert.equal(f.dashboard(f.reader,'demo').nodes.length,0);
  const input={dataset:'demo',start:'demo:p1:w1:stratum',end:'demo:p1:w3:instruction',maxHops:6};assert.throws(()=>f.query('paths',input,f.engineer),/不可访问/);assert.throws(()=>gmDashboard(f.db,f.engineer,'p2','demo'),{status:403});
  const job=f.change('algorithm',{dataset:'published',algorithm:'centrality'},f.expert);assert.equal(f.dashboard(f.expert).jobs[0].id,job.id);
  const role=f.db.roles.find(r=>r.id==='expert'),permissions=clone(role.permissions);role.permissions=role.permissions.filter(p=>p!=='data');assert.equal(f.dashboard(f.expert).nodes.length,0);assert.equal(f.dashboard(f.expert).jobs.length,0);role.permissions=permissions;
  mutate(f.db,f.admin,'grants',{projectId:'p1',userId:f.expert.id,resourceType:'document',resourceId:published.assetId,actions:['view'],hiddenFields:['source']});
  const filtered=f.dashboard(f.expert);assert.equal(filtered.nodes.length,0);assert.equal(filtered.snapshots.length,0);assert.equal(filtered.jobs.length,0);assert.equal(filtered.restores.length,0);const history=f.query('history',{beforeId:filtered.versions[0].id,afterId:filtered.versions.at(-1).id},f.expert);assert.equal(history.rows.length,0);assert.equal(history.afterFacts.length,0);assert.throws(()=>f.change('restore',{snapshotId:snapshot.id,expectedRevision:filtered.revision,confirm:snapshot.id},f.expert),{status:403});
});
test('06 平面 / 经纬度距离、断层折线和范围计算真实运行，基准不一致明确排除',()=>{
  const records=[{id:'a',kind:'well',wellId:'w1',...gmCoordinate({x:0,y:0,crs:'local',frame:'A'})},{id:'b',kind:'well',wellId:'w2',x:3,y:4,crs:'local',frame:'A'},{id:'f',kind:'fault',x:2,y:-3,crs:'local',frame:'A',points:[{x:2,y:-3},{x:2,y:3}]},{id:'other',kind:'well',x:0,y:0,crs:'local',frame:'B'}];
  const result=gmSpatial(records,{targetId:'a',radius:5});assert.deepEqual(result.rows.map(r=>[r.id,r.distance]),[['f',2],['b',5]]);assert.equal(result.excluded[0].id,'other');assert.equal(gmSpatial(records,{targetId:'a',radius:1}).rows.length,0);
  assert.equal(gmSpatial(records,{targetId:'a',radius:5,bounds:{minX:2.5,maxX:4,minY:3,maxY:5}}).rows.length,1);assert.throws(()=>gmSpatial(records,{targetId:'a',radius:5,bounds:{minX:4,maxX:2,minY:0,maxY:1}}));
  const a=gmCoordinate({x:0,y:0,crs:'EPSG:4326',frame:'WGS84'}),b=gmCoordinate({x:1,y:0,crs:'EPSG:4326',frame:'WGS84'});assert.ok(Math.abs(gmDistance(a,b)-111195.08)<1);assert.equal(gmDistance(a,a),0);assert.throws(()=>gmCoordinate({x:181,y:0,crs:'EPSG:4326',frame:'WGS84'}));assert.throws(()=>gmCoordinate({x:0,y:0,crs:'local',frame:''}));assert.throws(()=>gmDistance(a,{...b,frame:'other'}));
});
test('06 空间坐标须有同井来源和修改权限，保存后参与正式计算，不从井斜猜测坐标',()=>{
  const f=graphFixture();assert.equal(f.dashboard().spatial.length,0);const add=(wellId,assetId,x)=>f.change('spatial-save',{wellId,assetId,name:'实测井口',kind:'well',x,y:0,crs:'local',frame:'survey-2026',source:'人工核对测量原件坐标'},f.engineer);
  const a=add('w1','w1-stratum-0',0),b=add('w2','w2-stratum-0',1200);assert.equal(a.revision,1);assert.equal(f.query('spatial',{targetId:a.id,crs:'local',frame:'survey-2026',radius:2000}).rows[0].distance,1200);
  assert.throws(()=>f.query('spatial',{targetId:a.id,crs:'local',frame:'wrong',radius:2000}),/不一致/);assert.throws(()=>add('w3','w3-stratum-0',2),{status:403});assert.throws(()=>add('w1','w2-stratum-0',0),/同一井/);assert.throws(()=>f.change('spatial-save',{wellId:'w1',assetId:'w1-stratum-0'},f.reader),{status:403});assert.throws(()=>f.change('spatial-save',{...a,expectedRevision:0}),{status:409});assert.ok(f.dashboard().spatial.some(r=>r.id===b.id));
});
test('06 相似井按可用因素计算并展示缺失因素，同名曲线不同基准不能混算',()=>{
  const f=graphFixture(),result=f.query('similar',{dataset:'demo',targetWellId:'w1'});assert.equal(result.rows[0].wellId,'w2');assert.ok(result.rows[0].score>result.rows[1].score);assert.equal(result.rows[0].coverage,1);
  const rows=[{id:'s1',wellId:'a',typeId:'stratum',value:{layer:'长8'}},{id:'s2',wellId:'b',typeId:'stratum',value:{layer:'长8'}},{id:'l1',wellId:'a',typeId:'log',value:{curve:'GR',value:80,valueUnit:'API'},evidence:{depthType:'MD',datum:'KB'}},{id:'l2',wellId:'b',typeId:'log',value:{curve:'GR',value:80,valueUnit:'API'},evidence:{depthType:'TVD',datum:'KB'}}];
  const missing=gmSimilar(rows,'a')[0];assert.equal(missing.score,1);assert.equal(missing.coverage,1/3);assert.equal(missing.factors.find(f=>f.key==='curve').score,null);assert.equal(missing.factors.find(f=>f.key==='engineering').score,null);
  assert.throws(()=>gmSimilar(rows,'a',{layer:0,curve:0,engineering:0}));assert.throws(()=>gmSimilar(rows,'a',{layer:0,curve:0,engineering:0,extra:1}));
});
test('06 图算法计算连通分量、去重度中心度、Jaccard与社区，孤立点保留',()=>{
  const nodes=['a','b','c','z'].map(graphNode),edges=[graphEdge('ab','a','b'),graphEdge('bc','b','c'),graphEdge('duplicate','a','b'),graphEdge('loop','z','z')];
  const components=gmAlgorithm(nodes,edges,{algorithm:'components'});assert.deepEqual(components.groups,[['a','b','c'],['z']]);const centrality=gmAlgorithm(nodes,edges,{algorithm:'centrality'});assert.equal(centrality.rows[0].id,'b');assert.equal(centrality.rows[0].degree,2);assert.equal(centrality.rows.find(r=>r.id==='z').score,0);
  const similar=gmAlgorithm(nodes,edges,{algorithm:'similarity',nodeId:'a'});assert.equal(similar.rows[0].id,'c');assert.equal(similar.rows[0].score,1);const community=gmAlgorithm(nodes,edges,{algorithm:'community',iterations:20});assert.equal(community.rows.length,2);assert.ok(community.rows.some(g=>g.nodes.length===1&&g.nodes[0]==='z'));assert.deepEqual(gmAlgorithm(nodes,edges,{algorithm:'community',iterations:20}),community);
  assert.throws(()=>gmAlgorithm(nodes,edges,{algorithm:'shell'}));assert.throws(()=>gmAlgorithm(nodes,edges,{algorithm:'community',iterations:0}));assert.throws(()=>gmAlgorithm(nodes,edges,{algorithm:'similarity',nodeId:'private'}));
});
test('06 图算法任务保存输入版本与真实结果，账号隔离且只读不能提交任务',()=>{
  const f=graphFixture(),job=f.change('algorithm',{dataset:'demo',algorithm:'components',relation:'all'},f.engineer);assert.equal(job.status,'done');assert.equal(job.progress,100);assert.equal(job.result.groups.length,2);assert.equal(job.input.dataset,'demo');assert.equal(f.dashboard(f.engineer,'demo').jobs.length,1);assert.equal(f.dashboard(f.admin,'demo').jobs.length,0);assert.equal(f.dashboard(f.engineer).jobs.length,0);assert.throws(()=>f.change('algorithm',{dataset:'demo',algorithm:'centrality'},f.reader),{status:403});
});
test('06 发布记录构成不可变时序版本，可按时间、井深和基准核对差异',()=>{
  const f=graphFixture(),first=f.publish(108),before=f.dashboard().versions.at(-1),original=clone(f.db.graph.versions.find(v=>v.id===before.id).facts);f.publish(112,first);const after=f.dashboard().versions.at(-1);
  assert.deepEqual(f.db.graph.versions.find(v=>v.id===before.id).facts,original);const result=f.query('history',{beforeId:before.id,afterId:after.id,minDepth:109,maxDepth:113,depthType:'MD',datum:'KB'});assert.ok(result.rows.every(r=>r.change==='added'));assert.equal(result.beforeFacts.length,0);assert.equal(result.afterFacts.length,2);assert.equal(f.query('history',{beforeId:before.id,afterId:after.id,minDepth:100,maxDepth:120,depthType:'TVD',datum:'KB'}).rows.length,0);
  assert.throws(()=>f.query('history',{beforeId:before.id,afterId:after.id,minDepth:110,maxDepth:100,depthType:'MD',datum:'KB'}));assert.throws(()=>f.query('history',{beforeId:before.id,afterId:after.id,fromTime:'invalid'}));assert.throws(()=>f.query('history',{beforeId:before.id,afterId:after.id,fromTime:'2999-01-01'}));
});
test('06 快照恢复核对并发版本、确认编号及来源权限，自动备份并恢复索引缓存',()=>{
  const f=graphFixture(),first=f.publish(108),initial=f.dashboard(),snapshot=f.change('snapshot',{name:'审核基线',expectedRevision:initial.revision}),oldIds=initial.nodes.map(n=>n.id);const second=f.publish(112,first),changed=f.dashboard(),expectedIds=changed.nodes.map(n=>n.id);
  assert.throws(()=>f.change('restore',{snapshotId:snapshot.id,expectedRevision:initial.revision,confirm:snapshot.id}),{status:409});assert.throws(()=>f.change('restore',{snapshotId:snapshot.id,expectedRevision:changed.revision,confirm:'wrong'}),/完整快照编号/);assert.throws(()=>f.change('restore',{snapshotId:snapshot.id,expectedRevision:changed.revision,confirm:snapshot.id},f.engineer),{status:403});
  const restored=f.change('restore',{snapshotId:snapshot.id,expectedRevision:changed.revision,confirm:snapshot.id});assert.equal(restored.status,'verified');assert.equal(restored.progress,100);assert.ok(restored.checks.verified);assert.equal(restored.checks.danglingRelations,0);assert.deepEqual(f.dashboard().nodes.map(n=>n.id),oldIds);assert.equal(f.dashboard().storage.index,snapshot.id);assert.equal(f.db.construction.caches.p1.entityCount,oldIds.length);assert.equal(f.db.ingestion.versions.find(v=>v.id===second.versionId).number,2);
  const automatic=f.dashboard().snapshots.find(s=>s.id===restored.backupId);assert.equal(automatic.reason,'恢复前自动备份');assert.equal(f.dashboard().restores[0].id,restored.id);const undo=f.change('restore',{snapshotId:automatic.id,expectedRevision:f.dashboard().revision,confirm:automatic.id});assert.ok(undo.checks.verified);assert.deepEqual(f.dashboard().nodes.map(n=>n.id),expectedIds);assert.equal(f.db.construction.tasks.find(t=>t.id===first.task.id).status,'published');
});
test('06 无效 / 跨项目 / 悬空快照被拒绝，旧版数据升级后保留发布历史',()=>{
  const f=graphFixture(),first=f.publish(),snapshot=f.change('snapshot',{name:'完整快照',expectedRevision:f.dashboard().revision});const record=f.db.graph.snapshots.find(s=>s.id===snapshot.id);record.facts=record.facts.filter(f=>f.kind!=='entity');const before=clone(f.db.construction.facts);assert.throws(()=>f.change('restore',{snapshotId:snapshot.id,expectedRevision:f.dashboard().revision,confirm:snapshot.id}),/悬空/);assert.deepEqual(f.db.construction.facts,before);
  assert.throws(()=>gmMutation(f.db,f.admin,'restore',{projectId:'p2',snapshotId:snapshot.id,expectedRevision:1,confirm:snapshot.id}),{status:404});f.publish(111,first);delete f.db.graph;const upgraded=f.dashboard();assert.equal(upgraded.versions.length,2);assert.equal(upgraded.nodes.find(n=>n.typeId==='stratum').value.bottom,111);assert.ok(upgraded.versions[0].entityCount>0);
});
test('06 差异识别新增、移除与属性变化，不依赖对象键顺序',()=>{
  const a={id:'1',assetId:'a',kind:'entity',typeId:'stratum',evidence:{row:1},value:{top:1,bottom:2}};assert.equal(gmDiff([a],[{...a,value:{bottom:2,top:1}}]).length,0);assert.equal(gmDiff([a],[{...a,value:{top:1,bottom:3}}])[0].change,'changed');assert.equal(gmDiff([a],[])[0].change,'removed');assert.equal(gmDiff([],[a])[0].change,'added');
});

test('06 HTTP 图查询、CSRF、权限、任务与快照恢复真实持久化，内部模型保持私有',async()=>{
  const dir=await fs.mkdtemp(path.join(gmTestRoot,'tests','.graph-http-'));let server,base;const dataFile=path.join(dir,'db.json');
  const start=async()=>{server=await createApp({root:gmTestRoot,dataFile});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${server.address().port}`;};
  const call=async(route,auth={},body)=>{const response=await fetch(base+'/api'+route,{method:body===undefined?'GET':'POST',headers:{...(auth.cookie?{Cookie:auth.cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json','X-CSRF-Token':auth.csrf||''})},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};};
  try{
    await start();assert.equal((await call('/graph?projectId=p1')).status,401);let login=await call('/auth/login',{}, {account:'admin',password:'GeoDemo!2026'}),auth={cookie:login.cookie,csrf:login.data.csrf};const demo=await call('/graph?projectId=p1&dataset=demo',auth);assert.equal(demo.status,200);assert.equal(demo.data.nodes.length,21);assert.equal((await fetch(base+'/src/graph-model.js')).status,404);assert.equal((await fetch(base+'/src/graph.js')).status,200);
    const query={projectId:'p1',dataset:'demo',start:'demo:p1:w1:log',end:'demo:p1:w1:instruction',maxHops:6};assert.equal((await call('/graph/paths',{cookie:auth.cookie},query)).status,403);assert.ok((await call('/graph/paths',auth,query)).data.paths.length);assert.equal((await call('/graph/paths',auth,{...query,maxHops:99})).status,400);
    const task=await call('/graph/algorithm',auth,{projectId:'p1',dataset:'demo',algorithm:'centrality'});assert.equal(task.status,200);assert.ok(task.data.result.rows.length);const snapshot=await call('/graph/snapshot',auth,{projectId:'p1',name:'空图验收快照',expectedRevision:1});assert.equal(snapshot.status,200);const restored=await call('/graph/restore',auth,{projectId:'p1',snapshotId:snapshot.data.id,confirm:snapshot.data.id,expectedRevision:1});assert.equal(restored.status,200);assert.equal(restored.data.checks.entityCount,0);
    const reader=await call('/auth/login',{}, {account:'reader',password:'GeoDemo!2026'}),readerAuth={cookie:reader.cookie,csrf:reader.data.csrf};assert.equal((await call('/graph?projectId=p1&dataset=demo',readerAuth)).data.nodes.length,0);assert.equal((await call('/graph/snapshot',readerAuth,{projectId:'p1',name:'越权',expectedRevision:2})).status,403);
    await new Promise(resolve=>server.close(resolve));await start();login=await call('/auth/login',{}, {account:'admin',password:'GeoDemo!2026'});auth={cookie:login.cookie,csrf:login.data.csrf};const persisted=await call('/graph?projectId=p1&dataset=demo',auth);assert.equal(persisted.data.jobs[0].id,task.data.id);assert.equal(persisted.data.restores.length,1);assert.equal(persisted.data.snapshots.length,2);assert.equal(persisted.data.revision,2);
  }finally{if(server?.listening)await new Promise(resolve=>server.close(resolve));const resolved=path.resolve(dir);assert.ok(resolved.startsWith(path.resolve(gmTestRoot,'tests')+path.sep));await fs.rm(resolved,{recursive:true,force:true});}
});

test('06 离线图谱七页签、查询、上下文、算法、快照和恢复与HTTP版本一致',async()=>{
  const html=await fs.readFile(new URL('../首页预览.html',import.meta.url),'utf8'),script=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1],source=script.slice(0,script.indexOf('// ===== src/main.js =====')),memory=new Map(),storage={getItem:key=>memory.get(key)||null,setItem:(key,value)=>memory.set(key,value),removeItem:key=>memory.delete(key)};
  const sandbox=vm.createContext({location:{protocol:'file:'},localStorage:storage,sessionStorage:storage,console,Date,URLSearchParams,window:{dispatchEvent(){}},document:{querySelector:()=>null},FormData:class{constructor(form){return Object.entries(form.values)[Symbol.iterator]();}}});
  vm.runInContext(source,sandbox);await vm.runInContext("api('/auth/login',{account:'admin',password:'GeoDemo!2026'})",sandbox);
  await vm.runInContext(`var gmUi,gmModal='',gmToast='',gmRoute='',gmTransferred=null;gmUi=createGraphUI({getContext:()=>({projectId:'p1',wellId:'w2',canGraph:true}),repaint(){},modal:(_,html)=>gmModal=html,toast:message=>gmToast=message,go:route=>gmRoute=route,onContext:context=>gmTransferred=context,openAsset:async()=>{}});gmUi.load();`,sandbox);
  assert.match(vm.runInContext('gmUi.html()',sandbox),/暂无可访问的正式知识/);await vm.runInContext("gmUi.change({target:{id:'gm-dataset',value:'demo'}})",sandbox);await vm.runInContext('gmUi.load()',sandbox);assert.match(vm.runInContext('gmUi.html()',sandbox),/虚构示例数据/);
  for(const id of ['browse','paths','spatial','similar','algorithms','history','snapshots']){await vm.runInContext(`gmUi.click({target:{closest:()=>({dataset:{gm:'tab',id:'${id}'}})}})`,sandbox);assert.ok(vm.runInContext('gmUi.html()',sandbox).length>500);}
  await vm.runInContext(`gmUi.submit({preventDefault(){},target:{id:'gm-paths',values:{start:'demo:p1:w1:log',end:'demo:p1:w1:instruction',maxHops:'6',directed:'false',relation:'all'}}})`,sandbox);await vm.runInContext("gmUi.click({target:{closest:()=>({dataset:{gm:'path-context'}})}})",sandbox);assert.equal(vm.runInContext('gmRoute',sandbox),'retrieval');assert.match(vm.runInContext('gmUi.retrievalHtml()',sandbox),/来自图谱的检索上下文/);
  await vm.runInContext(`gmUi.submit({preventDefault(){},target:{id:'gm-similar',values:{targetWellId:'w2',layer:'0.4',curve:'0.35',engineering:'0.25'}}})`,sandbox);await vm.runInContext("gmUi.click({target:{closest:()=>({dataset:{gm:'similar-context',id:'w1'}})}})",sandbox);assert.equal(vm.runInContext('gmTransferred.wellId',sandbox),'w2');assert.equal(vm.runInContext('gmTransferred.referenceWellId',sandbox),'w1');
  await vm.runInContext(`gmUi.submit({preventDefault(){},target:{id:'gm-algorithm',values:{algorithm:'components',relation:'all',wellId:'',iterations:'20'}}})`,sandbox);assert.ok((await vm.runInContext("api('/graph?projectId=p1&dataset=demo')",sandbox)).jobs.length);
  const snapshot=await vm.runInContext("api('/graph/snapshot',{projectId:'p1',name:'离线恢复验收',expectedRevision:1})",sandbox);sandbox.gmSnapshotId=snapshot.id;await vm.runInContext("api('/graph/restore',{projectId:'p1',snapshotId:gmSnapshotId,confirm:gmSnapshotId,expectedRevision:1})",sandbox);await vm.runInContext('offlineRequest=null',sandbox);assert.equal((await vm.runInContext("api('/graph?projectId=p1')",sandbox)).restores.length,1);
});

async function selectionSandbox(db){
  const html=await fs.readFile(new URL('../首页预览.html',import.meta.url),'utf8'),script=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1],source=script.slice(0,script.indexOf('// ===== src/main.js =====')),memory=new Map(),storage={getItem:key=>memory.get(key)||null,setItem:(key,value)=>memory.set(key,value),removeItem:key=>memory.delete(key)};
  if(db)storage.setItem('geokg-offline-users-v1',JSON.stringify(db));
  const sandbox=vm.createContext({location:{protocol:'file:'},localStorage:storage,sessionStorage:storage,console,Date,URLSearchParams,window:{dispatchEvent(){}},document:{querySelector:()=>null},FormData:class{constructor(form){return Object.entries(form.values)[Symbol.iterator]();}}});
  vm.runInContext(source,sandbox);await vm.runInContext("api('/auth/login',{account:'admin',password:'GeoDemo!2026'})",sandbox);
  await vm.runInContext(`var selectionState={projectId:'p1',wellId:'w3',selectedType:'well',canGraph:true},selectionUi;selectionUi=createGraphUI({getContext:()=>selectionState,repaint(){},modal(){},toast(){},go(){},onSelect:context=>{selectionState.wellId=context.wellId;selectionState.selectedType=context.type;},onContext:context=>{selectionState.wellId=context.wellId;selectionState.selectedType=context.type;},openAsset:async()=>{}});selectionUi.load();`,sandbox);
  return sandbox;
}
const selectionGraph=(sandbox)=>vm.runInContext('selectionUi.html()',sandbox).match(/<svg class="gm-canvas"[\s\S]*?<\/svg>/)?.[0]||'';
test('06 关联图跟随当前井与对象，筛选即时更新、独立对象选择和刷新均保留正确中心',async()=>{
  const sandbox=await selectionSandbox();await vm.runInContext("selectionUi.change({target:{id:'gm-dataset',value:'demo'}})",sandbox);await vm.runInContext('selectionUi.load()',sandbox);
  assert.match(selectionGraph(sandbox),/JH-03/);assert.doesNotMatch(selectionGraph(sandbox),/JH-01/);
  await vm.runInContext(`selectionState.wellId='w2';selectionState.selectedType='well';selectionUi.selectContext();`,sandbox);assert.match(selectionGraph(sandbox),/JH-02/);assert.doesNotMatch(selectionGraph(sandbox),/JH-03/);
  await vm.runInContext(`selectionState.selectedType='log';selectionUi.selectContext();`,sandbox);assert.match(selectionGraph(sandbox),/JH-02 GR/);assert.match(vm.runInContext('selectionUi.html()',sandbox),/<option value="demo:p1:w2:log" selected>/);
  await vm.runInContext(`selectionUi.change({target:{name:'well',form:{id:'gm-filter',values:{kind:'entity',well:'w3',type:'',text:''}}}})`,sandbox);assert.equal(vm.runInContext('selectionState.wellId',sandbox),'w3');assert.match(selectionGraph(sandbox),/JH-03/);
  await vm.runInContext(`selectionUi.change({target:{id:'gm-focus',value:'demo:p1:w1:trajectory'}})`,sandbox);assert.equal(vm.runInContext('selectionState.wellId',sandbox),'w1');assert.equal(vm.runInContext('selectionState.selectedType',sandbox),'trajectory');assert.match(vm.runInContext('selectionUi.html()',sandbox),/<option value="demo:p1:w1:trajectory" selected>/);
  await vm.runInContext('selectionUi.load()',sandbox);assert.match(vm.runInContext('selectionUi.html()',sandbox),/<option value="demo:p1:w1:trajectory" selected>/);
  await vm.runInContext(`selectionUi.click({target:{closest:()=>({dataset:{gm:'select',id:'demo:p1:w3:stratum'}})}})`,sandbox);assert.equal(vm.runInContext('selectionState.wellId',sandbox),'w3');assert.match(selectionGraph(sandbox),/JH-03/);
  await vm.runInContext(`selectionUi.click({target:{closest:()=>({dataset:{gm:'context',id:'demo:p1:w3:stratum'}})}})`,sandbox);assert.match(vm.runInContext('selectionUi.retrievalHtml()',sandbox),/来自图谱的检索上下文/);
  await vm.runInContext(`selectionUi.change({target:{name:'well',form:{id:'gm-filter',values:{kind:'entity',well:'w1',type:'',text:''}}}})`,sandbox);assert.equal(vm.runInContext('selectionUi.retrievalHtml()',sandbox),'');
  await vm.runInContext(`selectionState.projectId='p2';selectionState.wellId='w5';selectionState.selectedType='well';selectionUi.load();`,sandbox);assert.match(selectionGraph(sandbox),/SL-02/);assert.doesNotMatch(selectionGraph(sandbox),/JH-01/);
});
test('06 正式库只含部分井时，选择空井或无匹配对象清空旧图，恢复筛选后可重新选择',async()=>{
  const f=graphFixture();f.publish();const sandbox=await selectionSandbox(f.db);
  let view=vm.runInContext('selectionUi.html()',sandbox);assert.equal(selectionGraph(sandbox),'');assert.match(view,/JH-03暂无可访问的已发布知识/);assert.doesNotMatch(view,/<aside class="panel gm-detail"><h2>JH-01/);
  await vm.runInContext(`selectionUi.change({target:{name:'well',form:{id:'gm-filter',values:{kind:'entity',well:'w1',type:'',text:''}}}})`,sandbox);assert.match(selectionGraph(sandbox),/JH-01/);
  await vm.runInContext(`selectionUi.change({target:{name:'well',form:{id:'gm-filter',values:{kind:'entity',well:'w2',type:'',text:''}}}})`,sandbox);assert.equal(selectionGraph(sandbox),'');assert.match(vm.runInContext('selectionUi.html()',sandbox),/JH-02暂无可访问的已发布知识/);assert.equal(vm.runInContext('selectionState.wellId',sandbox),'w2');
  await vm.runInContext(`selectionUi.submit({preventDefault(){},target:{id:'gm-filter',values:{kind:'entity',well:'w1',type:'',text:'不存在的名称'}}})`,sandbox);assert.equal(selectionGraph(sandbox),'');
  await vm.runInContext(`selectionUi.click({target:{closest:()=>({dataset:{gm:'reset-filter'}})}})`,sandbox);assert.match(selectionGraph(sandbox),/JH-01/);
  await vm.runInContext(`selectionState.selectedType='trajectory';selectionUi.selectContext();`,sandbox);assert.equal(selectionGraph(sandbox),'');assert.match(vm.runInContext('selectionUi.html()',sandbox),/井轨迹暂无可访问的已发布知识/);
});
