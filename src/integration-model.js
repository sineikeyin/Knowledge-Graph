// 开放接口、智能体工具和目标软件联调的本地记录模型。所有记录明确区分模拟与真实模式。
import {clone,fault,can,requirePermission,auditEvent} from './access-model.js';

const SCENARIOS=[
  {id:'normal',name:'正常调用'},
  {id:'unauthorized',name:'越权 / 未授权'},
  {id:'timeout',name:'超时与重试'},
  {id:'retry',name:'失败后重试成功'},
  {id:'rate-limit',name:'触发限流'},
  {id:'duplicate',name:'重复请求'},
  {id:'reconnect',name:'断线恢复'},
  {id:'continuous',name:'连续调用'},
];
const ENDPOINTS=[
  {id:'graph-entities',name:'实体与关系查询',method:'GET',path:'/api/graph?projectId=p1&dataset=published&wellId=w1',auth:'会话 Cookie；写操作另需 CSRF',covers:'实体关系',description:'按项目、井、对象类型和关键词返回已发布实体、关系及固定来源证据。',requestFields:[['projectId','string','是','项目编号'],['dataset','enum','否','published 或 demo'],['wellId','string','否','井编号'],['type','string','否','对象类型'],['keyword','string','否','名称关键词']],responseFields:[['entities','array','实体及属性'],['relations','array','关系及方向'],['evidence','array','来源资料与版本'],['version','string','图版本']],errors:[['401','登录失效'],['403','无项目或井权限'],['404','图版本不存在']],exampleRequest:{projectId:'p1',dataset:'published',wellId:'w1'},exampleResponse:{entities:[{id:'w1',type:'well',label:'JH-01'}],relations:[{from:'w1',to:'w1-stratum',type:'hasStratum'}],evidence:[{source:'JH-01 分层记录',version:'data-v1.0'}]}},
  {id:'graph-paths',name:'多跳路径查询',method:'POST',path:'/api/graph/paths',auth:'会话 Cookie；写操作另需 CSRF',covers:'实体关系',description:'查询两个对象之间指定关系、方向和最大跳数的简单路径。',requestFields:[['projectId','string','是','项目编号'],['start','string','是','起点对象'],['end','string','是','终点对象'],['relation','string','否','关系类型'],['maxHops','number','否','最大跳数 3～6'],['directed','boolean','否','是否按方向']],responseFields:[['paths','array','路径节点与关系'],['truncated','boolean','是否达到搜索上限'],['evidence','array','路径证据']],errors:[['400','跳数或起终点无效'],['403','对象无权访问']],exampleRequest:{projectId:'p1',start:'w1',end:'w2',maxHops:3,directed:false},exampleResponse:{paths:[{nodes:['w1','w1-stratum','w2-stratum','w2'],relations:['hasStratum','correspondsTo','hasStratum']}],truncated:false}},
  {id:'retrieval-neighbors',name:'邻井候选检索',method:'POST',path:'/api/business/neighbors',auth:'会话 Cookie + CSRF',covers:'检索',description:'按目标井、层位、搜索半径筛选授权候选邻井。',requestFields:[['projectId','string','是','项目编号'],['wellId','string','是','目标井'],['radius','number','是','搜索半径 km']],responseFields:[['candidates','array','候选井与距离'],['outOfRange','number','超范围数量'],['rule','object','邻井规则版本']],errors:[['403','井或字段未授权'],['400','半径无效']],exampleRequest:{projectId:'p1',wellId:'w1',radius:3},exampleResponse:{candidates:[{wellId:'w2',distance:1.6,sameLayer:true}],outOfRange:0}},
  {id:'reasoning-rule',name:'规则判定',method:'POST',path:'/api/business/run',auth:'会话 Cookie + CSRF',covers:'推理',description:'将实测值代入已选规则，记录输入、规则版本、逐项判断和结论。',requestFields:[['projectId','string','是','项目编号'],['wellId','string','是','目标井'],['referenceWellId','string','是','参考井'],['scenario','enum','是','strata 或 neighbor'],['targetThickness','number','是','目标厚度'],['referenceThickness','number','是','参考厚度']],responseFields:[['result.status','string','规则状态'],['result.steps','array','逐项判断'],['result.rule','object','规则快照'],['id','string','运行编号']],errors:[['403','字段或证据未授权'],['400','同一口井不能作为参考井']],exampleRequest:{projectId:'p1',wellId:'w1',referenceWellId:'w2',scenario:'strata',targetThickness:8,referenceThickness:11},exampleResponse:{id:'RUN-101',result:{status:'triggered',title:'需要提示风险：厚度差待复核'}}},
  {id:'reasoning-joint',name:'联合分析',method:'POST',path:'/api/business/joint-run',auth:'会话 Cookie + CSRF',covers:'推理',description:'将规则结论、图谱事实和证据整理为联合分析记录。',requestFields:[['projectId','string','是','项目编号'],['wellId','string','是','目标井'],['runId','string','是','规则运行编号'],['mode','enum','否','local 或 demo-llm']],responseFields:[['id','string','分析编号'],['result.conclusion','object','结论'],['result.citations','array','引用'],['mode','string','分析模式']],errors:[['403','规则记录无权访问'],['400','场景不支持']],exampleRequest:{projectId:'p1',wellId:'w1',runId:'RUN-101',mode:'local'},exampleResponse:{id:'JA-101',mode:'local',result:{conclusion:{title:'厚度差超限，建议人工复核'}}}},
  {id:'regression-view',name:'整改回归查询',method:'GET',path:'/api/regression?projectId=p1',auth:'会话 Cookie',covers:'推理',description:'返回典型案例、问题台账和回归记录。',requestFields:[['projectId','string','是','项目编号']],responseFields:[['cases','array','典型案例'],['issues','array','问题台账'],['regressions','array','回归记录']],errors:[['403','无整改回归权限']],exampleRequest:{projectId:'p1'},exampleResponse:{cases:[],issues:[],regressions:[]}},
];
const TOOLS=[
  {id:'search_entities',name:'实体检索',backend:'图谱实体接口',description:'按项目、井和关键词检索实体与关系。',inputs:['projectId','wellId','keyword'],outputs:['entities','relations','evidence']},
  {id:'find_path',name:'路径查询',backend:'图谱路径接口',description:'查询两个对象之间的多跳关系路径。',inputs:['projectId','start','end','maxHops'],outputs:['paths','evidence']},
  {id:'run_rule',name:'规则判定',backend:'业务规则接口',description:'把实测值代入专家规则并返回逐项判断。',inputs:['projectId','wellId','referenceWellId','scenario'],outputs:['status','steps','rule']},
  {id:'joint_analysis',name:'联合分析',backend:'联合分析接口',description:'将事实、规则和证据整理为分析报告。',inputs:['projectId','wellId','runId','mode'],outputs:['conclusion','citations','narrative']},
  {id:'push_recommendation',name:'推送导向建议',backend:'目标软件接收接口',description:'把推荐结果和证据摘要推送到目标导向软件。',inputs:['wellId','interval','recommendation'],outputs:['receiptId','receiveStatus']},
];

function igDefaultConfig(){return {softwareName:'目标导向软件（示例）',version:'demo-1.0',endpoint:'http://127.0.0.1:6001/ingest',authMode:'Bearer',enabled:false,mode:'模拟',mappings:{well:'wellCode',interval:'intervalCode',layer:'layerCode',recommendation:'targetField',status:'receiptField'},lastChecked:''};}
export function igEnsure(db){
  if(!db.integration||!Array.isArray(db.integration.requests))db.integration={config:igDefaultConfig(),requests:[],chains:[],receipts:[],sequence:1};
  if(!db.integration.config)db.integration.config=igDefaultConfig();
  return db.integration;
}
function igText(value,label,max=160){const result=String(value??'').trim();if(!result||result.length>max)fault(`${label}不能为空，且不能超过${max}字。`);return result;}
function igStamp(){const now=new Date();return {iso:now.toISOString(),time:now.toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})};}
function igScenario(id){const item=SCENARIOS.find(record=>record.id===id);if(!item)fault('联调场景无效。');return item;}
function igResult(scenario,endpoint){const base={normal:{code:200,state:'成功',latency:96,retry:0,body:endpoint.exampleResponse},unauthorized:{code:401,state:'越权',latency:8,retry:0,body:{message:'缺少或无效的会话/令牌'}},timeout:{code:504,state:'超时',latency:3000,retry:1,body:{message:'目标接口超时，已重试一次'}},retry:{code:200,state:'成功',latency:420,retry:1,body:endpoint.exampleResponse},'rate-limit':{code:429,state:'限流',latency:12,retry:0,body:{message:'请求超过限流阈值'}},duplicate:{code:200,state:'重复',latency:88,retry:0,duplicate:true,body:{...endpoint.exampleResponse,duplicate:true}},reconnect:{code:200,state:'恢复',latency:760,retry:2,body:{...endpoint.exampleResponse,reconnected:true}},continuous:{code:200,state:'成功',latency:112,retry:0,body:endpoint.exampleResponse}}[scenario.id];return {...base,scenario:scenario.id,scenarioName:scenario.name};}
export function igDashboard(db,user,projectId){
  requirePermission(db,user,'integration',projectId);const ig=igEnsure(db);
  const requests=ig.requests.filter(item=>item.projectId===projectId),chains=ig.chains.filter(item=>item.projectId===projectId),receipts=ig.receipts.filter(item=>item.projectId===projectId);
  return {projectId,endpoints:clone(ENDPOINTS),tools:clone(TOOLS),scenarios:clone(SCENARIOS),config:clone(ig.config),requests:clone(requests),chains:clone(chains),receipts:clone(receipts),capabilities:{run:can(db,user,'integration',projectId)}};
}
export function igMutation(db,user,action,body,context={}){
  requirePermission(db,user,'integration',body.projectId);const ig=igEnsure(db),time=igStamp();
  if(action==='send'){
    const endpoint=ENDPOINTS.find(item=>item.id===body.endpointId);if(!endpoint)fault('接口不存在。',404);
    const scenario=igScenario(body.scenario||'normal');
    const add=(index=0,label=scenario.name)=>{const result=igResult(scenario,endpoint),id=`API-${ig.sequence++}`;const record={id,projectId:body.projectId,group:'api',endpointId:endpoint.id,endpointName:endpoint.name,method:endpoint.method,path:endpoint.path,scenario:scenario.id,scenarioName:label,mode:'模拟',statusCode:result.code,state:result.state,latencyMs:result.latency,retryCount:result.retry,duplicate:result.duplicate===true,auth:endpoint.auth,taskId:`TASK-${ig.sequence++}`,requestBody:endpoint.exampleRequest,responseBody:result.body,createdBy:user.name,createdAt:time.iso,createdTime:time.time};ig.requests.unshift(record);return record;};
    if(scenario.id==='continuous'){for(let index=0;index<5;index++)add(index,`连续调用 #${index+1}`);}else add();
    auditEvent(db,user,'发送接口请求',endpoint.id,{scenario:scenario.id,mode:'模拟'},{...context,projectId:body.projectId});return igDashboard(db,user,body.projectId);
  }
  if(action==='tool-call'){
    const tool=TOOLS.find(item=>item.id===body.toolId);if(!tool)fault('工具不存在。',404);const scenario=igScenario(body.scenario||'normal');const chainId=`CHAIN-${ig.sequence++}`,requestId=`API-${ig.sequence++}`,taskId=`TASK-${ig.sequence++}`,ok=['normal','retry','reconnect','duplicate'].includes(scenario.id);
    const withTarget=tool.id==='push_recommendation';const steps=[{actor:'智能体',action:`选择工具：${tool.name}`,status:scenario.id==='unauthorized'?'越权':ok?'成功':'失败',latencyMs:scenario.id==='timeout'?3000:42},{actor:'图谱 / 推理',action:`执行 ${tool.backend}`,status:ok?'成功':'失败',latencyMs:ok?118:8}];
    if(withTarget)steps.push({actor:'目标软件',action:`推送到 ${ig.config.softwareName}`,status:ok?'已接收':'未接收',latencyMs:ok?86:0});
    const state=ok?(scenario.id==='duplicate'?'重复':scenario.id==='reconnect'?'恢复':'成功'):scenario.id==='unauthorized'?'越权':scenario.id==='rate-limit'?'限流':'超时';
    ig.chains.unshift({id:chainId,projectId:body.projectId,group:'agent',toolId:tool.id,toolName:tool.name,scenario:scenario.id,scenarioName:scenario.name,mode:'模拟',state,steps,requestId,taskId,createdBy:user.name,createdAt:time.iso,createdTime:time.time});
    ig.requests.unshift({id:requestId,projectId:body.projectId,group:'agent',endpointId:tool.id,endpointName:tool.name,method:'TOOL',path:`tool://${tool.id}`,scenario:scenario.id,scenarioName:scenario.name,mode:'模拟',statusCode:ok?200:scenario.id==='unauthorized'?401:scenario.id==='rate-limit'?429:504,state,latencyMs:ok?160:scenario.id==='timeout'?3000:8,retryCount:scenario.id==='timeout'?1:scenario.id==='retry'?1:0,duplicate:scenario.id==='duplicate',auth:'智能体工具令牌',taskId,requestBody:{tool:tool.id,inputs:tool.inputs},responseBody:{chainId,state,steps:steps.length},createdBy:user.name,createdAt:time.iso,createdTime:time.time});
    if(withTarget)ig.receipts.unshift({id:`RCP-${ig.sequence++}`,projectId:body.projectId,chainId,target:ig.config.softwareName,mode:'模拟',status:ok?'已接收':'未接收',latencyMs:ok?86:0,note:ok?'模拟接收成功；真实目标软件接入后使用同一回执结构。':'链路未到达目标软件。',createdAt:time.iso,createdTime:time.time});
    auditEvent(db,user,'运行智能体工具链路',chainId,{toolId:tool.id,scenario:scenario.id,mode:'模拟'},{...context,projectId:body.projectId});return igDashboard(db,user,body.projectId);
  }
  if(action==='config'){
    const current=ig.config;const mappings={};for(const key of ['well','interval','layer','recommendation','status'])mappings[key]=igText(body.mappings?.[key],`${key} 映射`,80);
    ig.config={...current,softwareName:igText(body.softwareName,'软件名称',100),version:igText(body.version,'版本',40),endpoint:igText(body.endpoint,'接口地址',300),authMode:igText(body.authMode,'鉴权方式',40),enabled:body.enabled===true,mode:'模拟',mappings,lastChecked:time.iso};
    auditEvent(db,user,'保存目标软件配置',ig.config.softwareName,{mode:'模拟'},{...context,projectId:body.projectId});return igDashboard(db,user,body.projectId);
  }
  fault('接口联调操作未实现。',404);
}