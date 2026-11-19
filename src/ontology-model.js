import {clone,fault,can,requirePermission,permittedWells,auditEvent,isAdmin} from './access-model.js';
import {ontoTemplate,ontoTemplates,ontoShape,ontoValidate,ontoDiff} from './ontology-core.js';
import {ingEnsure,ingFindAsset} from './ingestion-model.js';

export function ontoEnsure(db){
  db.ontology??={versions:[],bindings:[],permissionVersion:0};
  if(!db.ontology.permissionVersion){
    // Add the new module capabilities once; subsequent custom role changes are preserved.
    const additions={admin:['ontology','ontology-edit','ontology-review','ontology-publish'],manager:['ontology','ontology-edit','ontology-publish'],engineer:['ontology','ontology-edit'],expert:['ontology','ontology-review']};
    for(const role of db.roles)if(additions[role.id])role.permissions=[...new Set([...role.permissions,...additions[role.id]])];
    db.ontology.permissionVersion=1;
  }
  return db.ontology;
}
function ontoScope(db,user,projectId,permission){if(!db.projects.some(p=>p.id===projectId)||!permittedWells(db,user,projectId).length)fault('项目不可访问。',403);requirePermission(db,user,permission,projectId);}
function ontoVersion(db,id,projectId){const v=ontoEnsure(db).versions.find(v=>v.id===id&&v.projectId===projectId);if(!v)fault('本体版本不存在或不可访问。',404);return v;}
export function ontoImpact(db,version,user){
  const ig=ingEnsure(db);const previous=ontoEnsure(db).versions.filter(v=>v.projectId===version.projectId&&v.status==='published'&&v.id!==version.id).at(-1);
  const visibleAsset=id=>{if(!user)return false;try{ingFindAsset(db,user,id,'view',true);return true;}catch{return false;}};
  return {baseVersionId:previous?.id||'',changes:ontoDiff(previous?.schema,version.schema),mappings:version.schema.mappings.map(m=>({id:m.id,name:m.name})),rules:[{id:db.rule.id,name:db.rule.name,note:'当前厚度差规则独立运行；变更地层、厚度字段时需人工核对。'}],indexes:{status:'未接入图数据库或搜索索引',fields:version.schema.types.flatMap(t=>t.fields.map(f=>`${t.id}.${f.key}`))},boundInputs:clone(ontoEnsure(db).bindings.filter(b=>b.projectId===version.projectId&&visibleAsset(b.assetId))),pendingHandoffs:ig.handoffs.filter(h=>h.projectId===version.projectId&&visibleAsset(h.assetId)).length};
}
export function ontoDashboard(db,user,projectId){
  ontoScope(db,user,projectId,'ontology');const model=ontoEnsure(db);
  return {projectId,templates:ontoTemplates,versions:clone(model.versions.filter(v=>v.projectId===projectId)),capabilities:Object.fromEntries(['ontology-edit','ontology-review','ontology-publish'].map(p=>[p,can(db,user,p,projectId)]))};
}
export function ontoPublished(db,user,projectId){ontoScope(db,user,projectId,'construction');return {versions:clone(ontoEnsure(db).versions.filter(v=>v.projectId===projectId&&v.status==='published').map(({id,name,number,publishedAt,revision})=>({id,name,number,publishedAt,revision}))),bindings:clone(ontoEnsure(db).bindings.filter(b=>b.projectId===projectId).filter(b=>{try{ingFindAsset(db,user,b.assetId,'view',true);return true;}catch{return false;}}))};}
export function ontoMutation(db,user,action,body,context={}){
  const model=ontoEnsure(db),projectId=body.projectId;
  ontoScope(db,user,projectId,action==='bind'?'construction':'ontology');
  const permission={create:'ontology-edit',save:'ontology-edit',submit:'ontology-edit',approve:'ontology-review',reject:'ontology-review',publish:'ontology-publish',bind:'construction'}[action];if(!permission)fault('本体操作不存在。',404);requirePermission(db,user,permission,projectId);
  const audit=(operation,id,details)=>auditEvent(db,user,operation,id,details,{...context,projectId});
  if(action==='bind'){
    const handoff=ingEnsure(db).handoffs.find(h=>h.id===body.handoffId&&h.projectId===projectId);if(!handoff)fault('资料交接不存在。',404);ingFindAsset(db,user,handoff.assetId,'view',true);
    const version=ontoVersion(db,body.versionId,projectId);if(version.status!=='published')fault('只能选择已发布的本体版本。',409);
    const existing=model.bindings.find(b=>b.handoffId===handoff.id);if((existing?.revision||0)!==body.expectedRevision)fault('本体选择已被其他操作更新，请刷新。',409);
    const binding={handoffId:handoff.id,assetId:handoff.assetId,dataVersionId:handoff.versionId,projectId,versionId:version.id,schemaRevision:version.revision,revision:(existing?.revision||0)+1,selectedBy:user.name,selectedAt:new Date().toISOString()};model.bindings=model.bindings.filter(b=>b.handoffId!==handoff.id).concat(binding);audit('选择知识构建本体',handoff.id,binding);return clone(binding);
  }
  if(action==='create'){
    const base=body.baseVersionId?ontoVersion(db,body.baseVersionId,projectId):null;
    if(!base&&!ontoTemplates.some(t=>t.id===body.templateId))fault('请选择有效模板。');
    const number=Math.max(0,...model.versions.filter(v=>v.projectId===projectId).map(v=>v.number))+1;
    const name=String(body.name||`${db.projects.find(p=>p.id===projectId).name}本体`).trim();if(!name||name.length>100)fault('本体名称需为 1～100 字。');
    const version={id:`ONTO-${db.sequence++}`,projectId,name,number,revision:1,status:'draft',baseVersionId:base?.id||'',templateId:base?.templateId||body.templateId,schema:clone(base?.schema||ontoTemplate(body.templateId)),createdBy:user.id,createdByName:user.name,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),history:[]};model.versions.push(version);audit('创建本体草稿',version.id,{baseVersionId:version.baseVersionId,templateId:version.templateId});return clone(version);
  }
  const version=ontoVersion(db,body.versionId,projectId);if(version.revision!==body.expectedRevision)fault('本体版本已变化，请重新打开后操作。',409);
  if(action==='save'){
    if(version.status!=='draft')fault('只有草稿可以编辑；其他状态请复制为新版本。',409);
    let schema;try{schema=ontoShape(body.schema);}catch(error){fault(error.message);}version.schema=schema;version.revision++;version.updatedAt=new Date().toISOString();audit('保存本体草稿',version.id,{revision:version.revision,validation:ontoValidate(schema)});return clone(version);
  }
  if(action==='submit'){
    if(version.status!=='draft')fault('只有草稿可以送审。',409);const validation=ontoValidate(version.schema);if(!validation.valid)fault(`Schema 校验未通过：${validation.errors[0].message}`,409);
    version.status='submitted';version.submittedBy=user.id;
  }
  if(['approve','reject'].includes(action)){
    if(version.status!=='submitted')fault('只有待审批版本可以审批。',409);if(version.submittedBy===user.id&&!isAdmin(db,user))fault('请由其他具备审批权限的人员审批。',403);
    if(!String(body.note||'').trim()||String(body.note).length>1000)fault('请填写 1～1000 字审批意见。');version.status=action==='approve'?'approved':'draft';version.reviewedBy=user.id;version.reviewNote=String(body.note).trim();
  }
  if(action==='publish'){
    if(version.status!=='approved')fault('只有已批准版本可以发布。',409);if(!ontoValidate(version.schema).valid)fault('Schema 校验未通过。',409);if(body.confirmImpact!==true)fault('请先核对并确认发布影响。',409);
    version.status='published';version.publishedAt=new Date().toISOString();version.publishedBy=user.name;
    const {boundInputs,pendingHandoffs,...releaseImpact}=ontoImpact(db,version,user);version.releaseImpact=clone(releaseImpact);
  }
  version.revision++;version.updatedAt=new Date().toISOString();version.history.push({action,by:user.name,time:version.updatedAt,note:['approve','reject'].includes(action)?version.reviewNote:'',revision:version.revision});audit({submit:'本体送审',approve:'批准本体',reject:'退回本体',publish:'发布本体'}[action],version.id,{revision:version.revision,note:body.note||'',status:version.status});return clone(version);
}
