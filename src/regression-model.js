// 典型井案例、人工校核、问题台账与整改回归的本机确定性流程。
import {clone,fault,can,requirePermission,permittedWells,resourceAllowed,auditEvent,workspace} from './access-model.js';

const STATUS_OPTIONS={
  strata:['triggered','not_triggered','insufficient','no_rule','conflict'],
  neighbor:['recommended','review','not_recommended','insufficient','no_rule'],
};
const STATUS_LABEL={
  triggered:'厚度差待复核',not_triggered:'未触发',insufficient:'资料不足',no_rule:'无规则',conflict:'规则冲突',
  recommended:'可参考',review:'厚度差异待复核',not_recommended:'不建议参考',
};

export function rgEnsure(db){
  if(!db.regression||!Array.isArray(db.regression.cases))db.regression={cases:[],issues:[],regressions:[],sequence:1};
  return db.regression;
}
function rgText(value,label,max=100){const result=String(value??'').trim();if(!result||result.length>max)fault(`${label}不能为空，且不能超过${max}字。`);return result;}
function rgOptionalText(value,max=500){const result=String(value??'').trim();if(result.length>max)fault(`说明不能超过${max}字。`);return result;}
function rgStamp(){const now=new Date();return {iso:now.toISOString(),time:now.toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})};}
function rgProject(db,id){const project=db.projects.find(item=>item.id===id);if(!project)fault('项目不存在。',404);return project;}
function rgVisibleWells(db,user,projectId){const allowed=permittedWells(db,user,projectId);return new Set(allowed.filter(id=>resourceAllowed(db,user,projectId,'well',id,id,'view')));}
function findCase(db,user,projectId,caseId,wells){const item=rgEnsure(db).cases.find(record=>record.id===caseId&&record.projectId===projectId);if(!item||!wells.has(item.wellId)||(item.referenceWellId&&!wells.has(item.referenceWellId))||!can(db,user,'reasoning',projectId))fault('典型案例不存在或已无权访问。',403);return item;}
function findIssue(db,caseRecord,issueId){const item=rgEnsure(db).issues.find(record=>record.id===issueId&&record.caseId===caseRecord.id);if(!item)fault('问题记录不存在。',404);return item;}
function rgStatusLabel(status){return STATUS_LABEL[status]||status||'—';}

export function rgDashboard(db,user,projectId){
  const project=rgProject(db,projectId);requirePermission(db,user,'reasoning',project.id);
  const rg=rgEnsure(db),wells=rgVisibleWells(db,user,project.id),ws=workspace(db,user);
  const visibleAnalyses=new Set(ws.jointRuns.map(item=>item.id));
  const cases=rg.cases.filter(item=>item.projectId===project.id&&visibleAnalyses.has(item.analysisId)&&wells.has(item.wellId)&&(!item.referenceWellId||wells.has(item.referenceWellId)));
  const caseIds=new Set(cases.map(item=>item.id));
  const issues=rg.issues.filter(item=>caseIds.has(item.caseId));
  const regressions=rg.regressions.filter(item=>caseIds.has(item.caseId));
  return {
    projectId:project.id,
    cases:clone(cases),
    issues:clone(issues),
    regressions:clone(regressions),
    analyses:clone(ws.jointRuns.filter(item=>item.projectId===project.id)),
    capabilities:{run:can(db,user,'run',project.id),review:can(db,user,'review',project.id)},
    statusOptions:clone(STATUS_OPTIONS),
  };
}

export function rgMutation(db,user,action,body,context={}){
  const project=rgProject(db,body.projectId),rg=rgEnsure(db),wells=rgVisibleWells(db,user,project.id);
  const ws=workspace(db,user);
  const analyses=ws.jointRuns.filter(item=>item.projectId===project.id);
  const findAnalysis=id=>analyses.find(item=>item.id===id)||null;
  const findVisibleCase=id=>{const item=findCase(db,user,project.id,id,wells);if(!ws.jointRuns.some(record=>record.id===item.analysisId))fault('典型案例的基线分析已无权访问。',403);return item;};
  if(action==='create-case'){
    requirePermission(db,user,'run',project.id);
    const analysis=findAnalysis(body.analysisId);if(!analysis)fault('联合分析记录不存在或已无权访问。',403);
    const name=rgText(body.name,'案例名称',100),note=rgOptionalText(body.note,500),time=rgStamp();
    const item={id:`TC-${rg.sequence++}`,projectId:project.id,name,note,wellId:analysis.wellId,referenceWellId:analysis.referenceWellId||'',sceneName:analysis.scenario,scenario:analysis.scenario,analysisId:analysis.id,runId:analysis.runId,wellName:analysis.wellName,referenceWellName:analysis.referenceWellName,status:'待校核',baseline:{analysisId:analysis.id,runId:analysis.runId,status:analysis.result?.status||'',rgStatusLabel:rgStatusLabel(analysis.result?.status),conclusion:analysis.result?.conclusion?.title||'',time:analysis.time||''},createdBy:user.name,createdAt:time.iso,createdTime:time.time,expertReview:null,issueIds:[]};
    rg.cases.unshift(item);auditEvent(db,user,'创建典型案例',item.id,{analysisId:analysis.id},{...context,projectId:project.id,wellId:item.wellId});return rgDashboard(db,user,project.id);
  }
  if(action==='review-case'){
    requirePermission(db,user,'review',project.id);
    const item=findVisibleCase(body.caseId),decision=String(body.decision||''),note=rgOptionalText(body.note,500),time=rgStamp();
    if(!['accepted','rejected','modified'].includes(decision))fault('校核决定无效。');
    if(decision!=='accepted'&&!note)fault('驳回或修改时请填写校核意见。');
    item.expertReview={decision,note,reviewer:user.name,reviewedAt:time.iso,time:time.time,collected:true};
    item.status=decision==='rejected'?'已驳回':item.issueIds.length?'整改中':'已校核';
    auditEvent(db,user,'校核典型案例',item.id,{decision},{...context,projectId:project.id,wellId:item.wellId});return rgDashboard(db,user,project.id);
  }
  if(action==='create-issue'){
    requirePermission(db,user,'run',project.id);
    const item=findVisibleCase(body.caseId),time=rgStamp(),severity=['高','中','低'].includes(body.severity)?body.severity:'中';
    const expectedStatus=String(body.expectedStatus||'');if(!(STATUS_OPTIONS[item.scenario]||[]).includes(expectedStatus))fault('期望回归状态无效。');
    const issue={id:`IS-${rg.sequence++}`,projectId:project.id,caseId:item.id,title:rgText(body.title,'问题标题',100),description:rgOptionalText(body.description,500),severity,owner:rgText(body.owner,'责任人',40),expectedStatus,status:'待整改',createdBy:user.name,createdAt:time.iso,createdTime:time.time,fixNote:'',fixedAt:'',fixedTime:'',regressionId:'',actualStatus:'',closeNote:'',closedBy:'',closedAt:'',closedTime:''};
    rg.issues.unshift(issue);item.issueIds.push(issue.id);item.status='整改中';auditEvent(db,user,'登记整改问题',issue.id,{caseId:item.id},{...context,projectId:project.id,wellId:item.wellId});return rgDashboard(db,user,project.id);
  }
  if(action==='fix-issue'){
    requirePermission(db,user,'run',project.id);
    const item=findVisibleCase(body.caseId),issue=findIssue(db,item,body.issueId),candidate=findAnalysis(body.candidateAnalysisId),time=rgStamp();
    if(!candidate)fault('整改后的联合分析不存在或已无权访问。',403);
    if(candidate.scenario!==item.scenario)fault('整改分析的场景必须与原案例一致。');
    if(candidate.id===item.analysisId)fault('整改回归必须选择新的联合分析版本。');
    const fixNote=rgOptionalText(body.fixNote,500);if(!fixNote)fault('请填写整改说明。');
    const affected=[...new Set(Array.isArray(body.affectedCaseIds)?body.affectedCaseIds:[])].filter(id=>id!==item.id&&rg.cases.some(record=>record.id===id&&record.projectId===project.id&&wells.has(record.wellId)));
    const actualStatus=candidate.result?.status||'',passed=actualStatus===issue.expectedStatus;
    const regression={id:`RG-${rg.sequence++}`,projectId:project.id,caseId:item.id,issueId:issue.id,baselineAnalysisId:item.analysisId,candidateAnalysisId:candidate.id,expectedStatus:issue.expectedStatus,actualStatus,expectedLabel:rgStatusLabel(issue.expectedStatus),actualLabel:rgStatusLabel(actualStatus),result:passed?'通过':'未通过',baselineStatus:item.baseline.status,baselineConclusion:item.baseline.conclusion,candidateConclusion:candidate.result?.conclusion?.title||'',affectedCaseIds:affected,note:fixNote,createdBy:user.name,createdAt:time.iso,createdTime:time.time};
    rg.regressions.unshift(regression);issue.fixNote=fixNote;issue.fixedAt=time.iso;issue.fixedTime=time.time;issue.regressionId=regression.id;issue.actualStatus=actualStatus;issue.status=passed?'待关闭':'待整改';item.status='整改中';
    auditEvent(db,user,'运行整改回归',regression.id,{caseId:item.id,issueId:issue.id,result:regression.result},{...context,projectId:project.id,wellId:item.wellId});return rgDashboard(db,user,project.id);
  }
  if(action==='close-issue'){
    requirePermission(db,user,'review',project.id);
    const item=findVisibleCase(body.caseId),issue=findIssue(db,item,body.issueId),note=rgOptionalText(body.note,500),time=rgStamp();
    if(issue.status!=='待关闭')fault('只有回归通过、待关闭的问题可以关闭。');
    if(!note)fault('请填写人工关闭意见。');
    issue.status='已关闭';issue.closeNote=note;issue.closedBy=user.name;issue.closedAt=time.iso;issue.closedTime=time.time;
    const issues=rg.issues.filter(record=>record.caseId===item.id);if(issues.length&&issues.every(record=>record.status==='已关闭'))item.status='已关闭';
    auditEvent(db,user,'关闭整改问题',issue.id,{caseId:item.id},{...context,projectId:project.id,wellId:item.wellId});return rgDashboard(db,user,project.id);
  }
  fault('整改回归操作未实现。',404);
}