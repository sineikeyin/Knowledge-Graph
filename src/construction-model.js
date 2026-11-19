import {clone,fault,can,requirePermission,resourceAllowed,auditEvent,permittedWells} from './access-model.js';
import {ingEnsure,ingFindAsset,ingId} from './ingestion-model.js';
import {ontoEnsure} from './ontology-model.js';
import {gmEnsure,gmVersion} from './graph-model.js';
import {kcStages,kcEngine,kcEntities,kcRelations,kcNormalize,kcCheck,kcMetric,kcEvaluationItems,kcName,kcStable,kcTaskDisplayName} from './construction-core.js';

export function kcEnsure(db){
  db.construction??={tasks:[],samples:[],evaluations:[],triggers:[],events:[],publications:[],facts:[],issues:[],indexes:{},caches:{},permissionVersion:0};
  const model=db.construction;
  if(!model.permissionVersion){const engineer=db.roles.find(r=>r.id==='engineer');if(engineer)engineer.permissions=[...new Set([...engineer.permissions,'construction'])];model.permissionVersion=1;}
  return model;
}
function kcScope(db,user,projectId,permission='construction'){
  if(!db.projects.some(p=>p.id===projectId)||!permittedWells(db,user,projectId).length)fault('项目不可访问。',403);
  requirePermission(db,user,permission,projectId);
}
function kcAssetAccess(db,user,source,action='view'){
  const asset=ingFindAsset(db,user,source.assetId,'view',true);
  if(action!=='view')for(const [kind,id]of [['well',asset.wellId],['document',asset.id],['object',`${asset.wellId}-${asset.objectType}`]])if(!resourceAllowed(db,user,asset.projectId,kind,id,asset.wellId,action))fault('无权校核或发布此资料。',403);
  return asset;
}
function kcVisible(db,user,item){try{item.sources.forEach(s=>kcAssetAccess(db,user,s));return true;}catch{return false;}}
function kcTask(db,user,id,projectId,action='view'){
  const task=kcEnsure(db).tasks.find(t=>t.id===id&&t.projectId===projectId);if(!task)fault('构建任务不存在。',404);
  for(const source of task.sources)kcAssetAccess(db,user,source,action);return task;
}
function kcRevision(item,expected){if(item.revision!==expected)fault('记录已变化，请刷新后重新操作。',409);}
const kcNow=()=>new Date().toISOString();
function kcSource(db,user,handoffId,projectId){
  const ig=ingEnsure(db),h=ig.handoffs.find(h=>h.id===handoffId&&h.projectId===projectId);if(!h)fault('资料交接不存在。',404);
  const asset=kcAssetAccess(db,user,h),v=ig.versions.find(v=>v.id===h.versionId&&v.assetId===asset.id),quality=v?.qualityRuns.find(q=>q.id===h.qualityRunId);
  if(!v?.parsed||!v.rows?.length||!quality||quality.status==='阻断'||(quality.status==='警告'&&!h.warningsConfirmed))fault('固定资料版本未通过治理交接门槛。',409);
  const original=ig.versions.filter(item=>item.assetId===asset.id&&item.fileId===v.fileId&&item.parsed).sort((a,b)=>a.number-b.number)[0]||v;
  return {handoffId:h.id,assetId:asset.id,wellId:asset.wellId,wellCode:db.wells.find(w=>w.id===asset.wellId)?.short,versionId:v.id,originalVersionId:original.id,reason:v.reason,fileName:v.fileName,hash:v.hash,objectType:asset.objectType,demo:Boolean(asset.demo),qualityRunId:h.qualityRunId,parserVersion:v.parserVersion,config:clone(v.config),parsed:clone(original.parsed),rows:v.rows.map(row=>clone(row.record))};
}
export function kcDashboard(db,user,projectId){
  kcScope(db,user,projectId);const model=kcEnsure(db),ig=ingEnsure(db),visibleTasks=model.tasks.filter(t=>t.projectId===projectId&&kcVisible(db,user,t)),ids=new Set(visibleTasks.map(t=>t.id));
  const sources=ig.handoffs.filter(h=>h.projectId===projectId).filter(h=>{try{kcAssetAccess(db,user,h);return true;}catch{return false;}}).map(h=>({...clone(h),name:db.assets.find(a=>a.id===h.assetId)?.name,wellCode:db.wells.find(w=>w.id===h.wellId)?.short,objectType:db.assets.find(a=>a.id===h.assetId)?.objectType,binding:clone(ontoEnsure(db).bindings.find(b=>b.handoffId===h.id)||null)}));
  return {projectId,sources,versions:ontoEnsure(db).versions.filter(v=>v.projectId===projectId&&v.status==='published').map(({id,name,number,revision})=>({id,name,number,revision})),tasks:visibleTasks.map(t=>({id:t.id,name:t.name,displayName:kcTaskDisplayName(t),sourceNames:t.sources.map(s=>s.fileName),sourceVersions:t.sources.map(s=>s.versionId),status:t.status,revision:t.revision,ontologyVersionId:t.ontologyVersionId,ontologyNumber:t.ontologyNumber,createdAt:t.createdAt,createdByName:t.createdByName,origin:t.origin,error:t.error,stages:clone(t.stages),sourceCount:t.sources.length,candidateCount:t.candidates.length,pending:t.candidates.filter(c=>c.state==='pending').length,accepted:t.candidates.filter(c=>c.state==='accepted').length})),samples:clone(model.samples.filter(s=>ids.has(s.taskId))),evaluations:clone(model.evaluations.filter(e=>ids.has(e.taskId))),triggers:clone(model.triggers.filter(t=>t.projectId===projectId&&t.createdBy===user.id)),events:clone(model.events.filter(e=>e.projectId===projectId&&e.createdBy===user.id)),publications:clone(model.publications.filter(p=>ids.has(p.taskId))),capabilities:{review:can(db,user,'review',projectId),publish:can(db,user,'publish',projectId),export:can(db,user,'export',projectId)}};
}
export function kcDetail(db,user,projectId,taskId){kcScope(db,user,projectId);const task=kcTask(db,user,taskId,projectId);return {...clone(task),displayName:kcTaskDisplayName(task)};}
export function kcGraph(db,user,projectId){
  kcScope(db,user,projectId,'graph');const model=kcEnsure(db);
  const facts=model.facts.filter(f=>f.projectId===projectId&&f.active).filter(f=>{try{kcAssetAccess(db,user,f);return true;}catch{return false;}}),ids=new Set(facts.map(f=>f.id));
  return {facts:clone(facts.filter(f=>f.kind==='entity'||ids.has(f.subjectId)&&ids.has(f.objectId))),storage:'本机版本化知识库',externalGraph:'未接入外部图数据库'};
}
export function kcAdvance(db,user,taskId){
  const model=kcEnsure(db),task=model.tasks.find(t=>t.id===taskId);if(!task||!['queued','running'].includes(task.status))return null;
  const stage=task.stages.find(s=>s.status!=='done');if(!stage)return null;
  stage.startedAt=kcNow();stage.attempt++;task.status='running';
  try{
    kcScope(db,user,task.projectId);task.sources.forEach(s=>kcAssetAccess(db,user,s));
    if(stage.id==='parse'){if(!task.sources.every(s=>s.parsed.rows.length&&s.rows.length))fault('资料解析快照为空。');stage.summary=`${task.sources.length} 份固定资料 / ${task.sources.reduce((n,s)=>n+s.rows.length,0)} 条记录`;}
    if(stage.id==='sentence')stage.summary='按表格记录切分，保留源文件行号和单元格位置';
    if(stage.id==='ner'){task.candidates=kcEntities(task);if(!task.candidates.length)fault('固定本体与资料字段无匹配实体，请调整本体后新建任务。');stage.summary=`识别 ${task.candidates.length} 项实体候选`;}
    if(stage.id==='relation'){task.candidates=task.candidates.filter(c=>c.kind==='entity').concat(task.config.extractRelations?kcRelations(task):[]);stage.summary=`${task.candidates.filter(c=>c.kind==='relation').length} 项同记录证据支持的关系`;}
    if(stage.id==='normalize'){if(task.config.normalizeTerms)kcNormalize(task);stage.summary=task.config.normalizeTerms?'按固定本体术语与治理后的单位归一':'已配置为保留治理后的术语，不额外替换';}
    if(stage.id==='quality'){task.candidates.forEach(c=>{c.errors=kcCheck(task,c);});stage.summary=`${task.candidates.filter(c=>c.errors.length).length} 项需修正，所有候选仍须人工校核`;}
    if(stage.id==='store'){task.extractionSnapshot=clone(task.candidates);task.status='review';stage.summary='候选已保存；审核和发布由独立操作完成';}
    stage.status='done';stage.error='';task.error='';
  }catch(error){stage.status='failed';stage.error=error.message;task.error=error.message;task.status='failed';}
  stage.finishedAt=kcNow();task.revision++;task.updatedAt=kcNow();return clone(task);
}
function kcCreate(db,user,body,origin='manual'){
  const model=kcEnsure(db),projectId=body.projectId;kcScope(db,user,projectId);
  if(!Array.isArray(body.handoffIds)||!body.handoffIds.length||body.handoffIds.length>10)fault('请选择 1～10 份已治理资料。');
  const ids=[...new Set(body.handoffIds)],sources=ids.map(id=>kcSource(db,user,id,projectId));
  if(new Set(sources.map(s=>s.assetId)).size!==sources.length)fault('同一任务不能重复选择同一资料的不同版本。');
  if(sources.reduce((n,s)=>n+s.rows.length,0)>2000)fault('单次构建最多 2000 条输入记录，请分批构建。');
  const ontology=ontoEnsure(db).versions.find(v=>v.id===body.ontologyVersionId&&v.projectId===projectId&&v.status==='published');if(!ontology)fault('请选择已发布的本体版本。',409);
  const confidence=body.config?.confidence??0.9;if(typeof confidence!=='number'||confidence<0||confidence>1||!Number.isFinite(confidence))fault('置信度分流阈值须在 0～1 之间。');
  if(body.stages!==undefined&&kcStable(body.stages)!==kcStable(kcStages.map(([id])=>id)))fault('当前流水线需按依赖顺序执行全部七个步骤。');
  const providedName=String(body.name??'').trim();if(providedName.length>100)fault('任务名称需为 1～100 字。');
  const name=kcTaskDisplayName({name:providedName,sources});
  const now=kcNow(),task={id:ingId(db,'KC'),projectId,name,revision:1,status:'queued',origin,createdBy:user.id,createdByName:user.name,createdAt:now,updatedAt:now,ontologyVersionId:ontology.id,ontologyNumber:ontology.number,schemaRevision:ontology.revision,schema:clone(ontology.schema),engine:kcEngine,config:{confidence,extractRelations:body.config?.extractRelations!==false,normalizeTerms:body.config?.normalizeTerms!==false},sources,candidates:[],stages:kcStages.map(([id,name])=>({id,name,status:'pending',attempt:0})),error:''};model.tasks.unshift(task);return task;
}
export function kcMutation(db,user,action,body,context={}){
  const model=kcEnsure(db),projectId=body.projectId;kcScope(db,user,projectId);
  const log=(operation,object,details)=>auditEvent(db,user,operation,object,details,{...context,projectId});
  if(action==='create'){const task=kcCreate(db,user,body);log('新建知识抽取任务',task.id,{sources:task.sources.map(s=>s.versionId),ontologyVersionId:task.ontologyVersionId,engine:task.engine});return clone(task);}
  if(action==='event-retry'){
    const event=model.events.find(e=>e.id===body.eventId&&e.projectId===projectId&&e.createdBy===user.id);if(!event||event.status!=='failed')fault('失败事件不存在。',404);
    const trigger=model.triggers.find(t=>t.id===event.triggerId&&t.enabled);if(!trigger)fault('请先启用原触发配置。',409);
    const task=kcCreate(db,user,{projectId,handoffIds:[event.handoffId],ontologyVersionId:trigger.ontologyVersionId,name:'增量事件重试'},'event');event.status='created';event.taskId=task.id;event.error='';event.retriedAt=kcNow();log('重试资料更新事件',event.id,event);return clone(event);
  }
  if(action==='trigger'){
    if(typeof body.enabled!=='boolean'||!['all','stratum','log','trajectory'].includes(body.objectType))fault('触发配置无效。');
    const onto=ontoEnsure(db).versions.find(v=>v.id===body.ontologyVersionId&&v.projectId===projectId&&v.status==='published');if(!onto)fault('触发器需固定已发布本体版本。');
    const existing=body.id?model.triggers.find(t=>t.id===body.id&&t.createdBy===user.id&&t.projectId===projectId):null;if(body.id&&!existing)fault('触发配置不存在。',404);if(existing)kcRevision(existing,body.expectedRevision);
    const trigger={id:existing?.id||ingId(db,'TRG'),projectId,createdBy:user.id,enabled:body.enabled,objectType:body.objectType,ontologyVersionId:onto.id,baselineHandoffs:existing?.baselineHandoffs||ingEnsure(db).handoffs.filter(h=>h.projectId===projectId).map(h=>h.id),revision:(existing?.revision||0)+1,updatedAt:kcNow()};model.triggers=model.triggers.filter(t=>t.id!==trigger.id).concat(trigger);log('配置知识增量触发',trigger.id,trigger);return clone(trigger);
  }
  const task=kcTask(db,user,body.taskId,projectId,['review','issue','sample'].includes(action)?'review':action==='publish'?'publish':'view');
  if(action==='publish'){requirePermission(db,user,'publish',projectId);const existing=model.publications.find(p=>p.taskId===task.id);if(existing)return clone(existing);}
  kcRevision(task,body.expectedRevision);
  if(action==='export-evaluation'){
    requirePermission(db,user,'export',projectId);task.sources.forEach(s=>kcAssetAccess(db,user,s,'export'));const result=model.evaluations.find(e=>e.id===body.evaluationId&&e.taskId===task.id);if(!result)fault('评价记录不存在。',404);log('导出知识抽取评价',result.id,{taskId:task.id});return clone(result);
  }
  if(action==='retry'){
    if(task.status!=='failed')fault('只能重试失败任务。',409);task.stages.filter(s=>s.status==='failed').forEach(s=>{s.status='pending';});task.status='queued';task.error='';task.revision++;log('重试知识抽取',task.id,{});return clone(task);
  }
  if(action==='review'){
    requirePermission(db,user,'review',projectId);if(task.status!=='review')fault('任务尚不可审核或已经发布。',409);
    const c=task.candidates.find(c=>c.id===body.candidateId);if(!c)fault('候选不存在。',404);kcRevision(c,body.candidateRevision);
    if(!['accept','reject','modify'].includes(body.decision))fault('审核操作无效。');
    const note=String(body.note||'').trim();if(!note||note.length>1000)fault('请填写 1～1000 字审核理由。');
    const before={value:clone(c.value),state:c.state,name:c.name};
    const value=body.decision==='modify'?body.value:c.value;
    if(!value||Array.isArray(value)||typeof value!=='object'||kcStable(value).length>12000)fault('候选属性需为 JSON 对象，最多 12000 字。');
    const validKeys=c.kind==='entity'?task.schema.types.find(t=>t.id===c.typeId).fields.map(f=>f.key):['subjectId','objectId'];if(Object.keys(value).some(k=>!validKeys.includes(k)))fault('属性包含本体未定义的字段。');
    const next={...c,value:clone(value)};const errors=kcCheck(task,next);if(body.decision!=='reject'&&errors.length)fault(`候选校验失败：${errors.join('；')}`,409);
    c.value=clone(value);c.state=body.decision==='reject'?'rejected':'accepted';if(c.kind==='entity')c.name=String(kcName(c.typeId,c.value));c.errors=errors;c.revision++;
    c.history.push({decision:body.decision,before,after:{value:clone(c.value),state:c.state,name:c.name},note,reviewer:user.name,reviewerId:user.id,time:kcNow(),revision:c.revision,taskRevision:task.revision+1,ontologyVersionId:task.ontologyVersionId});
    task.revision++;task.updatedAt=kcNow();log('人工校核知识',c.id,c.history.at(-1));return clone(c);
  }
  if(action==='issue'){
    requirePermission(db,user,'review',projectId);const c=task.candidates.find(c=>c.id===body.candidateId);if(!c)fault('候选不存在。',404);
    const note=String(body.note||'').trim();if(!note||note.length>1000)fault('请填写 1～1000 字问题描述。');
    const issue={id:ingId(db,'ISSUE'),projectId,taskId:task.id,candidateId:c.id,evidence:clone(c.evidence),note,createdBy:user.name,createdAt:kcNow(),status:'open'};model.issues.push(issue);task.revision++;task.issues??=[];task.issues.push(issue);log('登记知识问题',issue.id,issue);return clone(issue);
  }
  if(action==='sample'){
    requirePermission(db,user,'review',projectId);if(!['review','published'].includes(task.status))fault('抽取完成后才能标注样本。',409);
    if(!Array.isArray(body.expected)||!body.expected.length||body.expected.length>12000)fault('标注需为非空预期结果数组，最多12000项。');
    for(const item of body.expected)if(!item||!['entity','relation'].includes(item.kind)||typeof item.typeId!=='string'||!item.value||typeof item.value!=='object'||Array.isArray(item.value))fault('每项标注必须包含 kind、typeId 和 value 对象。');
    const name=String(body.name||'专家标注').trim();if(!name||name.length>100)fault('标注名称需为1～100字。');
    const previous=model.samples.filter(s=>s.taskId===task.id),sample={id:ingId(db,'LABEL'),projectId,taskId:task.id,name,number:previous.length+1,expected:clone(body.expected),createdBy:user.name,createdAt:kcNow(),sourceVersions:task.sources.map(s=>s.versionId),ontologyVersionId:task.ontologyVersionId,engine:task.engine};model.samples.push(sample);log('保存专家标注版本',sample.id,{taskId:task.id,number:sample.number});return clone(sample);
  }
  if(action==='evaluate'){
    const sample=model.samples.find(s=>s.id===body.sampleId&&s.taskId===task.id);if(!sample||!task.extractionSnapshot)fault('请选择此任务的专家标注版本。',409);
    const actual=kcEvaluationItems(task),result={id:ingId(db,'EVAL'),projectId,taskId:task.id,sampleId:sample.id,sampleNumber:sample.number,engine:task.engine,ontologyVersionId:task.ontologyVersionId,sourceVersions:task.sources.map(s=>s.versionId),createdAt:kcNow(),createdBy:user.name,...kcMetric(sample.expected,actual)};model.evaluations.push(result);log('评价知识抽取',result.id,{sampleId:sample.id,tp:result.tp,fp:result.fp,fn:result.fn});return clone(result);
  }
  if(action==='publish'){
    if(task.status!=='review'||!task.candidates.length||task.candidates.some(c=>c.state==='pending'))fault('全部候选处理完成后才能发布。',409);
    const accepted=task.candidates.filter(c=>c.state==='accepted');if(!accepted.length)fault('没有可发布的已接受知识。',409);
    for(const c of accepted){const errors=kcCheck(task,c);if(errors.length)fault(`发布校验失败：${errors.join('；')}`,409);if(c.kind==='relation'&&['subjectId','objectId'].some(k=>!accepted.some(e=>e.id===c.value[k]&&e.kind==='entity')))fault('已接受关系的两端实体必须同时接受。',409);}
    // Refuse an older extraction overwriting a release from a newer data version.
    for(const source of task.sources){const number=id=>ingEnsure(db).versions.find(v=>v.id===id)?.number||0;const newer=model.facts.some(f=>f.active&&f.assetId===source.assetId&&number(f.evidence.versionId)>number(source.versionId));if(newer)fault('此资料已有更新版本发布，不能以旧版本覆盖。',409);}
    gmEnsure(db);
    const id=ingId(db,'PUB'),factId=c=>`${id}:${typeof c==='string'?c:c.id}`;
    for(const old of model.facts)if(old.projectId===projectId&&task.sources.some(s=>s.assetId===old.assetId))old.active=false;
    const facts=accepted.map(c=>({id:factId(c),candidateId:c.id,kind:c.kind,typeId:c.typeId,typeName:c.typeName,name:c.kind==='relation'?`${accepted.find(e=>e.id===c.value.subjectId).name} — ${c.typeName} — ${accepted.find(e=>e.id===c.value.objectId).name}`:c.name,value:clone(c.value),...(c.kind==='relation'?{subjectId:factId(c.value.subjectId),objectId:factId(c.value.objectId)}:{}),assetId:c.evidence.assetId,evidence:clone(c.evidence),projectId,taskId:task.id,publicationId:id,ontologyVersionId:task.ontologyVersionId,active:true,history:clone(c.history)}));model.facts.push(...facts);
    const active=model.facts.filter(f=>f.projectId===projectId&&f.active),index=Object.create(null);for(const f of active)for(const word of [...new Set(`${f.name} ${f.typeName}`.split(/\s+/).filter(Boolean))]){index[word]??=[];index[word].push(f.id);}model.indexes[projectId]={publicationId:id,updatedAt:kcNow(),entries:index};model.caches[projectId]={publicationId:id,entityCount:active.filter(f=>f.kind==='entity').length,relationCount:active.filter(f=>f.kind==='relation').length};
    const publication={id,taskId:task.id,projectId,publishedAt:kcNow(),publishedBy:user.name,sourceVersions:task.sources.map(s=>s.versionId),ontologyVersionId:task.ontologyVersionId,factIds:facts.map(f=>f.id),entityCount:facts.filter(f=>f.kind==='entity').length,relationCount:facts.filter(f=>f.kind==='relation').length,refresh:{graph:'本机知识库已更新',index:'本机名称索引已重建',cache:'本机统计缓存已刷新'},external:'外部图数据库、搜索服务与缓存服务未接入'};model.publications.unshift(publication);task.status='published';task.publicationId=id;task.revision++;gmVersion(db,projectId,'知识发布',id,user.name);log('发布已校核知识',id,publication);return clone(publication);
  }
  fault('知识构建操作不存在。',404);
}
// Invoked after a governed handoff is committed. Events are deduplicated per trigger/input version.
export function kcHasEvents(db){
  const model=kcEnsure(db);
  return model.triggers.some(t=>t.enabled&&ingEnsure(db).handoffs.some(h=>{
    if(h.projectId!==t.projectId||t.baselineHandoffs.includes(h.id)||model.events.some(e=>e.triggerId===t.id&&e.handoffId===h.id))return false;
    const asset=db.assets.find(a=>a.id===h.assetId),user=db.users.find(u=>u.id===t.createdBy);if(!asset||!user?.enabled||(t.objectType!=='all'&&asset.objectType!==t.objectType))return false;
    try{kcScope(db,user,t.projectId);kcAssetAccess(db,user,h);return true;}catch{return false;}
  }));
}
export function kcDispatch(db){
  const model=kcEnsure(db),ig=ingEnsure(db);let changed=false;
  for(const trigger of model.triggers.filter(t=>t.enabled))for(const h of ig.handoffs.filter(h=>h.projectId===trigger.projectId)){
    const asset=db.assets.find(a=>a.id===h.assetId);if(!asset||(trigger.objectType!=='all'&&asset.objectType!==trigger.objectType))continue;
    if(trigger.baselineHandoffs.includes(h.id)||model.events.some(e=>e.triggerId===trigger.id&&e.handoffId===h.id))continue;
    const user=db.users.find(u=>u.id===trigger.createdBy);if(!user?.enabled)continue;
    try{kcScope(db,user,trigger.projectId);kcAssetAccess(db,user,h);}catch{continue;}
    const event={id:ingId(db,'EVENT'),projectId:trigger.projectId,triggerId:trigger.id,handoffId:h.id,createdBy:user.id,createdAt:kcNow(),status:'queued',versionId:h.versionId};
    try{const task=kcCreate(db,user,{projectId:trigger.projectId,handoffIds:[h.id],ontologyVersionId:trigger.ontologyVersionId,name:`增量 · ${asset.name}`},'event');event.taskId=task.id;event.status='created';}catch(error){event.status='failed';event.error=error.message;}
    model.events.push(event);auditEvent(db,user,'资料交接触发知识更新',event.id,event,{projectId:trigger.projectId});changed=true;
  }
  return changed;
}
