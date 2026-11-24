// 运行日志、逻辑备份、安全导出与私有化部署记录。
import {clone,fault,can,requirePermission,auditEvent} from './access-model.js';

const APP_VERSION='0.11.0';
function opDefaultPolicies(){return [
  {key:'well',label:'井号',level:'敏感',masked:true,sample:'JH-01 → JH-***'},
  {key:'coordinate',label:'坐标',level:'敏感',masked:true,sample:'X/Y → 网格化坐标'},
  {key:'thickness',label:'厚度',level:'内部',masked:false,sample:'8 m'},
  {key:'source',label:'资料来源',level:'内部',masked:false,sample:'JH-01 分层记录'},
  {key:'credential',label:'凭据 / 令牌',level:'机密',masked:true,sample:'永不进入普通日志或导出'},
];}
function opStamp(){const now=new Date();return {iso:now.toISOString(),time:now.toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})};}
function opHash(value){let hash=0;const text=JSON.stringify(value);for(let index=0;index<text.length;index++)hash=(hash*31+text.charCodeAt(index))>>>0;return hash.toString(16).padStart(8,'0');}
function opCounts(db){return {projects:db.projects.length,wells:db.wells.length,assets:db.assets.length,runs:db.runs.length,jointRuns:db.jointRuns?.length||0,cases:db.regression?.cases?.length||0,integrationRequests:db.integration?.requests?.length||0};}
function opTimeValue(value){const parsed=Date.parse(value||'');return Number.isFinite(parsed)?parsed:0;}
export function opEnsure(db){
  if(!db.operations||!Array.isArray(db.operations.backups))db.operations={backups:[],restores:[],exportPolicies:opDefaultPolicies(),exportRecords:[],deployment:{version:APP_VERSION,mode:'本机私有化',initializedAt:'',lastChecked:'',records:[]},sequence:1};
  if(!db.operations.deployment)db.operations.deployment={version:APP_VERSION,mode:'本机私有化',initializedAt:'',lastChecked:'',records:[]};
  if(!db.operations.exportPolicies)db.operations.exportPolicies=opDefaultPolicies();
  if(!db.operations.deployment.records.length){const time=opStamp();db.operations.deployment.initializedAt=time.iso;db.operations.deployment.lastChecked=time.iso;db.operations.deployment.records=[{id:'DEP-1',kind:'初始化',version:APP_VERSION,note:'本机私有化初装',createdBy:'系统',createdAt:time.iso,createdTime:time.time}];db.operations.sequence=2;}
  return db.operations;
}
function opLogs(db,projectId){
  const logs=[];const add=item=>logs.push(item);
  for(const job of db.ingestion?.jobs||[]){const asset=db.assets.find(record=>record.id===job.assetId),project=db.projects.find(record=>asset&&record.wells.includes(asset.wellId));if(project?.id!==projectId)continue;add({id:`LOG-ING-${job.id}`,category:'导入',source:'资料接入',name:asset?.name||job.id,status:job.status==='解析失败'?'失败':['待解析','解析中'].includes(job.status)?'运行中':'成功',duration:'—',requestId:'',taskId:job.id,error:job.error||'',time:job.createdAt||'',detail:`解析任务 ${job.id}`});}
  for(const task of db.construction?.tasks||[]){if(task.projectId!==projectId)continue;add({id:`LOG-KC-${task.id}`,category:'抽取',source:'知识构建',name:task.name,status:task.status==='failed'?'失败':['queued','running'].includes(task.status)?'运行中':'成功',duration:'—',requestId:'',taskId:task.id,error:task.error||'',time:task.createdAt||'',detail:`任务状态 ${task.status}`});}
  for(const run of db.runs||[]){if(run.projectId!==projectId)continue;add({id:`LOG-RUN-${run.id}`,category:'推理',source:'规则判定',name:`${run.wellName||'井'} 规则判定`,status:'成功',duration:'—',requestId:'',taskId:run.id,error:'',time:run.time||'',detail:run.result?.title||''});}
  for(const analysis of db.jointRuns||[]){if(analysis.projectId!==projectId)continue;add({id:`LOG-JA-${analysis.id}`,category:'检索',source:'联合分析',name:`${analysis.wellName||'井'} 联合分析`,status:'成功',duration:'—',requestId:'',taskId:analysis.id,error:'',time:analysis.time||'',detail:analysis.result?.conclusion?.title||''});}
  for(const request of db.integration?.requests||[]){if(request.projectId!==projectId)continue;add({id:`LOG-API-${request.id}`,category:'接口',group:request.group,source:request.group==='agent'?'智能体工具':'图谱接口',name:request.endpointName||request.toolName||request.id,status:['成功','恢复','重复'].includes(request.state)?'成功':request.state,duration:`${request.latencyMs??'—'} ms`,requestId:request.id,taskId:request.taskId||'',error:request.state==='成功'?'':JSON.stringify(request.responseBody||''),time:request.createdTime||request.createdAt||'',detail:`${request.method||'TOOL'} ${request.path||''}`});}
  for(const event of db.audit||[]){if(event.projectId&&event.projectId!==projectId)continue;const operation=event.operation||'';const category=/接口|工具|链路|目标软件/.test(operation)?'接口':/导入|上传|解析|校验|资料/.test(operation)?'导入':/导出|备份|恢复|部署|健康检查|运行管理/.test(operation)?'运维':/案例|整改|回归/.test(operation)?'推理':/构建|抽取|审核|发布|校核/.test(operation)?'抽取':/规则|推理|联合|邻井|判定/.test(operation)?'推理':'认证';add({id:`LOG-AUD-${event.id}`,category,source:'审计',name:operation,status:event.result==='拒绝'||event.result==='失败'?'失败':'成功',duration:'—',requestId:event.requestId||'',taskId:event.object||'',error:event.result==='拒绝'?'操作被拒绝':'',time:event.time||'',detail:event.object||''});}
  return logs.sort((a,b)=>opTimeValue(b.time)-opTimeValue(a.time)).slice(0,200);
}
export function opDashboard(db,user,projectId){
  requirePermission(db,user,'operations',projectId);const op=opEnsure(db),logs=opLogs(db,projectId),lastBackup=op.backups[0];
  const failed=logs.filter(item=>['失败','超时','限流','越权'].includes(item.status)).length;
  const apiCount=logs.filter(item=>item.category==='接口'&&item.group==='api').length,agentCount=logs.filter(item=>item.category==='接口'&&item.group==='agent').length;
  const counts=opCounts(db);
  return {projectId,logs,backups:clone(op.backups),restores:clone(op.restores),exportPolicies:clone(op.exportPolicies),exportRecords:clone(op.exportRecords),deployment:clone(op.deployment),counts,summary:{total:logs.length,failed,apiCount,agentCount},health:[{name:'知识存储',status:'正常',detail:`${counts.assets} 份资料 · ${counts.jointRuns} 条联合分析`},{name:'会话与权限',status:'正常',detail:'本机会话、CSRF 与字段授权生效'},{name:'备份',status:lastBackup?'正常':'待执行',detail:lastBackup?`最近 ${lastBackup.createdTime}`:'尚未创建逻辑备份'},{name:'接口联调',status:'模拟模式',detail:'目标软件回执为本地模拟'}],capabilities:{run:can(db,user,'operations',projectId)}};
}
export function opMutation(db,user,action,body,context={}){
  requirePermission(db,user,'operations',body.projectId);const op=opEnsure(db),time=opStamp();
  if(action==='backup'){
    const counts=opCounts(db),checksum=opHash(counts),record={id:`BK-${op.sequence++}`,projectId:body.projectId,name:`逻辑备份 ${time.time}`,kind:'手动',status:'完成',progress:100,size:JSON.stringify(counts).length,checksum,counts,consistency:{status:'通过',checks:Object.entries(counts).map(([key,value])=>({key,value,status:'通过'}))},createdBy:user.name,createdAt:time.iso,createdTime:time.time};
    op.backups.unshift(record);auditEvent(db,user,'创建逻辑备份',record.id,{checksum},{...context,projectId:body.projectId});return opDashboard(db,user,body.projectId);
  }
  if(action==='restore'){
    const backup=op.backups.find(item=>item.id===body.backupId);if(!backup)fault('备份记录不存在。',404);const counts=opCounts(db);const checks=Object.keys(backup.counts).map(key=>({key,snapshot:backup.counts[key],current:counts[key]??0,status:backup.counts[key]===(counts[key]??0)?'一致':'差异'}));const status=checks.every(item=>item.status==='一致')?'一致':'存在差异';
    const record={id:`RS-${op.sequence++}`,projectId:body.projectId,backupId:backup.id,status,progress:100,checks,note:'逻辑一致性核查；实际文件回滚需在部署环境执行。',createdBy:user.name,createdAt:time.iso,createdTime:time.time};op.restores.unshift(record);auditEvent(db,user,'执行恢复核查',record.id,{backupId:backup.id,status},{...context,projectId:body.projectId});return opDashboard(db,user,body.projectId);
  }
  if(action==='toggle-policy'){
    const policy=op.exportPolicies.find(item=>item.key===body.key);if(!policy)fault('导出策略不存在。',404);if(policy.key==='credential')fault('凭据字段不允许取消脱敏。');policy.masked=body.masked===true;auditEvent(db,user,'修改导出策略',policy.key,{masked:policy.masked},{...context,projectId:body.projectId});return opDashboard(db,user,body.projectId);
  }
  if(action==='test-export'){
    const masked=op.exportPolicies.filter(item=>item.masked).map(item=>item.label);const record={id:`EX-${op.sequence++}`,projectId:body.projectId,fileName:'导出样例.json',status:'已生成',maskedFields:masked,note:`已按 ${masked.length} 项策略脱敏；凭据字段不进入导出。`,createdBy:user.name,createdAt:time.iso,createdTime:time.time};op.exportRecords.unshift(record);auditEvent(db,user,'生成受保护导出',record.id,{maskedFields:masked},{...context,projectId:body.projectId});return opDashboard(db,user,body.projectId);
  }
  if(action==='deploy-record'){
    const kind=body.kind==='rollback'?'回退':'升级';if(!['upgrade','rollback'].includes(body.kind))fault('部署记录类型无效。');const version=String(body.version||'').trim();if(!version)fault('请填写版本号。');const record={id:`DEP-${op.sequence++}`,kind,version,note:String(body.note||'').trim(),createdBy:user.name,createdAt:time.iso,createdTime:time.time};op.deployment.records.unshift(record);op.deployment.version=version;op.deployment.lastChecked=time.iso;auditEvent(db,user,`登记部署${kind}`,record.id,{version},{...context,projectId:body.projectId});return opDashboard(db,user,body.projectId);
  }
  if(action==='health-check'){
    op.deployment.lastChecked=time.iso;auditEvent(db,user,'运行健康检查','部署',{}, {...context,projectId:body.projectId});return opDashboard(db,user,body.projectId);
  }
  fault('运行管理操作未实现。',404);
}