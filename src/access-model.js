import {seedProjects, seedWells, seedTasks} from './sample-data.js';
import {objectTypes, defaultRule, defaultNeighborRule} from './data.js';
import {evaluateThicknessRule, evaluateNeighborRule} from './rules.js';
import {buildJointAnalysis, JOINT_PROVIDER, DEMO_LLM_PROVIDER} from './joint-analysis.js';

export const permissionCatalog = [
  ['home','首页'],['data','资料目录'],['ontology','本体管理'],['construction','知识构建'],
  ['graph','图谱管理'],['retrieval','混合检索'],['reasoning','规则与推理'],['integration','接口联调'],
  ['users','用户权限'],['operations','运行管理'],['import','导入资料'],['run','运行判定'],
  ['rule-edit','维护规则'],['export','导出记录'],['review','人工校核'],['publish','发布知识'],
  ['manage','管理用户与授权'],['audit','查看审计'],
  ['ontology-edit','编辑本体'],['ontology-review','审批本体'],['ontology-publish','发布本体'],
];
export const fieldCatalog = [['layer','目标层位'],['depth','井段范围'],['thickness','厚度'],['distance','距离'],['source','资料来源']];
export const clone = value => JSON.parse(JSON.stringify(value));
export function fault(message, status=400) {const error=new Error(message);error.status=status;throw error;}
export function makeDatabase() {
  const all=permissionCatalog.map(([id])=>id);
  return {version:1, organizations:[{id:'org1',name:'地质研究中心',parentId:'',enabled:true},{id:'org2',name:'地质导向组',parentId:'org1',enabled:true},{id:'org3',name:'专家校核组',parentId:'org1',enabled:true}],
    roles:[{id:'admin',name:'系统管理员',permissions:all},{id:'manager',name:'项目管理员',permissions:['home','data','graph','retrieval','reasoning','construction','operations','import','run','rule-edit','export','review','publish']},{id:'engineer',name:'地质工程师',permissions:['home','data','graph','retrieval','reasoning','operations','import','run','export']},{id:'expert',name:'校核专家',permissions:['home','data','graph','retrieval','reasoning','construction','operations','run','review']},{id:'reader',name:'只读用户',permissions:['home','data','graph','retrieval']},{id:'auditor',name:'审计员',permissions:['home','users','audit']}],
    users:[{id:'u1',account:'admin',name:'平台管理员',orgId:'org1',roleId:'admin',enabled:true},{id:'u2',account:'engineer',name:'张工',orgId:'org2',roleId:'engineer',enabled:true},{id:'u3',account:'expert',name:'李专家',orgId:'org3',roleId:'expert',enabled:true},{id:'u4',account:'reader',name:'王访客',orgId:'org2',roleId:'reader',enabled:true},{id:'u5',account:'disabled',name:'已停用用户',orgId:'org2',roleId:'reader',enabled:false},{id:'u6',account:'auditor',name:'陈审计',orgId:'org1',roleId:'auditor',enabled:true}],
    members:[{id:'m1',projectId:'p1',userId:'u2',roleId:'engineer',wellIds:['w1','w2']},{id:'m2',projectId:'p1',userId:'u3',roleId:'expert',wellIds:['w1','w2','w3']},{id:'m3',projectId:'p1',userId:'u4',roleId:'reader',wellIds:['w1']}],
    grants:[{id:'g1',userId:'u4',projectId:'p1',resourceType:'well',resourceId:'w1',actions:['view'],hiddenFields:['depth','thickness','distance']}],
    projects:clone(seedProjects),wells:clone(seedWells),tasks:clone(seedTasks),assets:seedWells.flatMap(w=>objectTypes.flatMap(t=>Array.from({length:t.count},(_,n)=>({id:`${w.id}-${t.id}-${n}`,wellId:w.id,objectType:t.id,name:`${w.short}_${t.name}${t.id==='log'?(n?'_AC':'_GR'):''}`,type:t.type,source:w.source,version:w.version,status:'示例资料',tone:'neutral'})))),rule:clone(defaultRule),neighborRule:clone(defaultNeighborRule),runs:[],jointRuns:[],audit:[],sequence:1};
}
export function ensureBusiness(db) {if (!Array.isArray(db.jointRuns)) db.jointRuns=[];if (!db.neighborRule) db.neighborRule=clone(defaultNeighborRule);return db;}
export function activeUser(db,id) {const u=db.users.find(x=>x.id===id);if(!u?.enabled)fault('登录已失效或账号已停用，请重新登录。',401);return u;}
export function isAdmin(db,user) {return db.roles.find(r=>r.id===user.roleId)?.permissions.includes('manage')===true;}
export function permissionsFor(db,user,projectId) {
  if(isAdmin(db,user))return db.roles.find(r=>r.id===user.roleId).permissions;
  const member=db.members.find(m=>m.userId===user.id&&m.projectId===projectId);
  const role=db.roles.find(r=>r.id===(projectId?member?.roleId:user.roleId));
  return (role?.permissions||[]).filter(p=>!['manage'].includes(p));
}
export function can(db,user,permission,projectId) {return permissionsFor(db,user,projectId).includes(permission);}
export function requirePermission(db,user,p,projectId) {if(!can(db,user,p,projectId))fault('无权执行此操作。',403);}
export function permittedWells(db,user,projectId) {
  const project=db.projects.find(p=>p.id===projectId);if(!project)return [];
  if(isAdmin(db,user))return project.wells;
  return db.members.find(m=>m.userId===user.id&&m.projectId===projectId)?.wellIds||[];
}
export function resourceGrant(db,user,projectId,kind,id,wellId) {
  const grants=db.grants.filter(g=>g.userId===user.id&&g.projectId===projectId);
  return grants.find(g=>g.resourceType===kind&&g.resourceId===id)||grants.find(g=>g.resourceType==='well'&&g.resourceId===wellId)||grants.find(g=>g.resourceType==='project'&&g.resourceId===projectId);
}
export function resourceAllowed(db,user,projectId,kind,id,wellId,action='view') {
  if(!permittedWells(db,user,projectId).includes(wellId))return false;
  if(isAdmin(db,user))return true;
  const grant=resourceGrant(db,user,projectId,kind,id,wellId);
  return !grant||grant.actions.includes(action);
}
export function protectFields(db,user,projectId,kind,record,wellId) {
  const result=clone(record);const grant=isAdmin(db,user)?null:resourceGrant(db,user,projectId,kind,record.id,wellId);
  const hidden=new Set(grant?.hiddenFields||[]);
  // 同一井的关联视图也隐藏受限属性，避免从概览、原文摘要或历史快照绕过字段限制。
  if(!isAdmin(db,user))for(const g of db.grants.filter(g=>g.userId===user.id&&g.projectId===projectId&&((g.resourceType==='object'&&g.resourceId.startsWith(wellId+'-'))||(g.resourceType==='document'&&db.assets.some(a=>a.id===g.resourceId&&a.wellId===wellId)))))for(const field of g.hiddenFields)hidden.add(field);
  for(const field of hidden)delete result[field];
  return result;
}
export function auditEvent(db,user,operation,object,details={},context={}) {
  const entry={id:`AUD-${db.sequence++}`,time:new Date().toISOString(),userId:user?.id||'',user:user?.name||'未登录',account:user?.account||'',operation,object,result:'成功',projectId:'',wellId:'',requestId:`REQ-${db.sequence++}`,...context,details:clone(details)};
  db.audit.unshift(entry);return entry;
}
export function identity(db,user) {return {...clone(user),roleName:db.roles.find(r=>r.id===user.roleId)?.name||'未分配角色',orgName:db.organizations.find(o=>o.id===user.orgId)?.name||'未分配组织',permissions:permissionsFor(db,user)};}
export function workspace(db,user) {
  ensureBusiness(db);
  const projects=db.projects.filter(p=>permittedWells(db,user,p.id).length).map(p=>({...p,wells:permittedWells(db,user,p.id),permissions:permissionsFor(db,user,p.id)}));
  const ids=projects.flatMap(p=>p.wells);
  const wells=db.wells.filter(w=>ids.includes(w.id)).filter(w=>{const p=projects.find(p=>p.wells.includes(w.id));return resourceAllowed(db,user,p.id,'well',w.id,w.id);}).map(w=>{const p=projects.find(p=>p.wells.includes(w.id));return protectFields(db,user,p.id,'well',w,w.id);});
  const visible=new Set(wells.map(w=>w.id));for(const p of projects)p.wells=p.wells.filter(id=>visible.has(id));
  const assets=db.assets.filter(a=>visible.has(a.wellId)).filter(a=>{const p=projects.find(p=>p.wells.includes(a.wellId));return resourceAllowed(db,user,p.id,'document',a.id,a.wellId)&&resourceAllowed(db,user,p.id,'object',`${a.wellId}-${a.objectType}`,a.wellId);}).map(a=>{const p=projects.find(p=>p.wells.includes(a.wellId));const result=protectFields(db,user,p.id,'document',a,a.wellId);const well=wells.find(w=>w.id===a.wellId);if(!('source' in well))delete result.source;return result;});
  const tasks=db.tasks.filter(t=>visible.has(t.wellId)&&projects.some(p=>p.wells.includes(t.wellId)&&can(db,user,t.route,p.id)&&can(db,user,t.type==='规则判定'?'run':t.type==='人工校核'?'review':t.route,p.id)));
  const runs=db.runs.filter(r=>r.userId===user.id&&visible.has(r.wellId)&&(!r.referenceWellId||visible.has(r.referenceWellId))).filter(r=>{const p=projects.find(p=>p.id===r.projectId);return ['depth','thickness','source'].every(f=>r.inputWellIds?.every(id=>f in (wells.find(w=>w.id===id)||{})))&&p&&can(db,user,'reasoning',p.id)&&r.inputWellIds.every(id=>resourceAllowed(db,user,p.id,'object',`${id}-stratum`,id)&&assets.some(a=>a.wellId===id&&a.objectType==='stratum'&&'source' in a));});
  const jointRuns=(db.jointRuns||[]).filter(r=>visible.has(r.wellId)&&(!r.referenceWellId||visible.has(r.referenceWellId))).filter(r=>{const p=projects.find(p=>p.id===r.projectId);return p&&can(db,user,'reasoning',p.id)&&(r.userId===user.id||can(db,user,'review',p.id))&&r.inputWellIds?.every(id=>['depth','thickness','source'].every(f=>f in (wells.find(w=>w.id===id)||{}))&&resourceAllowed(db,user,p.id,'well',id,id,'view')&&resourceAllowed(db,user,p.id,'object',`${id}-stratum`,id)&&assets.some(a=>a.wellId===id&&a.objectType==='stratum'&&'source' in a));});
  const capabilities=Object.fromEntries(wells.map(w=>{const p=projects.find(p=>p.wells.includes(w.id));return [w.id,['import','run','export','rule-edit'].filter(action=>can(db,user,action,p.id)&&resourceAllowed(db,user,p.id,'well',w.id,w.id,action)&&(action!=='run'||('thickness' in w&&'depth' in w&&'source' in w&&assets.some(a=>a.wellId===w.id&&a.objectType==='stratum'&&'source' in a))))];}));
  return {projects:projects.filter(p=>p.wells.length),wells,assets,tasks,runs:clone(runs),jointRuns:clone(jointRuns),rule:clone(db.rule),neighborRule:clone(db.neighborRule||defaultNeighborRule),capabilities,jointProvider:{...JOINT_PROVIDER},demoLlmProvider:{...DEMO_LLM_PROVIDER}};
}
export function adminView(db,user) {
  if(!can(db,user,'manage')&&!can(db,user,'audit'))fault('无权查看用户管理。',403);
  if(!can(db,user,'manage'))return {audit:clone(db.audit),users:[],organizations:[],roles:[],members:[],grants:[],projects:[],wells:[],assets:[],permissionCatalog,fieldCatalog};
  const {users,organizations,roles,members,grants,projects,wells,assets,audit}=db;
  return clone({users,organizations,roles,members,grants,projects,wells,assets,audit,permissionCatalog,fieldCatalog});
}
function textValue(value,label) {const result=String(value??'').trim();if(!result||result.length>100)fault(`${label}不能为空，且不能超过100字。`);return result;}
function findRecord(list,id,label) {const item=list.find(x=>x.id===id);if(!item)fault(`${label}不存在。`,404);return item;}
function adminSurvives(db,nextUsers,nextRoles=db.roles) {if(!nextUsers.some(u=>u.enabled&&nextRoles.find(r=>r.id===u.roleId)?.permissions.includes('manage')))fault('必须保留至少一位启用的系统管理员。');}
export function mutate(db,user,entity,body,context={}) {
  requirePermission(db,user,'manage');const before=clone(db);const id=body.id||`${entity}-${db.sequence++}`;
  if(entity==='users') {
    const existing=body.id?findRecord(db.users,body.id,'用户'):null;
    const account=textValue(body.account,'账号');if(!/^[a-zA-Z0-9_.-]{3,40}$/.test(account))fault('账号需为3～40位字母、数字、点、下划线或连字符。');
    if(db.users.some(u=>u.account===account&&u.id!==id))fault('账号已存在。');
    const org=findRecord(db.organizations,body.orgId,'组织');if(!org.enabled)fault('请选择启用的组织。');findRecord(db.roles,body.roleId,'角色');
    const entry={id,account,name:textValue(body.name,'姓名'),orgId:body.orgId,roleId:body.roleId,enabled:body.enabled!==false,lastLogin:existing?.lastLogin||''};
    const next=db.users.filter(u=>u.id!==id).concat(entry);adminSurvives(db,next);db.users=next;
  } else if(entity==='organizations') {
    if(body.id)findRecord(db.organizations,id,'组织');
    const parent=body.parentId||'';if(parent){if(!findRecord(db.organizations,parent,'上级组织').enabled)fault('上级组织已停用。');let cursor=parent;const seen=new Set([id]);while(cursor){if(seen.has(cursor))fault('组织层级不能形成循环。');seen.add(cursor);cursor=db.organizations.find(o=>o.id===cursor)?.parentId;}}
    if(body.enabled===false&&(db.users.some(u=>u.orgId===id&&u.enabled)||db.organizations.some(o=>o.parentId===id&&o.enabled)))fault('请先迁移或停用该组织的用户及子组织。');
    db.organizations=db.organizations.filter(o=>o.id!==id).concat({id,name:textValue(body.name,'组织名称'),parentId:parent,enabled:body.enabled!==false});
  } else if(entity==='roles') {
    if(body.id)findRecord(db.roles,id,'角色');const known=permissionCatalog.map(([key])=>key);
    const permissions=[...new Set(body.permissions||[])];if(permissions.some(p=>!known.includes(p)))fault('包含未知权限。');
    if(id==='admin'&&!permissions.includes('manage'))fault('内置管理员角色必须保留管理权限。');
    const roles=db.roles.filter(r=>r.id!==id).concat({id,name:textValue(body.name,'角色名称'),permissions});adminSurvives(db,db.users,roles);db.roles=roles;
  } else if(entity==='members') {
    const p=findRecord(db.projects,body.projectId,'项目');findRecord(db.users,body.userId,'用户');const role=findRecord(db.roles,body.roleId,'角色');if(role.permissions.includes('manage'))fault('系统管理员角色不能作为项目角色。');
    if((body.wellIds||[]).some(w=>!p.wells.includes(w)))fault('井不属于此项目。');
    if(body.remove) {db.members=db.members.filter(m=>!(m.projectId===p.id&&m.userId===body.userId));db.grants=db.grants.filter(g=>!(g.projectId===p.id&&g.userId===body.userId));}
    else {const existing=db.members.find(m=>m.projectId===p.id&&m.userId===body.userId);db.members=db.members.filter(m=>m!==existing).concat({id:existing?.id||id,projectId:p.id,userId:body.userId,roleId:role.id,wellIds:[...new Set(body.wellIds||[])]});}
  } else if(entity==='grants') {
    const p=findRecord(db.projects,body.projectId,'项目');const member=db.members.find(m=>m.userId===body.userId&&m.projectId===p.id);if(!member)fault('请先将用户加入项目。');
    const kind=body.resourceType;let wellId='';
    if(kind==='project'){if(body.resourceId!==p.id)fault('项目范围不匹配。');}
    else if(kind==='well'){wellId=findRecord(db.wells,body.resourceId,'井').id;}
    else if(kind==='document'){wellId=findRecord(db.assets,body.resourceId,'文档').wellId;}
    else if(kind==='object'){const parts=String(body.resourceId).split('-');wellId=parts[0];if(!objectTypes.some(t=>t.id===parts.slice(1).join('-')))fault('图谱对象不存在。');}
    else fault('不支持的对象类型。');
    if(wellId&&(!p.wells.includes(wellId)||!member.wellIds.includes(wellId)))fault('对象超出成员的井授权范围。');
    const actions=[...new Set(body.actions||[])];if(actions.some(a=>!['view','import','run','export','rule-edit','review','publish'].includes(a)))fault('操作权限无效。');
    const hiddenFields=[...new Set(body.hiddenFields||[])];if(hiddenFields.some(f=>!fieldCatalog.some(([key])=>f===key)))fault('字段无效。');
    if(body.remove){db.grants=db.grants.filter(g=>g.id!==body.id);}else {db.grants=db.grants.filter(g=>g.id!==id&&!(g.userId===body.userId&&g.projectId===p.id&&g.resourceType===kind&&g.resourceId===body.resourceId)).concat({id,userId:body.userId,projectId:p.id,resourceType:kind,resourceId:body.resourceId,actions,hiddenFields});}
  } else fault('未知管理操作。',404);
  const collection=entity==='organizations'?'organizations':entity;
  auditEvent(db,user,body.remove?'移除授权':body.id?'修改'+entity:'新增'+entity,id,{before:before[collection]?.find(x=>x.id===id)||null,after:db[collection]?.find(x=>x.id===id)||null},{...context,projectId:body.projectId||''});
  return {id};
}
export function business(db,user,action,body,context={}) {
  ensureBusiness(db);
  const required=action==='joint-run'||action==='neighbor-run'?'run':action==='joint-export'?'export':action==='neighbor-review'?'review':action==='neighbors'?'run':action;
  const resourceAction=action==='neighbors'?'view':required;
  const p=findRecord(db.projects,body.projectId,'项目');requirePermission(db,user,required,p.id);
  const well=findRecord(db.wells,body.wellId,'井');if(!resourceAllowed(db,user,p.id,'well',well.id,well.id,resourceAction))fault('无权访问此井或执行此操作。',403);
  if(action==='import') {
    const type=objectTypes.find(t=>t.type===body.type);if(!type)fault('资料类型无效。');
    const item={id:`import-${db.sequence++}`,wellId:well.id,objectType:type.id,name:textValue(body.name,'资料名称'),type:type.type,source:'本地文件清单登记',version:'待解析',status:'待解析',tone:'amber'};db.assets.unshift(item);auditEvent(db,user,'登记资料',item.id,{}, {...context,projectId:p.id,wellId:well.id});return item;
  }
  if(action==='rule-edit') {const threshold=Number(body.threshold);if(!Number.isFinite(threshold)||threshold<=0)fault('阈值必须大于零。');const before=clone(db.rule);db.rule={...db.rule,threshold,enabled:body.enabled===true,version:`demo-${db.sequence++}`};auditEvent(db,user,'修改规则',db.rule.id,{before,after:db.rule},{...context,projectId:p.id,wellId:well.id});return db.rule;}
  if(action==='neighbors') {
    const radius=Number(body.radius);
    if(!Number.isFinite(radius)||radius<=0||radius>50)fault('搜索半径需大于 0 且不超过 50 km。',400);
    const target=protectFields(db,user,p.id,'well',well,well.id);
    if(!['layer','depth','thickness','source','distance'].every(field=>field in target))fault('目标井层位、井段、厚度、距离或来源字段受限。',403);
    const candidates=[];let outOfRange=0;
    for(const candidate of db.wells.filter(item=>p.wells.includes(item.id)&&item.id!==well.id)) {
      if(!resourceAllowed(db,user,p.id,'well',candidate.id,candidate.id,'view'))continue;
      const peer=protectFields(db,user,p.id,'well',candidate,candidate.id);
      if(!['layer','depth','thickness','source','distance'].every(field=>field in peer))continue;
      const distance=Number(peer.distance);
      if(!Number.isFinite(distance))continue;
      if(distance>radius){outOfRange++;continue;}
      const targetThickness=Number(target.thickness),candidateThickness=Number(peer.thickness);
      const difference=Number.isFinite(targetThickness)&&Number.isFinite(candidateThickness)?Number(Math.abs(targetThickness-candidateThickness).toFixed(6)):null;
      candidates.push({wellId:candidate.id,name:candidate.name,short:candidate.short,layer:peer.layer,depth:peer.depth,thickness:peer.thickness,distance,source:peer.source,version:candidate.version,sameLayer:peer.layer===target.layer,thicknessDifference:difference,dataComplete:Number.isFinite(targetThickness)&&targetThickness>0&&Number.isFinite(candidateThickness)&&candidateThickness>0,withinRange:true});
    }
    candidates.sort((a,b)=>Number(b.sameLayer)-Number(a.sameLayer)||a.distance-b.distance||a.short.localeCompare(b.short,'zh-CN'));
    auditEvent(db,user,'查询候选邻井',well.id,{radius,count:candidates.length,outOfRange},{...context,projectId:p.id,wellId:well.id});
    return {target:{wellId:well.id,short:well.short,layer:target.layer,depth:target.depth,thickness:target.thickness,source:target.source,version:well.version},radius,candidates,outOfRange,rule:clone(db.neighborRule)};
  }
  if(action==='run') {
    const reference=findRecord(db.wells,body.referenceWellId,'参考井');if(!resourceAllowed(db,user,p.id,'well',reference.id,reference.id,'view'))fault('参考井未授权。',403);
    if(reference.id===well.id)fault('目标井与参考井必须不同。');
    if(!resourceAllowed(db,user,p.id,'object',`${well.id}-stratum`,well.id)||!resourceAllowed(db,user,p.id,'object',`${reference.id}-stratum`,reference.id))fault('分层对象未授权。',403);
    for(const w of [well,reference]){const protectedWell=protectFields(db,user,p.id,'well',w,w.id);if(!('thickness' in protectedWell)||!('depth' in protectedWell)||!('source' in protectedWell))fault('厚度、井段或来源字段受限，无法运行判定。',403);}
    for(const w of [well,reference]){const document=db.assets.find(a=>a.wellId===w.id&&a.objectType==='stratum');if(!document||!resourceAllowed(db,user,p.id,'document',document.id,w.id))fault('分层证据未授权。',403);const protectedDoc=protectFields(db,user,p.id,'document',document,w.id);if(!('source' in protectedDoc))fault('证据来源字段受限，无法运行判定。',403);}
    const input={scenario:body.scenario,aligned:body.aligned===true,sameBasis:body.sameBasis===true,conflict:body.conflict===true,targetThickness:body.targetThickness,referenceThickness:body.referenceThickness,evidenceIds:[`${well.id}-stratum`,`${reference.id}-stratum`],wellId:well.id,referenceWellId:reference.id,dataVersion:well.version};
    const run={id:`RUN-${db.sequence++}`,time:new Date().toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}),userId:user.id,projectId:p.id,wellId:well.id,referenceWellId:reference.id,inputWellIds:[well.id,reference.id],wellName:well.short,referenceWellName:reference.short,measurementSource:'示例输入（服务端判定）',result:evaluateThicknessRule(input,db.rule)};
    db.runs.unshift(run);auditEvent(db,user,'运行规则判定',run.id,{}, {...context,projectId:p.id,wellId:well.id});return run;
  }
  if(action==='neighbor-run') {
    const candidate=findRecord(db.wells,body.candidateWellId,'候选井');
    if(candidate.id===well.id)fault('目标井与候选井必须不同。');
    if(!resourceAllowed(db,user,p.id,'well',candidate.id,candidate.id,'view'))fault('候选井未授权。',403);
    const radius=Number(body.radius);
    if(!Number.isFinite(radius)||radius<=0||radius>50)fault('搜索半径需大于 0 且不超过 50 km。',400);
    const focus=String(body.focus??'').trim();
    if(focus.length>200)fault('关注问题不能超过200字。');
    const target=protectFields(db,user,p.id,'well',well,well.id);
    const peer=protectFields(db,user,p.id,'well',candidate,candidate.id);
    for(const item of [target,peer])if(!['layer','depth','thickness','source','distance'].every(field=>field in item))fault('邻井判定所需的层位、井段、厚度、距离或来源字段受限。',403);
    for(const item of [well,candidate]){const document=db.assets.find(asset=>asset.wellId===item.id&&asset.objectType==='stratum');if(!document||!resourceAllowed(db,user,p.id,'document',document.id,item.id))fault('分层证据未授权。',403);const protectedDoc=protectFields(db,user,p.id,'document',document,item.id);if(!('source' in protectedDoc))fault('证据来源字段受限。',403);}
    const distance=Number(peer.distance);
    const targetThickness=Number(target.thickness),candidateThickness=Number(peer.thickness);
    const input={scenario:'neighbor',focus,targetLayer:target.layer,candidateLayer:peer.layer,radius,distance,targetThickness,candidateThickness,layerMatch:target.layer===peer.layer,withinRange:Number.isFinite(distance)&&distance<=radius,dataComplete:Number.isFinite(targetThickness)&&targetThickness>0&&Number.isFinite(candidateThickness)&&candidateThickness>0,evidenceIds:[`${well.id}-stratum`,`${candidate.id}-stratum`],wellId:well.id,referenceWellId:candidate.id,dataVersion:well.version};
    const run={id:`RUN-${db.sequence++}`,time:new Date().toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}),userId:user.id,projectId:p.id,wellId:well.id,referenceWellId:candidate.id,inputWellIds:[well.id,candidate.id],wellName:well.short,referenceWellName:candidate.short,scenario:'neighbor',measurementSource:'邻井候选（服务端判定）',result:evaluateNeighborRule(input,db.neighborRule)};
    db.runs.unshift(run);auditEvent(db,user,'运行邻井判定',run.id,{}, {...context,projectId:p.id,wellId:well.id});return run;
  }
  if(action==='export') {const run=db.runs.find(r=>r.id===body.runId&&r.userId===user.id&&r.projectId===p.id&&r.wellId===well.id);if(!run||!workspace(db,user).runs.some(r=>r.id===run.id))fault('记录不存在或已无权访问。',403);for(const id of run.inputWellIds){const doc=db.assets.find(a=>a.wellId===id&&a.objectType==='stratum');if(!resourceAllowed(db,user,p.id,'well',id,id,'export')||!resourceAllowed(db,user,p.id,'object',`${id}-stratum`,id,'export')||!doc||!resourceAllowed(db,user,p.id,'document',doc.id,id,'export'))fault('输入对象或证据不允许导出。',403);}auditEvent(db,user,'导出判定记录',run.id,{}, {...context,projectId:p.id,wellId:well.id});return clone(run);}
  if(action==='joint-run') {
    const run=db.runs.find(r=>r.id===body.runId&&r.userId===user.id&&r.projectId===p.id&&r.wellId===well.id);
    if(!run||!workspace(db,user).runs.some(r=>r.id===run.id))fault('规则判定记录不存在或已无权访问。',403);
    const scenario=run.result?.input?.scenario||body.scenario;
    if(!['strata','neighbor'].includes(scenario))fault('当前版本仅开放地层对比和邻井推荐场景的联合分析。',400);
    const reference=findRecord(db.wells,run.referenceWellId,'参考井');
    if(reference.id===well.id)fault('目标井与参考井必须不同。');
    if(!resourceAllowed(db,user,p.id,'well',reference.id,reference.id,'view'))fault('参考井未授权。',403);
    const evidence=[];const protectedWells=new Map();
    for(const item of [well,reference]) {
      const protectedWell=protectFields(db,user,p.id,'well',item,item.id);protectedWells.set(item.id,protectedWell);
      if(!['layer','depth','thickness','source'].every(field=>field in protectedWell))fault('联合分析所需的层位、井段、厚度或来源字段受限。',403);
      const document=db.assets.find(asset=>asset.wellId===item.id&&asset.objectType==='stratum');
      if(!document||!resourceAllowed(db,user,p.id,'document',document.id,item.id))fault('分层证据未授权。',403);
      const protectedDoc=protectFields(db,user,p.id,'document',document,item.id);
      if(!('source' in protectedDoc))fault('证据来源字段受限。',403);
      evidence.push({id:`ev:well:${item.id}:stratum`,role:item.id===well.id?'target':'reference',kind:'stratum',label:`${item.short} 分层记录`,detail:`${protectedWell.layer||'未标注层位'} · ${protectedWell.depth||'未标注井段'} · ${protectedWell.thickness??'缺失'} m`,source:protectedDoc.source,version:item.version,wellId:item.id});
    }
    const mode=body.mode==='demo-llm'?'demo-llm':'local';
    const result=buildJointAnalysis({run,targetWell:protectedWells.get(well.id),referenceWell:protectedWells.get(reference.id),evidence,mode});
    const analysis={id:`JA-${db.sequence++}`,createdAt:new Date().toISOString(),time:new Date().toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}),userId:user.id,createdBy:user.name,projectId:p.id,wellId:well.id,referenceWellId:reference.id,inputWellIds:[well.id,reference.id],runId:run.id,wellName:well.short,referenceWellName:reference.short,scenario,mode,result};
    db.jointRuns.unshift(analysis);auditEvent(db,user,'生成联合分析',analysis.id,{runId:run.id,mode},{...context,projectId:p.id,wellId:well.id});return clone(analysis);
  }
  if(action==='joint-export') {
    const analysis=db.jointRuns.find(r=>r.id===body.analysisId&&r.userId===user.id&&r.projectId===p.id&&r.wellId===well.id);
    if(!analysis||!workspace(db,user).jointRuns.some(r=>r.id===analysis.id))fault('联合分析记录不存在或已无权访问。',403);
    for(const id of analysis.inputWellIds){const doc=db.assets.find(a=>a.wellId===id&&a.objectType==='stratum');if(!resourceAllowed(db,user,p.id,'well',id,id,'export')||!resourceAllowed(db,user,p.id,'object',`${id}-stratum`,id,'export')||!doc||!resourceAllowed(db,user,p.id,'document',doc.id,id,'export'))fault('输入对象或证据不允许导出。',403);}
    auditEvent(db,user,'导出联合分析',analysis.id,{}, {...context,projectId:p.id,wellId:well.id});return clone(analysis);
  }
  if(action==='neighbor-review') {
    const analysis=db.jointRuns.find(r=>r.id===body.analysisId&&r.projectId===p.id&&r.wellId===well.id);
    if(!analysis||!workspace(db,user).jointRuns.some(r=>r.id===analysis.id))fault('联合分析记录不存在或已无权访问。',403);
    if(analysis.scenario!=='neighbor')fault('只有邻井推荐联合分析可以登记人工意见。');
    const decision=String(body.decision||'');
    if(!['accepted','rejected','modified'].includes(decision))fault('审核决定无效。');
    const note=String(body.note??'').trim();
    if(note.length>500)fault('审核意见不能超过500字。');
    if(decision!=='accepted'&&!note)fault('驳回或修改时请填写审核意见。');
    const review={decision,note,reviewer:user.name,reviewedAt:new Date().toISOString(),time:new Date().toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})};
    analysis.reviews=Array.isArray(analysis.reviews)?analysis.reviews:[];
    analysis.reviews.unshift(review);analysis.review=review;
    auditEvent(db,user,'登记邻井人工意见',analysis.id,{decision},{...context,projectId:p.id,wellId:well.id});return clone(analysis);
  }
  fault('业务操作未实现。',404);
}
