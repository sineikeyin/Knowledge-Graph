import {clone,fault,can,requirePermission,resourceAllowed,permittedWells,auditEvent} from './access-model.js';
import {ingContentAllowed} from './ingestion-model.js';
import {seedProjects} from './sample-data.js';
import {gmTypes,gmAlgorithms,gmLimits,gmAssert,gmNumber,gmPaths,gmAlgorithm,gmCoordinate,gmSpatial,gmSimilar,gmDiff} from './graph-core.js';

const gmNow=()=>new Date().toISOString();
const gmId=(db,prefix)=>`${prefix}-${db.sequence++}`;
export function gmEnsure(db){
  db.graph??={schema:1,versions:[],snapshots:[],restores:[],jobs:[],spatial:[],demoFacts:[],demoSpatial:[],seededProjects:[]};
  const graph=db.graph;
  // Upgrade existing published data into chronological, immutable graph versions.
  for(const project of db.projects)if(!graph.versions.some(v=>v.projectId===project.id)){
    let facts=[];const publications=(db.construction?.publications||[]).filter(p=>p.projectId===project.id).slice().sort((a,b)=>a.publishedAt.localeCompare(b.publishedAt));
    for(const publication of publications){const released=(db.construction?.facts||[]).filter(f=>f.publicationId===publication.id),assets=new Set(released.map(f=>f.assetId));facts=facts.filter(f=>!assets.has(f.assetId)).concat(released);graph.versions.push({id:gmId(db,'GV'),projectId:project.id,number:graph.versions.filter(v=>v.projectId===project.id).length+1,createdAt:publication.publishedAt,actor:publication.publishedBy,reason:'知识发布',referenceId:publication.id,facts:clone(facts)});}
    const active=(db.construction?.facts||[]).filter(f=>f.projectId===project.id&&f.active);
    if(!publications.length)graph.versions.push({id:gmId(db,'GV'),projectId:project.id,number:1,createdAt:gmNow(),actor:'系统',reason:'初始图谱',referenceId:'',facts:clone(active)});
  }
  return graph;
}
export function gmVersion(db,projectId,reason,referenceId,actor='系统'){
  const graph=gmEnsure(db),version={id:gmId(db,'GV'),projectId,number:gmRevision(db,projectId)+1,createdAt:gmNow(),actor,reason,referenceId,facts:clone((db.construction?.facts||[]).filter(f=>f.projectId===projectId&&f.active))};graph.versions.push(version);return version;
}
function gmRevision(db,projectId){return Math.max(0,...db.graph.versions.filter(v=>v.projectId===projectId).map(v=>v.number));}
function gmScope(db,user,projectId){gmEnsure(db);requirePermission(db,user,'graph',projectId);if(!db.projects.some(p=>p.id===projectId)||!permittedWells(db,user,projectId).length)fault('项目不可访问。',403);}
function gmWell(db,user,projectId,wellId,action='view'){
  const well=db.wells.find(w=>w.id===wellId);if(!well||!db.projects.find(p=>p.id===projectId)?.wells.includes(wellId)||!resourceAllowed(db,user,projectId,'well',wellId,wellId,action))fault('井不存在或不可访问。',403);return well;
}
function gmAsset(db,user,projectId,assetId,action='view'){
  requirePermission(db,user,'data',projectId);
  const asset=db.assets.find(a=>a.id===assetId);if(!asset||!(asset.projectId===projectId||!asset.projectId&&db.projects.find(p=>p.id===projectId)?.wells.includes(asset.wellId)))fault('来源资料不存在或不可访问。',403);
  gmWell(db,user,projectId,asset.wellId,action);
  for(const [kind,id]of [['document',asset.id],['object',`${asset.wellId}-${asset.objectType}`]])if(!resourceAllowed(db,user,projectId,kind,id,asset.wellId,action))fault('来源资料无权访问。',403);
  if(!ingContentAllowed(db,user,{...asset,projectId}))fault('来源包含受限字段，不能查看图谱和证据。',403);return asset;
}
function gmVisible(db,user,projectId,fact,action='view'){try{return Boolean(gmAsset(db,user,projectId,fact.assetId,action));}catch{return false;}}
function gmFilterFacts(db,user,projectId,facts){
  const visible=facts.filter(f=>f.projectId===projectId&&gmVisible(db,user,projectId,f)),ids=new Set(visible.filter(f=>f.kind==='entity').map(f=>f.id));return visible.filter(f=>f.kind==='entity'||ids.has(f.subjectId)&&ids.has(f.objectId));
}
function gmDataset(body){const value=body.dataset??'published';gmAssert(['published','demo'].includes(value),'数据范围无效。');return value;}
function gmRaw(db,projectId,dataset){return dataset==='demo'?db.graph.demoFacts.filter(f=>f.projectId===projectId):(db.construction?.facts||[]).filter(f=>f.projectId===projectId&&f.active);}
function gmBasis(f){return {depthType:f.value.depthType||f.evidence?.depthType,datum:f.value.datum||f.evidence?.datum};}
function gmGraph(db,user,projectId,facts){
  const visible=gmFilterFacts(db,user,projectId,facts),nodes=visible.filter(f=>f.kind==='entity').map(f=>({...clone(f),wellId:db.assets.find(a=>a.id===f.assetId).wellId})),edges=visible.filter(f=>f.kind==='relation').map(f=>({...clone(f),computed:false}));
  const edgeKeys=new Set(edges.map(e=>`${e.subjectId}|${e.typeId}|${e.objectId}`));
  const add=(a,b,typeId,label,reason)=>{const key=`${a.id}|${typeId}|${b.id}`;if(a.id===b.id||edgeKeys.has(key))return;edgeKeys.add(key);edges.push({id:`computed:${a.id}:${typeId}:${b.id}`,kind:'relation',typeId,typeName:label,name:label,subjectId:a.id,objectId:b.id,computed:true,reason,evidence:clone(a.evidence),sourceRefs:[a.id,b.id]});};
  // Derived associations are labelled and do not alter the reviewed knowledge store.
  const grouped=new Map();for(const node of nodes){const list=grouped.get(node.wellId)||[];list.push(node);grouped.set(node.wellId,list);}
  for(const list of grouped.values()){
    const well=list.find(n=>n.typeId==='well');if(well)for(const node of list)if(node!==well)add(node,well,'context_well','同井关联','依据相同授权来源井；计算关系，非人工发布事实');
    const intervals=list.filter(n=>n.typeId==='interval'||n.typeId==='stratum');
    for(const node of list.filter(n=>['log','trajectory'].includes(n.typeId)))for(const interval of intervals){if(edges.length>=gmLimits.edges)break;const a=gmBasis(node),b=gmBasis(interval);if(a.depthType&&a.datum&&a.depthType===b.depthType&&a.datum===b.datum&&Number.isFinite(node.value.depth)&&node.value.depth>=interval.value.top&&node.value.depth<=interval.value.bottom)add(node,interval,'depth_overlap','井段范围关联','同井、同深度类型及参考基准，记录深度位于井段内；包含边界');}
  }
  gmAssert(nodes.length<=gmLimits.nodes&&edges.length<=gmLimits.edges,'图规模超出本机查询上限，请按井筛选。');return {nodes,edges};
}
export function gmSeedDemo(db,projectId){
  const graph=gmEnsure(db);if(graph.seededProjects.includes(projectId))return;
  const project=db.projects.find(p=>p.id===projectId);if(!project)return;
  if(!seedProjects.some(p=>p.id===project.id&&p.name===project.name&&p.block===project.block))return;
  for(const [i,wellId]of project.wells.entries()){
    const w=db.wells.find(w=>w.id===wellId),asset=type=>db.assets.find(a=>a.wellId===wellId&&a.objectType===type&&!a.managed);if(!w)continue;
    const base=3120-i*12,at=type=>asset(type)?.id;if(!at('stratum'))continue;
    const evidence=type=>({assetId:at(type),versionId:'demo-v1',originalVersionId:'demo-v1',fileName:asset(type)?.name,format:'demo',row:1,line:null,raw:'虚构结构化演示记录；无真实上传原件',depthType:'MD',datum:'KB',unit:'m',demo:true});
    const add=(key,type,value,name,sourceType=type)=>{const e={id:`demo:${projectId}:${wellId}:${key}`,projectId,kind:'entity',typeId:type,typeName:gmTypes[type],name,value,assetId:at(sourceType),evidence:evidence(sourceType),publicationId:'demo-release-v1',ontologyVersionId:'demo-schema-v1',active:true,demo:true};if(e.assetId)graph.demoFacts.push(e);return e;};
    const we=add('well','well',{code:w.short,name:w.name,block:project.block},w.short,'stratum'),interval=add('interval','interval',{well:w.short,top:base,bottom:base+w.thickness,depthType:'MD',datum:'KB'},`${w.short} ${base}–${base+w.thickness}`,'stratum'),stratum=add('stratum','stratum',{well:w.short,layer:w.layer,top:base,bottom:base+w.thickness,thickness:w.thickness,depthType:'MD',datum:'KB',upper:'上覆泥岩（演示）',lower:'下伏砂岩（演示）',structure:'示例单斜',standardName:w.layer},w.layer);
    const log=add('log','log',{well:w.short,depth:base+1,curve:'GR',value:80+i*12,valueUnit:'API',layer:w.layer},`${w.short} GR`),trajectory=add('trajectory','trajectory',{well:w.short,depth:base+1,inclination:86+i,azimuth:120+i},`${w.short} 轨迹点`),model=add('model','model',{name:'示例区块地质模型',version:'demo-v1',block:project.block,scope:w.short,source:'虚构模型定义'},`${w.short} 模型`),instruction=add('instruction','instruction',{well:w.short,interval:`${base}–${base+w.thickness} m MD/KB`,time:'2026-11-01T08:00:00+08:00',command:'保持井斜并复核层位（演示）',basis:'示例地层与轨迹记录'},`${w.short} 历史指令`);
    const relate=(a,b,type,label)=>{if(!a.assetId||!b.assetId)return;graph.demoFacts.push({id:`demo:${projectId}:${wellId}:${type}`,projectId,kind:'relation',typeId:type,typeName:label,name:label,subjectId:a.id,objectId:b.id,value:{subjectId:a.id,objectId:b.id},assetId:a.assetId,evidence:clone(a.evidence),demo:true,active:true});};
    relate(interval,we,'belongs','隶属于');relate(interval,stratum,'intersects','钻遇');relate(log,interval,'measures','记录于');relate(trajectory,interval,'traces','描述');relate(model,we,'applies','适用于');relate(model,stratum,'model_layer','模型包含层位');relate(instruction,interval,'targets','指向');relate(instruction,trajectory,'based_on','依据轨迹');
    for(const [kind,x,y]of [['well',i*1600,i*200],['trajectory',i*1600+200,i*200+50]])graph.demoSpatial.push({id:`demo-spatial:${wellId}:${kind}`,projectId,wellId,kind,name:`${w.short} ${kind==='well'?'井口':'轨迹点'}（虚构）`,x,y,crs:'local',frame:`DEMO-${projectId}`,assetId:at(kind==='well'?'stratum':'trajectory'),source:'虚构坐标，单位 m；不得用于实际距离判断',demo:true});
  }
  const first=project.wells[0],source=db.assets.find(a=>a.wellId===first&&a.objectType==='model'&&!a.managed);
  if(source)graph.demoSpatial.push({id:`demo-spatial:${projectId}:fault`,projectId,wellId:first,kind:'fault',name:'示例断层 F1（虚构）',x:600,y:-500,points:[{x:600,y:-500},{x:600,y:2000}],crs:'local',frame:`DEMO-${projectId}`,assetId:source.id,source:'虚构断层折线，单位 m',demo:true});graph.seededProjects.push(projectId);
}
function gmGetView(db,user,projectId,dataset,wellId){
  let facts=gmRaw(db,projectId,dataset);if(wellId){gmWell(db,user,projectId,wellId);facts=facts.filter(f=>db.assets.find(a=>a.id===f.assetId)?.wellId===wellId);}return gmGraph(db,user,projectId,facts);
}
function gmCanReadAll(db,user,projectId,facts,action='view'){return facts.every(f=>gmVisible(db,user,projectId,f,action));}
function gmAllowedRecord(db,user,projectId,item){return gmCanReadAll(db,user,projectId,item.facts)&&item.facts.every(f=>f.kind==='entity'||item.facts.some(n=>n.id===f.subjectId)&&item.facts.some(n=>n.id===f.objectId));}
export function gmDashboard(db,user,projectId,dataset='published'){
  gmScope(db,user,projectId);gmDataset({dataset});gmSeedDemo(db,projectId);
  const graph=db.graph,view=gmGetView(db,user,projectId,dataset),raw=gmRaw(db,projectId,dataset),assets=[...new Set(view.nodes.map(n=>n.assetId))].map(id=>gmAsset(db,user,projectId,id)),revision=gmRevision(db,projectId);
  const versions=graph.versions.filter(v=>v.projectId===projectId).map(v=>{const facts=gmFilterFacts(db,user,projectId,v.facts);return {id:v.id,number:v.number,createdAt:v.createdAt,actor:v.actor,reason:v.reason,referenceId:v.referenceId,entityCount:facts.filter(f=>f.kind==='entity').length,relationCount:facts.filter(f=>f.kind==='relation').length};});
  const visibleSpatial=(dataset==='demo'?graph.demoSpatial:graph.spatial).filter(r=>r.projectId===projectId&&gmVisible(db,user,projectId,r));
  return {projectId,dataset,revision,...view,wells:permittedWells(db,user,projectId).filter(id=>{try{gmWell(db,user,projectId,id);return true;}catch{return false;}}).map(id=>{const w=db.wells.find(w=>w.id===id);return {id,name:w.short};}),assets:assets.map(a=>({id:a.id,name:a.name,wellId:a.wellId,objectType:a.objectType,hasOriginal:Boolean(a.managed)})),types:gmTypes,algorithms:gmAlgorithms,versions,spatial:clone(visibleSpatial),snapshots:graph.snapshots.filter(s=>s.projectId===projectId&&gmAllowedRecord(db,user,projectId,s)).map(({facts,...s})=>({...clone(s),entityCount:facts.filter(f=>f.kind==='entity').length,relationCount:facts.filter(f=>f.kind==='relation').length})),restores:clone(graph.restores.filter(r=>r.projectId===projectId&&graph.snapshots.some(s=>s.id===r.snapshotId&&gmAllowedRecord(db,user,projectId,s))&&graph.snapshots.some(s=>s.id===r.backupId&&gmAllowedRecord(db,user,projectId,s)))),jobs:clone(graph.jobs.filter(j=>j.projectId===projectId&&j.createdBy===user.id&&j.input.dataset===dataset&&gmCanReadAll(db,user,projectId,j.facts)).map(({facts,...j})=>j)),storage:{knowledge:'本机 JSON 版本化知识库',originals:'私有原件目录（有原件的资产可鉴权下载）',index:db.construction?.indexes?.[projectId]?.publicationId||'尚无正式知识索引',activePublicationIds:[...new Set(view.nodes.map(n=>n.publicationId).filter(Boolean))],visibleEntities:view.nodes.length,visibleRelations:view.edges.filter(e=>!e.computed).length,derivedRelations:view.edges.filter(e=>e.computed).length,external:'外部图数据库 / 向量数据库未接入',demo:dataset==='demo'},capabilities:{run:can(db,user,'run',projectId),spatialEdit:can(db,user,'import',projectId),snapshot:can(db,user,'publish',projectId)&&gmCanReadAll(db,user,projectId,raw,'publish'),export:can(db,user,'export',projectId)}};
}
export function gmQuery(db,user,action,body){
  const {projectId}=body;gmScope(db,user,projectId);const dataset=gmDataset(body);gmSeedDemo(db,projectId);const view=gmGetView(db,user,projectId,dataset,body.wellId);
  if(action==='paths'){
    if(body.relation&&body.relation!=='all')gmAssert(view.edges.some(e=>e.typeId===body.relation),'关系类型不存在或不可访问。');
    const result=gmPaths(view.nodes,view.edges,body),ids=new Set(result.paths.flatMap(p=>p.nodes)),edgeIds=new Set(result.paths.flatMap(p=>p.edges));return {...result,nodes:view.nodes.filter(n=>ids.has(n.id)),edges:view.edges.filter(e=>edgeIds.has(e.id)),dataset,revision:gmRevision(db,projectId)};
  }
  if(action==='spatial'){const records=(dataset==='demo'?db.graph.demoSpatial:db.graph.spatial).filter(r=>r.projectId===projectId&&gmVisible(db,user,projectId,r));const target=records.find(r=>r.id===body.targetId);gmAssert(target,'空间目标不存在或不可访问。');if(body.crs!==target.crs||body.frame!==target.frame)fault('输入的坐标系 / 基准与目标记录不一致。');return {...gmSpatial(records,body),dataset};}
  if(action==='similar'){gmWell(db,user,projectId,body.targetWellId);return {rows:gmSimilar(view.nodes,body.targetWellId,body.weights),dataset,method:'结构化语义混合匹配；缺失因素不计分，按有效权重归一化；未接入向量模型',nodes:view.nodes};}
  if(action==='history'){
    const select=id=>{const v=db.graph.versions.find(v=>v.id===id&&v.projectId===projectId);if(!v)fault('历史图版本不存在。',404);return v;},before=select(body.beforeId),after=select(body.afterId);
    let a=gmFilterFacts(db,user,projectId,before.facts),b=gmFilterFacts(db,user,projectId,after.facts);
    const hasDepth=body.minDepth!==undefined&&body.minDepth!==''||body.maxDepth!==undefined&&body.maxDepth!=='';
    if(hasDepth){const min=gmNumber(body.minDepth,'起始井深',0,1e6),max=gmNumber(body.maxDepth,'结束井深',0,1e6);gmAssert(min<=max,'井深范围无效。');gmAssert(['MD','TVD'].includes(body.depthType)&&['KB','MSL','GL'].includes(body.datum),'井深筛选须明确 MD/TVD 和参考基准。');
      const filter=facts=>facts.filter(f=>{if(f.kind!=='entity')return false;const basis=gmBasis(f),top=f.value.top??f.value.depth,bottom=f.value.bottom??f.value.depth;return basis.depthType===body.depthType&&basis.datum===body.datum&&Number.isFinite(top)&&Number.isFinite(bottom)&&bottom>=min&&top<=max;});a=filter(a);b=filter(b);
    }
    if(body.wellId){gmWell(db,user,projectId,body.wellId);a=a.filter(f=>db.assets.find(x=>x.id===f.assetId)?.wellId===body.wellId);b=b.filter(f=>db.assets.find(x=>x.id===f.assetId)?.wellId===body.wellId);}
    for(const [key,value]of [['fromTime',body.fromTime],['toTime',body.toTime]])if(value)gmAssert(Number.isFinite(Date.parse(value)),`${key}时间无效。`);
    if(body.fromTime&&body.toTime)gmAssert(Date.parse(body.fromTime)<=Date.parse(body.toTime),'时间范围无效。');
    const inTime=v=>(!body.fromTime||Date.parse(v.createdAt)>=Date.parse(body.fromTime))&&(!body.toTime||Date.parse(v.createdAt)<=Date.parse(body.toTime));gmAssert(inTime(before)&&inTime(after),'所选版本不在输入的时间范围内。');
    return {before:{id:before.id,number:before.number,createdAt:before.createdAt},after:{id:after.id,number:after.number,createdAt:after.createdAt},rows:gmDiff(a,b),beforeFacts:clone(a),afterFacts:clone(b),depthFiltered:hasDepth};
  }
  fault('图谱查询不存在。',404);
}
function gmRefresh(db,projectId,referenceId){
  db.construction??={tasks:[],samples:[],evaluations:[],triggers:[],events:[],publications:[],facts:[],issues:[],indexes:{},caches:{},permissionVersion:0};db.construction.indexes??={};db.construction.caches??={};const facts=db.construction.facts.filter(f=>f.projectId===projectId&&f.active),entries=Object.create(null);
  for(const f of facts)for(const word of [...new Set(`${f.name} ${f.typeName}`.split(/\s+/).filter(Boolean))]){entries[word]??=[];entries[word].push(f.id);}
  db.construction.indexes[projectId]={publicationId:referenceId,updatedAt:gmNow(),entries};db.construction.caches[projectId]={publicationId:referenceId,entityCount:facts.filter(f=>f.kind==='entity').length,relationCount:facts.filter(f=>f.kind==='relation').length};return facts;
}
function gmSnapshot(db,user,projectId,name,reason='手动创建'){
  gmAssert(db.graph.snapshots.filter(s=>s.projectId===projectId).length<100,'每项目最多 100 个图快照，请先归档备份。');const facts=gmRaw(db,projectId,'published');
  if(!gmCanReadAll(db,user,projectId,facts,'publish'))fault('需要完整图谱与来源资料的发布权限才能创建或恢复项目快照。',403);
  const id=gmId(db,'GS'),snapshot={id,projectId,name,reason,createdAt:gmNow(),createdBy:user.name,version:gmRevision(db,projectId),facts:clone(facts),scope:'仅正式知识图和本机名称索引 / 统计缓存；不覆盖原件、治理记录、本体、用户权限和空间坐标'};db.graph.snapshots.unshift(snapshot);return snapshot;
}
export function gmMutation(db,user,action,body,context={}){
  const {projectId}=body;gmScope(db,user,projectId);const graph=db.graph,log=(operation,id,detail)=>auditEvent(db,user,operation,id,detail,{...context,projectId});
  if(action==='algorithm'){
    requirePermission(db,user,'run',projectId);const dataset=gmDataset(body);gmSeedDemo(db,projectId);const view=gmGetView(db,user,projectId,dataset,body.wellId),facts=gmFilterFacts(db,user,projectId,gmRaw(db,projectId,dataset)).filter(f=>!body.wellId||db.assets.find(a=>a.id===f.assetId)?.wellId===body.wellId);
    if(body.relation&&body.relation!=='all')gmAssert(view.edges.some(e=>e.typeId===body.relation),'关系类型不存在或不可访问。');
    const result=gmAlgorithm(view.nodes,view.edges,body),job={id:gmId(db,'GA'),projectId,createdBy:user.id,createdByName:user.name,createdAt:gmNow(),finishedAt:gmNow(),status:'done',progress:100,revision:gmRevision(db,projectId),input:clone({...body,dataset}),nodeCount:view.nodes.length,edgeCount:view.edges.length,result,names:Object.fromEntries(view.nodes.map(n=>[n.id,n.name])),facts:clone(facts)};graph.jobs.unshift(job);const own=graph.jobs.filter(j=>j.projectId===projectId&&j.createdBy===user.id);for(const stale of own.slice(30))graph.jobs=graph.jobs.filter(j=>j.id!==stale.id);log('执行图算法',job.id,{algorithm:body.algorithm,dataset,nodeCount:job.nodeCount});const {facts:_,...publicJob}=job;return clone(publicJob);
  }
  if(action==='spatial-save'){
    requirePermission(db,user,'import',projectId);const well=gmWell(db,user,projectId,body.wellId,'import');const asset=gmAsset(db,user,projectId,body.assetId,'import');gmAssert(asset.wellId===well.id,'空间记录与来源资料须属于同一井。');
    const coordinate=gmCoordinate(body),kind=body.kind;gmAssert(['well','trajectory','fault'].includes(kind),'空间对象类型无效。');
    const name=String(body.name||'').trim(),source=String(body.source||'').trim();gmAssert(name.length>0&&name.length<=100&&source.length>0&&source.length<=500,'请填写名称（最多100字）及坐标来源说明（最多500字）。');
    let points;if(kind==='fault'){gmAssert(coordinate.crs==='local','断层折线请使用统一米制 local 坐标。');gmAssert(Array.isArray(body.points)&&body.points.length>=2&&body.points.length<=200,'断层需提供 2～200 个折线点。');points=body.points.map(p=>{const point=gmCoordinate({...p,crs:coordinate.crs,frame:coordinate.frame});return {x:point.x,y:point.y};});}
    const existing=body.id?graph.spatial.find(r=>r.id===body.id&&r.projectId===projectId):null;if(body.id&&!existing)fault('空间记录不存在。',404);if(existing){gmAsset(db,user,projectId,existing.assetId,'import');if(existing.revision!==body.expectedRevision)fault('空间记录已更新，请刷新。',409);}
    gmAssert(existing||graph.spatial.filter(r=>r.projectId===projectId).length<2000,'空间记录超过本机上限。');
    const record={id:existing?.id||gmId(db,'SP'),projectId,wellId:well.id,assetId:asset.id,name,kind,...coordinate,...(points?{points}:{}),source,revision:(existing?.revision||0)+1,updatedAt:gmNow(),updatedBy:user.name};graph.spatial=graph.spatial.filter(r=>r.id!==record.id).concat(record);log('保存图谱空间坐标',record.id,{revision:record.revision,assetId:record.assetId,crs:record.crs,frame:record.frame});return clone(record);
  }
  if(action==='snapshot'||action==='restore'){
    requirePermission(db,user,'publish',projectId);if(body.expectedRevision!==gmRevision(db,projectId))fault('图谱版本已变化，请刷新后确认。',409);
    if(action==='snapshot'){
      const name=String(body.name||'').trim();gmAssert(name.length>0&&name.length<=100,'快照名称需为 1～100 字。');const snapshot=gmSnapshot(db,user,projectId,name);log('创建图谱快照',snapshot.id,{version:snapshot.version});const {facts,...metadata}=snapshot;return {...clone(metadata),entityCount:facts.filter(f=>f.kind==='entity').length,relationCount:facts.filter(f=>f.kind==='relation').length};
    }
    const snapshot=graph.snapshots.find(s=>s.id===body.snapshotId&&s.projectId===projectId);if(!snapshot)fault('快照不存在。',404);
    gmAssert(body.confirm===snapshot.id,'请输入完整快照编号确认恢复。');
    const current=gmRaw(db,projectId,'published');if(!gmCanReadAll(db,user,projectId,[...current,...snapshot.facts],'publish'))fault('恢复需要当前和快照全部来源的发布权限。',403);
    const ids=new Set(snapshot.facts.map(f=>f.id)),entities=new Set(snapshot.facts.filter(f=>f.kind==='entity').map(f=>f.id));gmAssert(snapshot.facts.every(f=>f.kind==='entity'||entities.has(f.subjectId)&&entities.has(f.objectId)),'快照包含悬空关系，不能恢复。');
    gmAssert(snapshot.facts.every(f=>(db.construction?.facts||[]).some(k=>k.id===f.id)),'快照知识记录缺失，不能恢复。');
    const backup=gmSnapshot(db,user,projectId,`恢复前自动备份 ${snapshot.id}`,'恢复前自动备份');
    for(const fact of db.construction?.facts||[])if(fact.projectId===projectId)fact.active=ids.has(fact.id);
    const restored=gmRefresh(db,projectId,snapshot.id);gmAssert(restored.length===snapshot.facts.length,'恢复核查失败。');
    const version=gmVersion(db,projectId,'快照恢复',snapshot.id,user.name),record={id:gmId(db,'GR'),projectId,snapshotId:snapshot.id,backupId:backup.id,createdAt:gmNow(),createdBy:user.name,status:'verified',progress:100,version:version.number,checks:{entityCount:restored.filter(f=>f.kind==='entity').length,relationCount:restored.filter(f=>f.kind==='relation').length,danglingRelations:0,index:'名称索引已重建',cache:'统计缓存已刷新',verified:true},stages:['权限与版本核对','恢复前自动备份','原子切换正式知识','重建索引与缓存','数量与关系完整性核查']};graph.restores.unshift(record);log('恢复并核查图谱快照',record.id,record);return clone(record);
  }
  fault('图谱操作不存在。',404);
}
