import {objectTypes} from './data.js';
import {workspace,can,requirePermission,resourceAllowed,protectFields,auditEvent,clone,fault} from './access-model.js';
import {ingKey,ingParse,ingGuess,ingNormalize,ingValidate,ingFieldSets,ingRuleCatalog} from './ingestion-core.js';

export function ingEnsure(db){db.ingestion??={schema:1,versions:[],jobs:[],aliases:[],handoffs:[],mappingRevisions:{}};return db.ingestion;}
export function ingId(db,prefix){return `${prefix}-${db.sequence++}`;}
export function ingScope(db,user,projectId,wellId,action='view',asset){
  const project=db.projects.find(item=>item.id===projectId);const well=db.wells.find(item=>item.id===wellId);
  if(!project||!well||!project.wells.includes(wellId))fault('项目与井归属不匹配。',403);
  requirePermission(db,user,'data',projectId);if(action!=='view')requirePermission(db,user,'import',projectId);
  for(const [kind,id]of [['well',wellId],...(asset?[['document',asset.id],['object',`${wellId}-${asset.objectType}`]]:[])])if(!resourceAllowed(db,user,projectId,kind,id,wellId,action))fault('无权访问此资料或执行此操作。',403);
  return {project,well};
}
export function ingContentAllowed(db,user,asset){
  const probe={...asset,layer:'',depth:'',thickness:'',distance:'',source:asset.source||''};
  const doc=protectFields(db,user,asset.projectId,'document',probe,asset.wellId);
  const well=protectFields(db,user,asset.projectId,'well',{...db.wells.find(item=>item.id===asset.wellId),layer:'',depth:'',thickness:'',distance:'',source:''},asset.wellId);
  return ['layer','depth','thickness','distance','source'].every(key=>key in doc&&key in well);
}
export function ingFindAsset(db,user,id,action='view',content=false){
  const asset=db.assets.find(item=>item.id===id);if(!asset)fault('资料不存在或不可访问。',404);
  const projectId=asset.projectId||db.projects.find(item=>item.wells.includes(asset.wellId))?.id;
  ingScope(db,user,projectId,asset.wellId,action,asset);
  if(content&&!ingContentAllowed(db,user,{...asset,projectId}))fault('资料包含受限字段，不能访问原件、解析内容或治理结果。',403);
  return asset;
}
export function ingMappingRevision(db,asset){return ingEnsure(db).mappingRevisions[`${asset.projectId}:${asset.wellId}`]||0;}
export function ingStandards(db,asset){
  const aliases=ingEnsure(db).aliases.filter(item=>item.projectId===asset.projectId&&item.wellId===asset.wellId);
  const well=db.wells.find(item=>item.id===asset.wellId);
  return {well,aliases,block:db.projects.find(project=>project.id===asset.projectId)?.block,layers:[...new Set([well.layer,...aliases.filter(item=>item.kind==='layer').map(item=>item.standardName)].filter(Boolean))]};
}
export function ingSyncAsset(db,asset){
  const version=ingEnsure(db).versions.find(item=>item.id===asset.currentVersionId);if(!version)return;
  const stale=Boolean(version.parsed&&version.mappingRevision!==ingMappingRevision(db,asset));
  asset.version=`v${version.number}`;asset.status=stale?'待重新标准化':version.status;asset.quality=stale?'未校验':version.qualityRuns.at(-1)?.status||'未校验';asset.tone=asset.quality==='通过'?'teal':asset.quality==='阻断'?'red':'amber';
}
export function ingRecordUpload(db,user,input,context={}){
  const {project,well}=ingScope(db,user,input.projectId,input.wellId,'import');
  const type=objectTypes.find(item=>item.id===input.objectType);if(!type)fault('资料类型无效。');
  if(!resourceAllowed(db,user,project.id,'object',`${well.id}-${type.id}`,well.id,'import'))fault('无权向该类型对象导入资料。',403);
  let asset;
  if(input.assetId){asset=ingFindAsset(db,user,input.assetId,'import',true);if(asset.projectId!==project.id||asset.wellId!==well.id||asset.objectType!==type.id)fault('新版本归属与原资产不一致。');if(asset.currentVersionId!==input.expectedVersionId)fault('资料已更新，请刷新后再上传版本。',409);}
  const ig=ingEnsure(db);
  const same=ig.versions.find(version=>version.hash===input.hash&&version.fileName===input.name&&db.assets.some(item=>item.id===version.assetId&&item.projectId===project.id&&item.wellId===well.id&&item.objectType===type.id));
  if(same&&(!asset||same.assetId===asset.id)){
    const existing=db.assets.find(item=>item.id===same.assetId);ingFindAsset(db,user,existing.id,'import',true);return {assetId:existing.id,versionId:same.id,duplicate:true};
  }
  if(!asset){asset={id:ingId(db,'ASSET'),projectId:project.id,wellId:well.id,objectType:type.id,type:type.type,name:input.name,source:'本地文件',uploadedAt:new Date().toISOString(),uploader:user.name,managed:true};db.assets.unshift(asset);}
  const previous=asset.currentVersionId||'';const number=ig.versions.filter(version=>version.assetId===asset.id).length+1;
  const initialConfig={fields:{},defaults:{},patches:[]};
  for(const [key]of ingFieldSets[type.id]||[]){for(const kind of ['fields','defaults']){const value=String(input.config?.[kind]?.[key]??'');if(value.length>100)fault('字段或默认值不能超过 100 字。');initialConfig[kind][key]=value;}}
  const version={id:ingId(db,'VER'),assetId:asset.id,number,parentId:previous,fileId:input.fileId,fileName:input.name,size:input.size,hash:input.hash,encoding:input.encoding,createdAt:new Date().toISOString(),createdBy:user.name,status:'待解析',config:input.config?initialConfig:{},qualityRuns:[],mappingRevision:ingMappingRevision(db,asset),reason:previous?'上传新原件':'首次上传'};
  ig.versions.push(version);asset.currentVersionId=version.id;ingSyncAsset(db,asset);
  const job={id:ingId(db,'PARSE'),assetId:asset.id,versionId:version.id,status:'待解析',attempt:1,createdAt:version.createdAt,error:''};ig.jobs.unshift(job);
  auditEvent(db,user,'上传资料',asset.id,{versionId:version.id,fileName:input.name,size:input.size},{...context,projectId:project.id,wellId:well.id});
  return {assetId:asset.id,versionId:version.id,jobId:job.id,duplicate:false};
}
export function ingSetParsed(db,jobId,parsed,error){
  const ig=ingEnsure(db),job=ig.jobs.find(item=>item.id===jobId);if(!job)return;
  const version=ig.versions.find(item=>item.id===job.versionId);const asset=db.assets.find(item=>item.id===job.assetId);if(!version||!asset)return;
  job.finishedAt=new Date().toISOString();job.error=error||'';job.status=error?'失败':'完成';version.status=error?'解析失败':'待校验';
  if(!error){try{version.parsed=parsed;version.config=version.config.fields?version.config:{fields:ingGuess(parsed.headers,asset.objectType),defaults:{},patches:[]};version.mappingRevision=ingMappingRevision(db,asset);version.rows=ingNormalize(parsed,asset.objectType,version.config,ingStandards(db,asset));version.parserVersion=parsed.parserVersion;}catch(cause){job.error=cause.message;job.status='失败';version.status='解析失败';}}
  if(asset.currentVersionId===version.id)ingSyncAsset(db,asset);
}
export function ingDashboard(db,user,projectId){
  ingEnsure(db);const ws=workspace(db,user);const project=ws.projects.find(item=>item.id===projectId);if(!project||!can(db,user,'data',projectId))fault('项目不可访问。',403);
  const assets=ws.assets.filter(item=>project.wells.includes(item.wellId)).map(item=>{const raw=db.assets.find(asset=>asset.id===item.id);const full=raw.managed&&ingContentAllowed(db,user,raw);const version=db.ingestion.versions.find(version=>version.id===raw.currentVersionId);return {...item,contentAllowed:Boolean(full),mappingStale:Boolean(full&&version?.parsed&&version.mappingRevision!==ingMappingRevision(db,raw)),canEdit:Boolean(full&&can(db,user,'import',projectId)&&resourceAllowed(db,user,projectId,'document',item.id,item.wellId,'import')&&resourceAllowed(db,user,projectId,'object',`${item.wellId}-${item.objectType}`,item.wellId,'import')&&resourceAllowed(db,user,projectId,'well',item.wellId,item.wellId,'import')),canSubmit:Boolean(full&&can(db,user,'construction',projectId)&&can(db,user,'import',projectId)),hasFile:Boolean(raw.managed)};});
  const fullIds=new Set(assets.filter(item=>item.contentAllowed).map(item=>item.id));
  const aliasWells=ws.wells.filter(well=>project.wells.includes(well.id)&&['layer','depth','thickness','distance','source'].every(key=>key in protectFields(db,user,projectId,'well',{...well,layer:'',depth:'',thickness:'',distance:'',source:''},well.id))).map(well=>well.id);
  return {projectId,assets,wells:ws.wells.filter(well=>project.wells.includes(well.id)),jobs:clone(db.ingestion.jobs.filter(job=>fullIds.has(job.assetId))),aliases:clone(db.ingestion.aliases.filter(item=>item.projectId===projectId&&aliasWells.includes(item.wellId))),handoffs:clone(db.ingestion.handoffs.filter(item=>fullIds.has(item.assetId))),rules:ingRuleCatalog,capabilities:{editWells:aliasWells.filter(id=>can(db,user,'import',projectId)&&resourceAllowed(db,user,projectId,'well',id,id,'import')),construct:can(db,user,'construction',projectId)}};
}
export function ingDetail(db,user,assetId){
  const asset=ingFindAsset(db,user,assetId);const projectId=asset.projectId||db.projects.find(project=>project.wells.includes(asset.wellId)).id;
  const dashboard=ingDashboard(db,user,projectId);const metadata=dashboard.assets.find(item=>item.id===asset.id);
  if(!asset.managed||!metadata.contentAllowed)return {asset:metadata,versions:[],jobs:[],handoffs:[]};
  const versions=ingEnsure(db).versions.filter(item=>item.assetId===asset.id).map(item=>{const {fileId,...publicVersion}=clone(item);return publicVersion;});
  return {asset:metadata,versions,jobs:dashboard.jobs.filter(job=>job.assetId===asset.id),handoffs:dashboard.handoffs.filter(item=>item.assetId===asset.id)};
}
export function ingMutation(db,user,action,body,context={}){
  const ig=ingEnsure(db);
  if(action==='alias'){
    const {well}=ingScope(db,user,body.projectId,body.wellId,'import');
    const probe={projectId:body.projectId,wellId:well.id,id:'',source:''};if(!ingContentAllowed(db,user,probe))fault('字段受限，不能配置主数据。',403);
    if(!['well','layer','lithology','block'].includes(body.kind))fault('主数据类型不支持。');
    const rawName=String(body.rawName||'').trim(),standardName=String(body.standardName||'').trim();if(!rawName||!standardName||rawName.length>100||standardName.length>100)fault('原始名与标准名需为 1～100 字。');
    if(body.kind==='well'&&![well.id,well.name,well.short].some(name=>ingKey(name)===ingKey(standardName)))fault('井别名只能指向本次归属井。');
    if(body.kind==='block'&&ingKey(standardName)!==ingKey(db.projects.find(project=>project.id===body.projectId).block))fault('区块别名只能指向当前项目区块。');
    const key=`${body.projectId}:${well.id}`;const existing=ig.aliases.find(item=>item.projectId===body.projectId&&item.wellId===well.id&&item.kind===body.kind&&ingKey(item.rawName)===ingKey(rawName));
    if(existing&&existing.standardName!==standardName&&body.expectedRevision!==existing.revision)fault('此别名已存在其他映射，请打开原记录编辑并确认。',409);
    if(existing&&existing.standardName===standardName)return clone(existing);
    const entry={id:existing?.id||ingId(db,'MAP'),projectId:body.projectId,wellId:well.id,kind:body.kind,rawName,standardName,revision:(existing?.revision||0)+1,updatedAt:new Date().toISOString(),updatedBy:user.name};
    ig.aliases=ig.aliases.filter(item=>item.id!==entry.id).concat(entry);ig.mappingRevisions[key]=(ig.mappingRevisions[key]||0)+1;
    for(const asset of db.assets.filter(item=>item.managed&&item.projectId===body.projectId&&item.wellId===well.id))ingSyncAsset(db,asset);
    auditEvent(db,user,'确认主数据映射',entry.id,{before:existing||null,after:entry},{...context,projectId:body.projectId,wellId:well.id});return clone(entry);
  }
  const asset=ingFindAsset(db,user,body.assetId,'import',true);const version=ig.versions.find(item=>item.id===asset.currentVersionId);
  if(!version)fault('此资料没有原件版本，请先上传。');if(body.versionId!==version.id)fault('当前版本已变化，请刷新后操作。',409);
  const audit=(operation,details={})=>auditEvent(db,user,operation,asset.id,details,{...context,projectId:asset.projectId,wellId:asset.wellId});
  if(action==='retry'){
    if(version.status!=='解析失败')fault('只能重试失败的解析任务。');
    const last=ig.jobs.find(job=>job.versionId===version.id);version.status='待解析';const job={id:ingId(db,'PARSE'),assetId:asset.id,versionId:version.id,status:'待解析',attempt:(last?.attempt||0)+1,createdAt:new Date().toISOString(),error:''};ig.jobs.unshift(job);ingSyncAsset(db,asset);audit('重试资料解析',{jobId:job.id});return clone(job);
  }
  if(!version.parsed||!version.rows)fault('解析尚未完成。');
  if(action==='standardize'||action==='correct'){
    if(ig.jobs.some(job=>job.versionId===version.id&&['待解析','解析中'].includes(job.status)))fault('请等待解析任务结束。');
    let config=clone(version.config);
    if(action==='standardize'){
      const validFields=(ingFieldSets[asset.objectType]||[]).map(([key])=>key);if(!validFields.length)fault('该资料类型暂无治理模板。');
      config.fields={};config.defaults={};
      for(const key of validFields){const field=String(body.fields?.[key]||''),value=String(body.defaults?.[key]||'');if(field&&!version.parsed.headers.includes(field)||value.length>100)fault('字段映射或默认值不合法。');config.fields[key]=field;config.defaults[key]=value;}
      config.patches=[];
    }else{
      const index=Number(body.row)-1;const key=body.field;const value=String(body.value??'');
      if(!Number.isInteger(index)||index<0||index>=version.rows.length||!(ingFieldSets[asset.objectType]||[]).some(([field])=>field===key)||value.length>4096)fault('修正行、字段或内容不合法。');
      config.patches=(config.patches||[]).filter(patch=>!(patch.row===index&&patch.field===key)).concat({row:index,field:key,value});
    }
    const parsed=clone(version.parsed),effective=clone(parsed);
    for(const patch of config.patches||[]){let header=config.fields[patch.field];if(!header){header=`__corrected_${patch.field}`;effective.headers.push(header);effective.rows.forEach(row=>row.push(config.defaults?.[patch.field]||''));config.fields[patch.field]=header;}effective.rows[patch.row][effective.headers.indexOf(header)]=patch.value;}
    const next={...clone(version),id:ingId(db,'VER'),number:ig.versions.filter(item=>item.assetId===asset.id).length+1,parentId:version.id,createdAt:new Date().toISOString(),createdBy:user.name,status:'待校验',reason:action==='correct'?`修正第 ${body.row} 行 ${body.field}`:'更新字段与主数据映射',config,parsed:effective,qualityRuns:[],mappingRevision:ingMappingRevision(db,asset)};
    // Materialize patches once into this immutable input snapshot, then reset patch history for future edits.
    next.rows=ingNormalize(effective,asset.objectType,{...config,patches:[]},ingStandards(db,asset));next.config.patches=[];
    ig.versions.push(next);asset.currentVersionId=next.id;ingSyncAsset(db,asset);audit(action==='correct'?'修正标准数据':'标准化资料',{from:version.id,to:next.id,reason:next.reason});return {assetId:asset.id,versionId:next.id};
  }
  if(version.mappingRevision!==ingMappingRevision(db,asset))fault('主数据映射已更新，请先重新标准化，再进行校验或交接。',409);
  if(action==='validate'){
    const options={};for(const key of ['min','max','maxGap','maxJump']){const value=body.options?.[key];options[key]=value===''||value===null||value===undefined?null:Number(value);if(options[key]!==null&&!Number.isFinite(options[key]))fault('质量阈值必须是合法数字。');}if(options.min!==null&&options.max!==null&&options.min>options.max)fault('曲线最小值不能大于最大值。');if(['maxGap','maxJump'].some(key=>options[key]!==null&&options[key]<=0))fault('采样间距和突变阈值需大于零。');
    const result=ingValidate(version.rows,asset.objectType,ingStandards(db,asset),options);const run={id:ingId(db,'QA'),versionId:version.id,ruleVersion:'quality-v1',mappingRevision:version.mappingRevision,createdAt:new Date().toISOString(),createdBy:user.name,options,...result};version.qualityRuns.push(run);version.status='处理完成';ingSyncAsset(db,asset);audit('校验资料',{versionId:version.id,runId:run.id,status:run.status});return clone(run);
  }
  if(action==='handoff'){
    requirePermission(db,user,'construction',asset.projectId);const quality=version.qualityRuns.at(-1);
    if(!quality||quality.status==='阻断'||quality.mappingRevision!==version.mappingRevision)fault('当前版本尚未通过质量校验，不能构建知识。',409);
    if(quality.status==='警告'&&body.confirmWarnings!==true)fault('存在警告，请确认问题后再提交。',409);
    const existing=ig.handoffs.find(item=>item.assetId===asset.id&&item.versionId===version.id);if(existing)return clone(existing);
    const handoff={id:ingId(db,'BUILD'),assetId:asset.id,versionId:version.id,qualityRunId:quality.id,projectId:asset.projectId,wellId:asset.wellId,recordCount:version.rows.length,createdAt:new Date().toISOString(),createdBy:user.name,status:'待知识构建',warningsConfirmed:body.confirmWarnings===true};ig.handoffs.unshift(handoff);audit('提交知识构建',handoff);return clone(handoff);
  }
  fault('治理操作不存在。',404);
}
