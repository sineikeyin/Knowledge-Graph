import {icon} from './icons.js';
import {objectTypes, defaultRule, demoCases, moduleDefinitions} from './data.js';
import {api,offlineMode} from './api.js';
import {createUsersUI,loginHtml} from './users.js';
import {createIngestionUI} from './ingestion.js';
import {createOntologyUI} from './ontology.js';
import {createConstructionUI} from './construction.js';
import {createGraphUI} from './graph.js';
let projects=[],wells=[],initialTasks=[],authorizedAssets=[],allowedActions={},currentUser=null,authLoading=true,loginNotice='',sessionTimer;
const permitted=(permission)=>['import','run','export','rule-edit'].includes(permission)?(allowedActions[state.wellId]||[]).includes(permission):currentUser?.permissions.includes('manage')||((projects.find(p=>p.id===state.projectId)?.permissions||currentUser?.permissions||[]).includes(permission));
import {evaluateThicknessRule} from './rules.js';

const $ = (selector, parent = document) => parent.querySelector(selector);
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function readSaved() {return {};} // 业务数据从当前身份的服务端授权结果加载。
// 保留旧版浏览器数据，但不将其自动归属到任何登录账号。
const saved = readSaved();
const state = {
  projectId: '',
  wellId: saved.wellId || 'w1', selectedType: saved.selectedType || 'well',
  expanded: new Set([saved.wellId || 'w1']), treeFilter: '', homeTab:'overview',
  sampleId:'triggered', scenario:'strata', activeResult:null, activeJoint:null, jointLoading:false, jointMode:'local', formDirty:false,
  neighborRadius:3, neighborFocus:'', neighborCandidates:null, neighborSelectedId:'', neighborRule:null,
  reasoningView:'rules', regressionTab:'cases', regressionData:null, regressionCaseId:'', regressionIssueId:'',
  integrationData:null, integrationLoading:false, integrationError:'', integrationTab:'api', integrationEndpointId:'graph-entities', integrationToolId:'push_recommendation',
  operationsData:null, operationsLoading:false, operationsError:'', operationsTab:'overview', opLogCategory:'all', opLogStatus:'all', opLogQuery:'',
  rule: saved.rule && Number(saved.rule.threshold)>0 ? {...defaultRule,...saved.rule} : {...defaultRule},
  runs: Array.isArray(saved.runs) ? saved.runs.slice(0,30) : [],
  jointRuns: [],
  imported: Array.isArray(saved.imported) ? saved.imported : [],
  updatedAt: new Date(),
};
const navigation = [
  ['home','home','首页'],['data','folder','数据接入'],['ontology','layers','本体管理'],
  ['construction','build','知识构建'],['graph','graph','图谱管理'],['retrieval','search','混合检索'],
  ['reasoning','rule','规则与推理'],['integration','plug','接口联调'],['users','users','用户权限'],['operations','settings','运行管理'],
];
const currentProject = () => projects.find(p => p.id === state.projectId)||{id:'',name:'未分配项目',block:'暂无授权范围',wells:[]};
const projectWells = () => wells.filter(w => currentProject().wells.includes(w.id));
if (!currentProject().wells.includes(state.wellId)) state.wellId=projectWells()[0]?.id||'';
const currentWell = () => wells.find(w => w.id === state.wellId)||{id:'',name:'未选择井',short:'—',layer:'受限或未提供',depth:'受限或未提供',source:'受限或未提供',version:'—'};
const referenceWell = () => projectWells().find(w => w.id===state.graphReferenceWellId&&w.id!==state.wellId) || projectWells().find(w => w.id !== state.wellId) || currentWell();
const route = () => (location.hash.match(/^#\/([a-z]+)/)?.[1] || 'home');
function persist() {} // 数据通过鉴权接口保存，不共享浏览器业务缓存。
function toast(message) {const target=$('#toast');target.textContent=message;target.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>target.classList.remove('show'),4200);}
function badge(text,tone='blue') {return `<span class="badge ${tone}">${escape(text)}</span>`;}
function go(page,scenario) {
  if(scenario) {state.scenario=scenario;state.activeResult=null;state.activeJoint=null;}
  if(route()===page) render(); else location.hash=`/${page}`;
}
function getAssets() {return authorizedAssets.filter(a=>projectWells().some(w=>w.id===a.wellId));}
function modal(title,body,{wide=false}={}) {
  $('#overlay-root').innerHTML=`<dialog class="modal ${wide?'wide':''}" aria-labelledby="dialog-title"><div class="modal-head"><h2 id="dialog-title">${escape(title)}</h2><button class="icon-button" data-action="close-modal" aria-label="关闭弹窗">${icon('close')}</button></div><div class="modal-body">${body}</div></dialog>`;
  const dialog=$('dialog');dialog.addEventListener('click',event=>{if(event.target===dialog) dialog.close();});dialog.showModal();
}
function downloadJson(data,name) {
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json;charset=utf-8'}));
  const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
function render({preserveScroll=false}={}) {
  const scrollState=preserveScroll?{mainTop:$('#main-content')?.scrollTop||0,mainLeft:$('#main-content')?.scrollLeft||0,windowTop:window.scrollY,windowLeft:window.scrollX}:null;
  if(authLoading){$('#app').innerHTML='<main class="empty-state" id="main-content"><h2>正在恢复登录会话…</h2></main>';return;}
  if(!currentUser){$('#app').innerHTML=loginHtml(loginNotice);return;}
  const page=route()==='login'?'home':route();
  $('#app').innerHTML=`
  <header class="app-header">
    <a class="brand" href="#/home"><span class="brand-mark">${icon('graph',26)}</span><span><strong>智能地质导向知识图谱平台</strong><small>专业资料 · 知识关联 · 辅助分析</small></span></a>
    <div class="header-right"><span class="demo-indicator"><i></i>${offlineMode?'离线示例':'本机会话'}</span><span class="update-time">更新于 <span id="updated-time">${state.updatedAt.toLocaleTimeString('zh-CN',{hour12:false})}</span></span><span class="header-divider"></span><button class="icon-button" data-action="notifications" aria-label="查看待办通知">${icon('bell')}</button><button class="icon-button" data-action="help" aria-label="查看使用说明">${icon('info')}</button><button class="user-button" data-action="profile" aria-label="查看个人信息"><span class="avatar">${escape(currentUser.name.slice(0,1))}</span><span><strong>${escape(currentUser.name)}</strong><small>${escape(currentUser.roleName)}</small></span>${icon('down',14)}</button></div>
  </header>
  <nav class="main-nav" aria-label="主菜单">${navigation.filter(([id])=>permitted(id)).map(([id,glyph,label])=>`<button data-route="${id}" class="nav-item ${page===id?'active':''}" ${page===id?'aria-current="page"':''}>${icon(glyph,17)}<span>${label}</span></button>`).join('')}</nav>
  <div class="context-bar"><div class="context-controls"><label for="project-select">当前项目</label><select id="project-select">${projects.map(p=>`<option value="${p.id}" ${p.id===state.projectId?'selected':''}>${p.name}</option>`).join('')}</select><span class="context-stat">井数 <b>${projectWells().length}</b></span><span class="context-stat">资料 <b>${getAssets().length}</b></span><span class="context-stat current-well">当前井 <b>${currentWell().short}</b></span></div><div class="context-steps"><span>工作流程</span><button data-action="import">1 导入资料</button>${icon('chevron',12)}<button data-route="construction">2 构建知识</button>${icon('chevron',12)}<button data-route="retrieval">3 检索与推理</button></div></div>
  <div class="app-body ${page==='users'?'admin-layout':''}"><aside class="data-sidebar" aria-label="数据树与属性"><section class="tree-pane"><div class="pane-heading"><h2>${icon('folder',17)}数据资源</h2><button class="icon-button small" data-action="expand-tree" aria-label="展开全部井">${icon('layers',16)}</button></div><label class="tree-search">${icon('search',15)}<input id="tree-search" placeholder="搜索井、资料或对象" aria-label="搜索数据树" value="${escape(state.treeFilter)}"></label><div id="tree-list" class="tree-list">${treeHtml()}</div><button class="tree-import" data-action="import">${icon('upload',15)}导入资料</button></section><section id="properties" class="properties-pane">${propertiesHtml()}</section></aside><main class="main-content" id="main-content" tabindex="-1">${pageHtml(page)}</main></div>
  <footer class="status-bar"><span><i class="status-dot"></i>${authorizedAssets.some(asset=>asset.managed)?'本机资料与样例数据':'示例数据'} · ${currentProject().block} / ${currentWell().short}</span><span>资料版本 ${authorizedAssets.find(asset=>asset.id===state.selectedAssetId)?.version||currentWell().version}<span class="footer-separator">|</span>知识可追溯 · 结果可校核</span></footer>`;
  applyPermissions();
  if(page==='integration'&&!state.integrationData&&!state.integrationLoading&&!state.integrationError)setTimeout(()=>loadIntegration(),0);
  if(page==='operations'&&!state.operationsData&&!state.operationsLoading&&!state.operationsError)setTimeout(()=>loadOperations(),0);
  if(scrollState){const main=$('#main-content');if(main){main.scrollTop=scrollState.mainTop;main.scrollLeft=scrollState.mainLeft;}window.scrollTo(scrollState.windowLeft,scrollState.windowTop);}
}
function treeHtml() {
  const filter=state.treeFilter.toLowerCase();
  let count=0;
  const rows=projectWells().map(well=>{
    const wellMatch=well.name.toLowerCase().includes(filter);
    const types=objectTypes.filter(t=>authorizedAssets.some(a=>a.wellId===well.id&&a.objectType===t.id)).filter(t=>wellMatch || t.name.includes(filter) || t.type.includes(filter));
    if(!wellMatch&&!types.length) return '';
    count++;
    const expanded=state.expanded.has(well.id)||Boolean(filter);
    return `<div class="well-group"><div class="tree-well-row ${well.id===state.wellId&&state.selectedType==='well'?'selected':''}"><button class="tree-toggle ${expanded?'expanded':''}" data-action="toggle-well" data-well="${well.id}" aria-label="${expanded?'折叠':'展开'}${well.name}" aria-expanded="${expanded}">${icon('chevron',13)}</button><button class="tree-node" data-action="select-node" data-well="${well.id}" data-type="well">${icon('well',16)}<span>${well.short}</span><small>${authorizedAssets.filter(a=>a.wellId===well.id).length} 份</small></button></div>${expanded?`<div class="tree-children">${types.map(type=>`<button class="tree-leaf ${state.wellId===well.id&&state.selectedType===type.id?'selected':''}" data-action="select-node" data-well="${well.id}" data-type="${type.id}">${icon(type.icon,14)}<span>${type.name}</span><small>${authorizedAssets.filter(a=>a.wellId===well.id&&a.objectType===type.id).length}</small></button>`).join('')}</div>`:''}</div>`;
  }).join('');
  return `<div class="tree-project">${icon('folder',16)}<strong>${currentProject().name}</strong><small>${projectWells().length} 井</small></div>${rows || '<div class="tree-empty">没有匹配的井或资料。</div>'}${count?'<div class="tree-note">选择对象可查看下方属性</div>':''}`;
}
// 同一井内切换对象仅更新局部内容，保留工作区滚动位置与图谱节点焦点。
function updateObjectSelection() {
  const tree=$('#tree-list');const treeScroll=tree.scrollTop;
  tree.innerHTML=treeHtml();tree.scrollTop=treeScroll;
  $('#properties').innerHTML=propertiesHtml();
  for(const node of document.querySelectorAll('.graph-node')) {
    const selected=node.dataset.type===state.selectedType;
    node.classList.toggle('selected',selected);
    node.setAttribute('aria-pressed',String(selected));
  }
}
function propertiesHtml() {
  const asset=authorizedAssets.find(item=>item.id===state.selectedAssetId);
  if(asset)return `<div class="pane-heading"><h2>${icon('panel',16)}资料属性</h2>${badge(asset.type,'neutral')}</div><div class="property-name"><strong>${escape(asset.name)}</strong></div><dl class="property-list">${[['所属项目',currentProject().name],['归属井',currentWell().short],['资料版本',asset.version],['处理状态',asset.status],['质量状态',asset.quality||'未校验'],['来源',asset.source??'来源受限']].map(([label,value])=>`<div><dt>${escape(label)}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl><button class="text-button property-link" data-action="asset-detail" data-asset="${escape(asset.id)}">查看资料详情</button>`;
  const well=currentWell();const type=objectTypes.find(t=>t.id===state.selectedType);
  return `<div class="pane-heading"><h2>${icon('panel',16)}对象属性</h2>${badge(type?.type || '井','neutral')}</div><div class="property-name">${icon(type?.icon||'well',20)}<strong>${type ? type.name : well.name}</strong></div><dl class="property-list"><div><dt>所属项目</dt><dd>${currentProject().name}</dd></div><div><dt>井号</dt><dd>${well.short}</dd></div><div><dt>目标层位</dt><dd>${escape(well.layer??'受限或未提供')}</dd></div><div><dt>井段范围</dt><dd>${escape(well.depth??'受限或未提供')}</dd></div><div><dt>深度基准</dt><dd>MD · m</dd></div><div><dt>资料版本</dt><dd>${well.version}</dd></div><div><dt>来源</dt><dd>${escape(well.source??'受限或未提供')}</dd></div></dl><button class="text-button property-link" data-action="evidence" data-evidence="target">查看来源记录 ${icon('arrow',14)}</button>`;
}
function heading(eyebrow,title,description,actions='') {return `<div class="page-heading"><div><div class="breadcrumb">工作台 <span>/</span> ${escape(eyebrow)}</div><h1>${escape(title)}</h1><p>${escape(description)}</p></div><div class="heading-actions">${actions}</div></div>`;}
function pageHtml(page) {
  if(!permitted(page)&&navigation.some(([id])=>id===page))return heading('访问受限','无权限访问','请联系管理员调整角色或项目授权。',`<button class="button" data-route="home">返回首页</button>`);
  if(page==='users')return usersUI.html();
  if(!projects.length)return heading('工作空间','暂无可访问项目','您的账号尚未分配项目或井，请联系管理员。');
  if(page==='home') return homeHtml();
  if(page==='retrieval') return retrievalHtml();
  if(page==='reasoning') return reasoningHtml();
  if(page==='graph') return graphUI.html();
  if(page==='data') return ingestionUI.html();
  if(page==='ontology') return ontologyUI.html();
  if(page==='construction') return constructionUI.html();
  if(page==='integration') return integrationHtml();
  if(page==='operations') return operationsHtml();
  const definition=moduleDefinitions[page];
  if(!definition) return heading('页面不存在','未找到该页面','请通过顶部菜单返回工作台。',`<button class="button primary" data-route="home">返回首页</button>`);
  return heading(definition.name,definition.name,definition.description||'查看模块功能与相关业务入口。')+`<div class="notice">${icon('info',16)}此功能暂未开放，请联系平台管理员了解可用范围。</div>`+moduleRoadmap(page);
}
function homeHtml() {
  const assets=getAssets();const count=projectWells().length;
  return heading('首页','项目工作台','连接专业资料与知识证据，让每一次辅助分析都有据可查。',`<button class="button primary" data-action="import">${icon('upload',15)}导入资料</button>`)+`
  <div class="workspace-tabs" role="tablist" aria-label="首页内容">${[['overview','数据总览'],['assets','资料目录'],['relations','知识关联'],['history','运行记录']].map(([id,name])=>`<button role="tab" aria-selected="${state.homeTab===id}" class="${state.homeTab===id?'active':''}" data-action="home-tab" data-tab="${id}">${name}</button>`).join('')}<button class="refresh-button" data-action="refresh">${icon('refresh',14)}刷新</button></div>
  ${state.homeTab==='assets'?assetTable():state.homeTab==='relations'?`<section class="panel graph-full"><div class="panel-heading"><h2>当前井知识关联</h2>${badge('五类对象','blue')}</div>${graphHtml()}${graphLegend()}</section>`:state.homeTab==='history'?historyHtml():`
  <div class="metric-grid">${[
    ['folder','资料资产',assets.length,'按井组织的专业资料','data','blue'],
    ['graph','知识实体',count+assets.length,'井与五类知识对象','graph','indigo'],
    ['rule','待校核事项',initialTasks.filter(t=>currentProject().wells.includes(t.wellId)).length,'候选知识与结果核查','construction','amber'],
    ['clock','已保存判定',state.runs.filter(r=>r.projectId===state.projectId).length,'本地规则运行记录','operations','teal'],
  ].map(([glyph,label,value,detail,page,tone])=>`<button class="metric-card" data-route="${page}"><span class="metric-icon ${tone}">${icon(glyph,21)}</span><span class="metric-copy"><span>${label}</span><strong>${value}<small>项</small></strong><small>${detail}</small></span>${icon('chevron',14)}</button>`).join('')}</div>
  <div class="home-columns"><section class="panel knowledge-panel"><div class="panel-heading"><h2>${icon('graph',18)}知识关联概览</h2><button class="text-button" data-route="graph">查看图谱 ${icon('arrow',14)}</button></div><div class="panel-subtitle">${currentWell().short} · ${escape(currentWell().layer??'受限或未提供')} <span>点击节点查看对象属性</span></div>${graphHtml()}${graphLegend()}</section><section class="panel tasks-panel"><div class="panel-heading"><h2>${icon('rule',18)}我的待办</h2><span class="count-label">${initialTasks.filter(t=>currentProject().wells.includes(t.wellId)).length} 项</span></div><div class="task-list">${taskList()}</div><div class="task-bottom">${icon('info',14)}校核意见与结果版本一并留存</div><div class="panel-heading recent-heading"><h2>${icon('clock',16)}最近规则判定</h2><button class="text-button" data-route="operations">全部记录</button></div>${state.runs.length?state.runs.filter(r=>r.projectId===state.projectId).slice(0,2).map(run=>`<button class="recent-run" data-action="run-detail" data-run="${escape(run.id)}"><span>${escape(run.result.title)}</span><small>${escape(run.time)}</small>${icon('chevron',13)}</button>`).join('')||'<div class="compact-empty">当前项目暂无判定记录</div>':`<div class="compact-empty">暂无运行记录<button class="text-button" data-route="retrieval">${permitted('run')?'运行第一次规则判定':'查看检索页面'} ${icon('arrow',13)}</button></div>`}</section></div>
  <section class="panel scenario-panel"><div class="panel-heading"><h2>${icon('layers',18)}典型场景</h2><span class="subtle">从检索结果发起分析，保留事实、规则与证据</span></div><div class="scenario-grid"><button class="scenario-card" data-action="scenario" data-scenario="neighbor"><span class="scenario-icon">${icon('well',24)}</span><span><strong>邻井推荐</strong><small>筛选候选井，查看匹配依据与差异</small></span>${icon('arrow',18)}</button><button class="scenario-card" data-action="scenario" data-scenario="strata"><span class="scenario-icon teal">${icon('layers',24)}</span><span><strong>地层对比</strong><small>比较已知层位，核查厚度差与证据</small></span>${icon('arrow',18)}</button></div></section>
  ${assetTable(4)}`}`;
}
function taskList() {return initialTasks.filter(t=>currentProject().wells.includes(t.wellId)).map(task=>`<button class="task-row" data-route="${task.route}"><span class="task-bullet ${task.tone}">${icon(task.route==='retrieval'?'rule':'file',17)}</span><span class="task-copy"><strong>${task.name}</strong><small>${wells.find(w=>w.id===task.wellId)?.short} · ${task.type}</small></span>${badge(task.state,task.tone)}</button>`).join('')||'<div class="compact-empty">当前项目暂无待办</div>';}
function graphHtml() {
  const w=currentWell();
  const nodes=[
    ['well',320,142,`井 ${w.short}`,'目标井','blue'],
    ['stratum',130,68,w.layer??'字段受限','地层 / 层位','teal'],
    ['log',500,66,'GR / AC','测井资料','purple'],
    ['trajectory',116,220,'井段轨迹','井轨迹','blue'],
    ['model',504,221,'区块模型','地质模型','amber'],
    ['instruction',322,271,'历史指令','依据记录','slate'],
  ].filter(([id])=>id==='well'||authorizedAssets.some(a=>a.wellId===w.id&&a.objectType===id));
  return `<div class="graph-canvas"><svg class="knowledge-graph" viewBox="0 0 640 330" role="group" aria-label="${escape(w.short)}五类知识对象关联图"><defs><pattern id="graph-dot" width="18" height="18" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r=".8" fill="#e0e7f0"/></pattern></defs><rect width="640" height="330" fill="url(#graph-dot)"/>${nodes.slice(1).map(([id,x,y],i)=>{const labels=nodes.slice(1).map(([key])=>({stratum:'钻遇',log:'包含',trajectory:'关联',model:'适用',instruction:'依据'}[key]));return `<path class="graph-edge" d="M320 142L${x} ${y}"/><text class="edge-label" x="${(320+x)/2}" y="${(142+y)/2-8}" text-anchor="middle">${labels[i]}</text>`;}).join('')}${nodes.map(([id,x,y,title,subtitle,tone])=>`<g class="graph-node ${tone} ${state.selectedType===id?'selected':''}" data-action="select-node" data-well="${w.id}" data-type="${id}" role="button" tabindex="0" aria-pressed="${state.selectedType===id}" aria-label="查看${subtitle}属性" transform="translate(${x},${y})"><rect x="-65" y="-24" width="130" height="48" rx="8"/><circle cx="-48" cy="-3" r="4"/><text class="node-title" x="-35" y="1">${escape(title)}</text><text class="node-subtitle" x="0" y="39" text-anchor="middle">${subtitle}</text></g>`).join('')}</svg></div>`;
}
function graphLegend(){return `<div class="graph-legend"><span><i class="legend-dot blue"></i>井／轨迹</span><span><i class="legend-dot teal"></i>地层</span><span><i class="legend-dot purple"></i>测井</span><span><i class="legend-dot amber"></i>模型</span><span><i class="legend-dot slate"></i>历史指令</span><small>示例关系 · 可回查来源</small></div>`;}
function assetTable(limit) {
  const rows=getAssets().filter(a=>limit?true:a.wellId===state.wellId);const shown=limit?rows.slice(0,limit):rows;
  return `<section class="panel asset-panel"><div class="panel-heading"><h2>${icon('folder',17)}${limit?'最近资料':'当前井资料'}</h2>${limit?'<button class="text-button" data-route="data">全部资料 '+icon('arrow',14)+'</button>':badge(`${shown.length} 份`,'neutral')}</div><div class="table-scroll"><table><thead><tr><th>资料名称</th><th>类型</th><th>所属井</th><th>资料版本</th><th>状态</th><th class="align-right">操作</th></tr></thead><tbody>${shown.map(row=>`<tr><td><span class="file-name">${icon('file',15)}${escape(row.name)}</span></td><td>${escape(row.type)}</td><td>${wells.find(w=>w.id===row.wellId)?.short||'—'}</td><td class="mono">${escape(row.version)}</td><td>${badge(row.status,row.tone)}</td><td class="align-right"><button class="text-button" data-action="asset-detail" data-asset="${escape(row.id)}">查看</button></td></tr>`).join('')}</tbody></table></div></section>`;
}
function moduleRoadmap(page){const def=moduleDefinitions[page];return `<section class="panel roadmap"><div class="panel-heading"><h2>${def.code} · 功能概览</h2>${badge('功能准备中','neutral')}</div><div class="feature-grid">${def.features.map((name,i)=>`<div><span>${String(i+1).padStart(2,'0')}</span><strong>${name}</strong><small>暂未开放</small></div>`).join('')}</div></section>`;}

function retrievalHtml() {return state.scenario==='neighbor'?neighborHtml():strataRetrievalHtml();}
function jointEntryHtml() {
  const demo = state.jointMode === 'demo-llm';
  const modelName = state.demoLlmProvider?.name || 'GeoReasoner 示例模型';
  const hint = demo
    ? `${modelName} 示例模式：按大模型报告结构组织结论、推理摘要和建议，结论仍来自规则判定和已授权证据。`
    : state.scenario === 'neighbor' ? '选定候选井并运行邻井判定后，将候选事实、规则结论和引用整理为可复核的联合分析。' : '规则判定完成后，将已授权事实、规则结论和引用整理为可复核的联合分析。';
  return `<section class="panel joint-panel"><div><h2>${icon('graph',18)}图谱与大模型联合分析 <span class="badge neutral">A10 / T4</span></h2><p>${escape(hint)}</p></div><div class="joint-panel-actions"><label class="joint-mode-control">分析模式<select id="joint-mode"><option value="local" ${demo?'':'selected'}>本地证据归纳</option><option value="demo-llm" ${demo?'selected':''}>大模型示例</option></select></label>${badge(demo?'大模型示例':'本地证据归纳模式',demo?'blue':'amber')}<button class="button" data-action="joint-analysis" ${!state.activeResult||state.formDirty?'disabled':''}>${icon('play',15)}${demo?'生成大模型示例':'生成联合分析'}</button></div></section>
  <div id="joint-result">${state.activeJoint?jointResultHtml(state.activeJoint):jointEmptyHtml()}</div>`;
}
function strataRetrievalHtml() {
  const sample=demoCases.find(c=>c.id===state.sampleId);const target=currentWell();const ref=referenceWell();
  return heading('混合检索','检索与规则判定','查到哪些资料、为什么选这条规则、各项条件如何判断，在同一面板中逐项核查。',`<button class="button" data-route="reasoning">${icon('rule',15)}规则库与运行记录</button>`)+`
  ${graphUI.retrievalHtml()}<div class="notice demo-note">${icon('info',16)}当前使用示例资料与规则。厚度差阈值 ${escape(state.rule.threshold)} m 为示例值，正式规则需经专家确认。</div>
  <section class="panel analysis-context"><div class="panel-heading"><h2><span class="section-index">01</span>选择分析对象</h2>${badge('规则判定','blue')}</div><div class="analysis-fields"><label>目标井<select id="analysis-well">${projectWells().map(w=>`<option value="${w.id}" ${w.id===state.wellId?'selected':''}>${w.name}</option>`).join('')}</select></label><label>参考井<input value="${ref.name}" readonly></label><label>分析场景<select id="scenario-select"><option value="strata" ${state.scenario==='strata'?'selected':''}>地层对比</option><option value="neighbor" ${state.scenario==='neighbor'?'selected':''}>邻井推荐</option></select></label><label>井段 / 层位<input value="${escape(target.layer??'字段受限')} · ${escape(target.depth??'字段受限')}" readonly></label></div><div class="sample-controls"><label for="sample-select">样例数据</label><select id="sample-select">${demoCases.map(c=>`<option value="${c.id}" ${c.id===state.sampleId?'selected':''}>${c.name}</option>`).join('')}</select><button class="button primary" id="run-rule" data-action="run-rule">${icon('play',15)}运行规则判定</button><span class="subtle">T3：检索 → 规则关联 → 确定性判断</span></div></section>
  <div class="analysis-grid"><section class="panel retrieved-panel"><div class="panel-heading"><h2><span class="section-index">02</span>检索到的资料</h2>${badge('A07','neutral')}</div>${[target,ref].filter((w,i,list)=>list.findIndex(x=>x.id===w.id)===i).map(w=>{const asset=authorizedAssets.find(a=>a.wellId===w.id&&a.objectType==='stratum');return asset?`<div class="source-card"><div class="source-icon">${icon('file',19)}</div><div><strong>${escape(w.short)} 分层记录</strong><small>${escape(w.layer??'字段受限')} · ${escape(w.depth??'字段受限')} · MD / m</small><p>${escape(asset.source??'来源字段受限')}</p><button class="text-button" data-action="evidence" data-evidence="${w.id===target.id?'target':'reference'}">查看原始记录</button></div></div>`:`<div class="admin-note">${escape(w.short)} 分层证据不可访问。</div>`;}).join('')}<div class="evidence-footnote">${icon('link',14)}井 → 井段 → 地层 → 分层记录；资料版本 ${target.version}</div></section>
  <section class="panel selected-rule"><div class="panel-heading"><h2><span class="section-index">03</span>系统选择的规则</h2>${badge('A08','neutral')}</div>${!sample.aligned||state.scenario!=='strata'||!state.rule.enabled?`<div class="rule-empty">${icon('info',24)}<strong>无适用规则</strong><p>${!state.rule.enabled?'示例规则已停用。':state.scenario!=='strata'?'当前厚度差规则仅适用于地层对比；邻井推荐规则待专家提供。':'尚未确认两井层位对应，本规则不适用。'}</p></div>`:`<div class="rule-detail"><div class="rule-name"><strong>${escape(state.rule.name)}</strong>${badge(sample.conflict?'存在冲突':'适用',sample.conflict?'amber':'teal')}</div><div class="rule-code mono">${state.rule.id} · ${escape(state.rule.version)}</div><p>${escape(state.rule.description)}</p><dl><div><dt>选用理由</dt><dd>已选择地层对比；样例数据标记层位已确认对应。</dd></div><div><dt>判定条件</dt><dd>两井厚度差绝对值 &gt; ${escape(state.rule.threshold)} m</dd></div><div><dt>规则来源</dt><dd>${escape(state.rule.source)}</dd></div></dl>${sample.conflict?'<div class="inline-warning">样例模拟同一工况存在相反规则结论，需人工处理。</div>':''}</div>`}</section></div>
  <section class="panel judgement-panel"><div class="panel-heading"><h2><span class="section-index">04</span>逐项判定与最终结论</h2>${badge('A09','neutral')}</div><div class="measurement-row"><label>目标井厚度 <span>m</span><input id="target-thickness" type="number" min="0" step="0.1" value="${permitted('run')?(sample.target??''):''}" placeholder="${permitted('run')?'缺失':'无判定权限或字段受限'}" ${permitted('run')?'':'disabled'}></label><label>参考井厚度 <span>m</span><input id="reference-thickness" type="number" min="0" step="0.1" value="${permitted('run')?(sample.reference??''):''}" placeholder="${permitted('run')?'缺失':'无判定权限或字段受限'}" ${permitted('run')?'':'disabled'}></label><div class="measurement-basis"><span>本次实测输入</span><strong id="measurement-origin">样例数据 · ${sample.sameBasis?'同一基准':'基准未统一'}</strong><small>输入值和来源会保存在运行快照中</small></div></div><div id="judgement-result">${state.activeResult?resultHtml(state.activeResult):'<div class="judgement-empty">'+icon('rule',28)+'<strong>等待运行规则判定</strong><p>上方查看资料和适用规则，点击“运行规则判定”后查看计算过程、结论与证据。</p></div>'}</div></section>
  ${jointEntryHtml()}`;
}
function resultHtml(run) {
  const r=run.result;const tone=['triggered','conflict','review'].includes(r.status)?'amber':['not_triggered','recommended'].includes(r.status)?'teal':r.status==='error'?'red':'slate';
  return `<div class="result-summary ${tone}"><span class="result-icon">${icon(['not_triggered','recommended'].includes(r.status)?'check':['triggered','review'].includes(r.status)?'warning':'info',24)}</span><div><strong>${escape(r.title)}</strong><p>${escape(r.reason)}</p></div>${badge('示例判定',tone)}</div>${r.steps.length?`<div class="table-scroll"><table class="judgement-table"><thead><tr><th>判定项</th><th>实际值</th><th>规则条件</th><th>逐项结果</th></tr></thead><tbody>${r.steps.map(step=>`<tr><td>${step.name}</td><td>${escape(step.actual)}</td><td>${escape(step.condition)}</td><td>${badge(step.passed?'满足':'不满足',step.passed?'teal':'neutral')}</td></tr>`).join('')}</tbody></table></div>`:''}<div class="result-evidence"><span>${icon('link',14)}证据：${escape(run.measurementSource)} · 输入快照已留存</span><button class="text-button" data-action="run-evidence" data-run="${escape(run.id)}">查看本次依据</button></div><div class="run-meta"><span class="mono">${escape(run.id)}</span><span>${escape(run.time)} · ${escape(r.rule.version)}</span><button class="text-button" data-action="export-run" data-run="${escape(run.id)}">${icon('download',13)}导出记录</button></div>`;
}
function citationNumberMap(result) {
  const map = new Map();
  (result.citations || []).forEach((citation, index) => map.set(citation.id, index + 1));
  return map;
}
function citationChips(ids, map) {
  const unique = [...new Set(ids || [])].filter(id => map.has(id));
  return unique.length ? `<span class="citation-chips">${unique.map(id => `<span class="citation-ref">[${map.get(id)}]</span>`).join('')}</span>` : '';
}
function jointCitationList(result) {
  const map = citationNumberMap(result);
  return (result.citations || []).map(citation => `<li><span class="citation-index">[${map.get(citation.id)}]</span><div><strong>${escape(citation.label)}</strong><p>${escape(citation.detail)}</p><small>${escape(citation.source)} · ${escape(citation.version)}</small>${citation.role === 'target' || citation.role === 'reference' ? `<button class="text-button" data-action="evidence" data-evidence="${citation.role}">查看原始记录 ${icon('arrow',12)}</button>` : ''}</div></li>`).join('');
}
function llmDemoReportHtml(result) {
  const narrative = result.narrative || {};
  const model = result.model || {};
  const reasoning = (narrative.reasoningChain || []).map((item, index) => `<li><span>${escape(item)}</span></li>`).join('');
  const limitations = (narrative.limitations || []).map(item => `<li>${escape(item)}</li>`).join('');
  return `<div class="llm-demo-banner">${icon('graph',18)}<div><strong>大模型联合分析示例</strong><p>${escape(result.modelNotice || '示例模式：本报告基于当前规则判定和授权证据组织，用于展示联合分析报告结构。')}</p></div>${badge('DEMO · 示例模式','blue')}</div>
  <section class="llm-demo-report" aria-label="大模型分析示例报告">
    <div class="llm-report-head"><div><span class="llm-eyebrow">MODEL REPORT</span><h4>模型分析报告</h4></div>${badge('示例报告','amber')}</div>
    <div class="llm-model-strip"><div><span>模型</span><strong>${escape(model.name || 'GeoReasoner 示例模型')}</strong></div><div><span>模型标识</span><strong class="mono">${escape(model.modelId || 'geo-reasoner-demo-0.1')}</strong></div><div><span>提示模板</span><strong class="mono">${escape(model.promptTemplateVersion || 'jp-llm-demo-v1')}</strong></div><div><span>运行方式</span><strong>${escape(model.provider || '示例运行')}</strong></div></div>
    <div class="llm-executive"><span>综合判断</span><p>${escape(narrative.executiveSummary || result.conclusion?.summary || '')}</p></div>
    <div class="llm-report-grid"><div class="llm-report-block"><h5>推理摘要</h5><ol class="llm-reasoning">${reasoning || '<li>未形成推理摘要。</li>'}</ol></div><div class="llm-report-block"><h5>证据评估</h5><p>${escape(narrative.evidenceAssessment || '')}</p><h5>建议</h5><p>${escape(narrative.recommendation || '')}</p></div></div>
    <div class="llm-limitations"><h5>模型自述限制</h5><ul>${limitations || '<li>未提供限制说明。</li>'}</ul></div>
    <div class="llm-report-footnote">${icon('info',14)}示例报告用于展示报告结构；事实、规则和引用仍以下方结构化依据为准。</div>
  </section>`;
}
function jointResultHtml(joint, {embedded = false} = {}) {
  if (!joint?.result) return jointEmptyHtml();
  const result = joint.result;
  const map = citationNumberMap(result);
  const provider = result.provider || {};
  const isDemo = result.analysisMode === 'demo-llm' || provider.simulated === true;
  const tone = result.conclusion?.tone || 'slate';
  const statusText = result.status === 'triggered' ? '待复核' : result.status === 'not_triggered' ? '未触发' : result.status === 'recommended' ? '推荐参考' : result.status === 'review' ? '待复核' : result.status === 'not_recommended' ? '不建议参考' : result.status === 'insufficient' ? '资料不足' : result.status === 'no_rule' ? '无规则' : result.status === 'conflict' ? '规则冲突' : '已生成';
  return `<section class="panel joint-result ${embedded ? 'embedded' : ''}" aria-label="联合分析结果">
    <div class="joint-result-head"><div><div class="joint-title-line"><h2>${icon('graph',18)}图谱与大模型联合分析</h2>${badge('A10 / T4','neutral')}${isDemo ? badge('大模型示例','blue') : badge(provider.isModel ? '模型已配置' : '本地模式 · 未调用大模型',provider.isModel ? 'teal' : 'amber')}</div><p>${escape(joint.wellName)} / ${escape(joint.referenceWellName)} · ${escape(joint.scenario === 'strata' ? '地层对比' : '邻井推荐')} · ${escape(joint.time || '')}</p></div><div class="joint-result-actions">${!embedded ? `<button class="button" data-action="joint-export" data-analysis="${escape(joint.id)}">${icon('download',14)}导出分析</button><button class="text-button" data-action="joint-clear">收起</button>` : ''}</div></div>
    <div class="joint-conclusion ${tone}"><span class="joint-kicker">分析结论 · ${escape(statusText)}</span><h3>${escape(result.conclusion?.title || '未形成结论')}</h3><p>${escape(result.conclusion?.summary || '')}</p><div class="joint-meta"><span class="mono">${escape(joint.id)}</span><span>${isDemo ? `${escape(result.model?.name || 'GeoReasoner 示例模型')} · ${escape(result.model?.modelId || 'geo-reasoner-demo-0.1')}` : `${escape(result.provider?.name || '本地分析')} · 模板 ${escape(result.provider?.templateVersion || '—')}`}</span><span>证据覆盖 ${escape(result.evidenceCoverage?.label || '—')}</span></div></div>
    ${isDemo ? llmDemoReportHtml(result) : ''}
    <div class="joint-columns"><section class="joint-section"><h4>${icon('rule',15)}分析理由</h4><ol class="joint-reasons">${(result.reasons || []).map(item => `<li><span>${escape(item.text)}</span>${citationChips(item.citationIds,map)}</li>`).join('') || '<li>未形成分析理由。</li>'}</ol></section><section class="joint-section"><h4>${icon('info',15)}不确定性与限制</h4><ul class="joint-uncertainties">${(result.uncertainties || []).map(item => `<li><span>${escape(item.text)}</span>${citationChips(item.citationIds,map)}</li>`).join('')}</ul></section></div>
    ${(result.opposing || []).length ? `<section class="joint-section"><h4>${icon('warning',15)}反对或限制证据</h4><ul class="joint-uncertainties">${result.opposing.map(item => `<li><span>${escape(item.text)}</span>${citationChips(item.citationIds,map)}</li>`).join('')}</ul></section>` : ''}
    <section class="joint-section"><h4>${icon('link',15)}支持证据</h4><div class="joint-evidence-grid">${(result.supporting || []).map(item => `<div class="joint-evidence-card"><strong>${escape(item.label)}</strong><p>${escape(item.detail)}</p><small>${escape(item.source)} · ${escape(item.version)}</small></div>`).join('')}</div></section>
    <section class="joint-section"><h4>${icon('file',15)}引用与原文定位</h4><ol class="joint-citations">${jointCitationList(result)}</ol></section>
    <div class="joint-disclaimer">${icon('info',15)}${escape(result.disclaimer || '')}</div>
    ${!embedded ? `<details class="snapshot"><summary>查看联合分析输入快照</summary><pre>${escape(JSON.stringify(result.inputSnapshot,null,2))}</pre></details>` : ''}
  </section>`;
}
function jointEmptyHtml() {
  return `<section class="panel joint-empty-panel">${icon('graph',28)}<div><strong>尚未生成联合分析</strong><p>运行规则判定后，点击“生成联合分析”或选择“大模型示例”。结果只使用当前已授权的图谱事实、规则结论和证据，并保留输入快照。</p></div></section>`;
}
function jointHistoryHtml() {
  const rows = state.jointRuns.filter(run => run.projectId === state.projectId);
  return `<section class="panel joint-history-panel"><div class="panel-heading"><h2>${icon('graph',17)}联合分析记录</h2>${badge(`${rows.length} 条`,'neutral')}</div>${rows.length ? `<div class="table-scroll"><table><thead><tr><th>分析编号</th><th>对象</th><th>结论</th><th>分析模式</th><th>时间</th><th>操作</th></tr></thead><tbody>${rows.map(run => `<tr><td class="mono">${escape(run.id)}</td><td>${escape(run.wellName)} / ${escape(run.referenceWellName)}</td><td>${escape(run.result?.conclusion?.title || '—')}</td><td>${badge(run.result?.analysisMode==='demo-llm'||run.result?.provider?.simulated ? '大模型示例' : run.result?.provider?.isModel ? '模型' : '本地模式',run.result?.analysisMode==='demo-llm'||run.result?.provider?.simulated ? 'blue' : run.result?.provider?.isModel ? 'teal' : 'neutral')}</td><td class="nowrap">${escape(run.time)}</td><td><button class="text-button" data-action="joint-detail" data-analysis="${escape(run.id)}">详情</button></td></tr>`).join('')}</tbody></table></div>` : `<div class="empty-state compact"><h3>暂无联合分析记录</h3><p>规则判定完成后，在检索页生成联合分析。</p><button class="button" data-route="retrieval">打开规则判定面板</button></div>`}</section>`;
}
async function runJointAnalysis() {
  if (!state.activeResult || state.formDirty) {toast('请先完成有效的规则判定。');return;}
  const button = $('[data-action="joint-analysis"]');
  if (button) {button.disabled = true;button.innerHTML = `${icon('clock',15)}正在整理事实与证据…`;}
  try {
    const analysis = await api('/business/joint-run',{projectId:state.projectId,wellId:state.wellId,runId:state.activeResult.id,scenario:state.scenario,mode:state.jointMode});
    state.activeJoint = analysis;state.jointRuns.unshift(analysis);state.formDirty = false;
    render({preserveScroll:true});
    const host = $('#joint-result');
    host?.scrollIntoView({behavior:'smooth',block:'start'});
    toast('联合分析已生成，输入快照与引用已保存。');
  } catch (error) {toast(error.message);}
  finally {if (button) {button.disabled = false;button.innerHTML = `${icon('play',15)}生成联合分析`;}}
}
async function exportJointAnalysis(id) {
  const analysis = state.jointRuns.find(run => run.id === id) || state.activeJoint;
  if (!analysis) return;
  const record = await api('/business/joint-export',{projectId:analysis.projectId,wellId:analysis.wellId,analysisId:analysis.id});
  downloadJson(record,analysis.id + '.json');
}
function openJointDetail(id) {
  const analysis = state.jointRuns.find(run => run.id === id) || state.activeJoint;
  if (!analysis) return;
  modal('联合分析记录',`<div class="modal-record-actions"><button class="button" data-action="joint-open" data-analysis="${escape(analysis.id)}">${icon('arrow',14)}在检索页打开</button></div><p class="subtle">${escape(analysis.wellName)} / ${escape(analysis.referenceWellName)} · ${escape(analysis.time)}</p>${jointResultHtml(analysis,{embedded:true})}`,{wide:true});
}
function neighborStatusLabel(status) {
  return status === 'recommended' ? '可参考' : status === 'review' ? '厚度差异待复核' : status === 'not_recommended' ? '不建议参考' : status === 'insufficient' ? '资料不足' : status === 'no_rule' ? '无规则' : status === 'conflict' ? '规则冲突' : '未完成';
}
function neighborEvidenceModal(wellId) {
  const item = wellId === state.wellId ? {...currentWell(),distance:0} : state.neighborCandidates?.candidates?.find(candidate => candidate.wellId === wellId);
  if (!item) return;
  modal('候选井资料 · 分层记录',`<div class="source-dialog-title">${icon('file',23)}<div><h3>${escape(item.name)}</h3><p>${badge('虚构示例资料','neutral')} ${escape(item.version)}</p></div></div><dl class="evidence-attributes"><div><dt>井号</dt><dd>${escape(item.short)}</dd></div><div><dt>层位</dt><dd>${escape(item.layer)}</dd></div><div><dt>井段</dt><dd>${escape(item.depth)}</dd></div><div><dt>厚度</dt><dd>${escape(item.thickness)} m</dd></div><div><dt>距离</dt><dd>${escape(item.distance)} km</dd></div><div><dt>来源</dt><dd>${escape(item.source)}</dd></div></dl><p class="subtle">该资料来自当前项目的示例分层记录；联合分析中的具体数值以输入快照为准。</p>`);
}
function neighborHtml() {
  const target = currentWell();
  const result = state.neighborCandidates;
  const selected = result?.candidates?.find(candidate => candidate.wellId === state.neighborSelectedId) || null;
  const rule = result?.rule || state.neighborRule || {};
  const candidateRows = result?.candidates?.length ? `<div class="table-scroll"><table class="neighbor-table"><thead><tr><th>候选井</th><th>层位</th><th>距离</th><th>厚度</th><th>厚度差</th><th>资料</th><th>操作</th></tr></thead><tbody>${result.candidates.map(item => `<tr class="${item.wellId === state.neighborSelectedId ? 'selected' : ''}"><td><strong>${escape(item.short)}</strong><small>${escape(item.name)}</small></td><td>${escape(item.layer)} ${item.sameLayer ? badge('同层位','teal') : badge('层位不同','neutral')}</td><td class="nowrap">${escape(item.distance)} km</td><td>${escape(item.thickness)} m</td><td>${item.thicknessDifference === null ? '—' : `${escape(item.thicknessDifference)} m`}</td><td>${item.dataComplete ? badge('完整','teal') : badge('不足','amber')}</td><td><button class="text-button" data-action="neighbor-select" data-well="${escape(item.wellId)}">${item.wellId === state.neighborSelectedId ? '已选择' : '选择'}</button></td></tr>`).join('')}</tbody></table></div>` : `<div class="empty-state compact"><h3>当前半径内没有候选井</h3><p>可扩大搜索半径，或检查邻井授权范围。${result?.outOfRange ? `另有 ${result.outOfRange} 口授权井超出当前范围。` : ''}</p></div>`;
  return heading('混合检索','邻井推荐','按层位与空间范围筛选候选井，再运行邻井可参考性规则和联合分析。',`<button class="button" data-route="reasoning">${icon('rule',15)}规则库与运行记录</button>`)+`
  <div class="notice demo-note">${icon('info',16)}当前使用示例邻井距离、分层资料和规则。搜索半径、厚度差阈值与候选排序仅用于流程验证，正式规则由专家确认。</div>
  <section class="panel analysis-context"><div class="panel-heading"><h2><span class="section-index">01</span>选择分析对象</h2>${badge('邻井推荐','blue')}</div><div class="analysis-fields"><label>目标井<select id="analysis-well">${projectWells().map(w=>`<option value="${w.id}" ${w.id===state.wellId?'selected':''}>${w.name}</option>`).join('')}</select></label><label>目标层位<input value="${escape(target.layer??'字段受限')}" readonly></label><label>搜索半径（km）<input id="neighbor-radius" type="number" min="0.1" max="50" step="0.1" value="${escape(state.neighborRadius)}"></label><label>分析场景<select id="scenario-select"><option value="strata" ${state.scenario==='strata'?'selected':''}>地层对比</option><option value="neighbor" ${state.scenario==='neighbor'?'selected':''}>邻井推荐</option></select></label></div><div class="analysis-fields neighbor-focus-row"><label class="wide">关注问题<input id="neighbor-focus" maxlength="200" value="${escape(state.neighborFocus)}" placeholder="例如：厚度变化是否支持地层对比"></label></div><div class="sample-controls"><button class="button primary" data-action="neighbor-search">${icon('search',15)}查询候选邻井</button><span class="subtle">只返回当前项目内、已授权且距离在范围内的井</span></div></section>
  <section class="panel neighbor-candidates"><div class="panel-heading"><h2><span class="section-index">02</span>候选邻井</h2>${badge('A10 / A11','neutral')}</div>${result ? candidateRows + (result.outOfRange ? `<div class="evidence-footnote">${icon('info',14)}另有 ${result.outOfRange} 口授权井超出当前搜索半径。</div>` : '') : `<div class="judgement-empty">${icon('well',28)}<strong>等待查询候选邻井</strong><p>设置搜索半径和关注问题后，点击“查询候选邻井”。</p></div>`}</section>
  ${selected ? `<div class="analysis-grid neighbor-selected"><section class="panel retrieved-panel"><div class="panel-heading"><h2><span class="section-index">03</span>候选井事实</h2>${badge('A07','neutral')}</div><div class="source-card"><div class="source-icon">${icon('well',19)}</div><div><strong>${escape(target.short)} 目标井</strong><small>${escape(target.layer??'字段受限')} · ${escape(target.depth??'字段受限')} · ${escape(target.thickness??'字段受限')} m</small><p>${escape(target.source??'来源受限')} · ${escape(target.version)}</p><button class="text-button" data-action="neighbor-evidence" data-well="${escape(target.id)}">查看目标井资料</button></div></div><div class="source-card"><div class="source-icon">${icon('well',19)}</div><div><strong>${escape(selected.short)} 候选井</strong><small>${escape(selected.layer)} · ${escape(selected.depth)} · ${escape(selected.thickness)} m</small><p>${escape(selected.source)} · ${escape(selected.version)}</p><button class="text-button" data-action="neighbor-evidence" data-well="${escape(selected.wellId)}">查看候选井资料</button></div></div><div class="evidence-footnote">${icon('link',14)}距离 ${escape(selected.distance)} km · 层位${selected.sameLayer?'一致':'不一致'} · 厚度差 ${selected.thicknessDifference===null?'缺失':escape(selected.thicknessDifference)+' m'}</div></section><section class="panel selected-rule"><div class="panel-heading"><h2><span class="section-index">04</span>邻井可参考性规则</h2>${badge('A08','neutral')}</div><div class="rule-detail"><div class="rule-name"><strong>${escape(rule.name||'邻井可参考性规则')}</strong>${badge(rule.enabled===false?'已停用':'适用',rule.enabled===false?'amber':'teal')}</div><div class="rule-code mono">${escape(rule.id||'—')} · ${escape(rule.version||'—')}</div><p>${escape(rule.description||'')}</p><dl><div><dt>选用理由</dt><dd>已选择邻井推荐场景和候选井；规则用于判断层位、距离和厚度差异。</dd></div><div><dt>判定条件</dt><dd>同层位、搜索范围内、厚度资料完整；厚度差不超过 ${escape(rule.maxThicknessDifference??'—')} m 时推荐参考。</dd></div><div><dt>规则来源</dt><dd>${escape(rule.source||'—')}</dd></div></dl></div><div class="neighbor-run-row"><button class="button primary" data-action="neighbor-run" ${permitted('run')?'':'disabled'}>${icon('play',15)}运行邻井判定</button><span class="subtle">T4：候选事实 → 规则关联 → 确定性判断</span></div></section></div>` : ''}
  <section class="panel judgement-panel"><div class="panel-heading"><h2><span class="section-index">05</span>逐项判定与最终结论</h2>${badge('A09','neutral')}</div><div id="judgement-result">${state.activeResult ? resultHtml(state.activeResult) : `<div class="judgement-empty">${icon('rule',28)}<strong>等待运行邻井判定</strong><p>先选择候选井，再点击“运行邻井判定”查看逐项条件、结论和证据。</p></div>`}</div></section>
  ${jointEntryHtml()}
  ${state.activeJoint ? neighborReviewHtml(state.activeJoint) : ''}`;
}
function neighborReviewHtml(joint) {
  if (!joint || joint.scenario !== 'neighbor') return '';
  const review = joint.review;
  const reviewLabel = review ? ({accepted:'已接受',rejected:'已驳回',modified:'修改后接受'}[review.decision] || '已登记') : '待审核';
  const reviewTone = review ? ({accepted:'teal',rejected:'red',modified:'amber'}[review.decision] || 'neutral') : 'neutral';
  return `<section class="panel neighbor-review-panel"><div class="panel-heading"><h2>${icon('users',17)}人工意见</h2>${badge(reviewLabel,reviewTone)}</div>${review?`<div class="review-summary"><strong>${escape(reviewLabel)}</strong><p>${escape(review.note||'未填写备注')}</p><small>${escape(review.reviewer||'—')} · ${escape(review.time||review.reviewedAt||'')}${joint.reviews?.length?` · 共 ${joint.reviews.length} 次`:''}</small></div>`:''}${permitted('review')?`<div class="neighbor-review-form"><label for="neighbor-review-note">审核意见</label><textarea id="neighbor-review-note" maxlength="500" placeholder="说明接受、驳回或修改理由">${escape(review?.note||'')}</textarea><div class="review-actions"><button class="button" data-action="neighbor-review" data-decision="accepted">接受推荐</button><button class="button" data-action="neighbor-review" data-decision="modified">修改后接受</button><button class="button danger" data-action="neighbor-review" data-decision="rejected">驳回</button></div><small>驳回或修改必须填写意见；接受也建议写明理由。</small></div>`:`<div class="admin-note">当前账号无人工校核权限；仍可查看推荐和证据。</div>`}</section>`;
}
async function loadNeighbors() {
  const radius = Number($('#neighbor-radius')?.value);
  if (!Number.isFinite(radius) || radius <= 0 || radius > 50) {toast('搜索半径需大于 0 且不超过 50 km。');return;}
  state.neighborRadius = radius;state.neighborFocus = $('#neighbor-focus')?.value.trim() || '';
  try {
    const data = await api('/business/neighbors',{projectId:state.projectId,wellId:state.wellId,radius});
    state.neighborCandidates = data;state.neighborRule = data.rule;state.neighborSelectedId = data.candidates[0]?.wellId || '';
    state.activeResult = null;state.activeJoint = null;state.formDirty = false;
    render({preserveScroll:true});toast(data.candidates.length ? `找到 ${data.candidates.length} 口范围内候选井。` : '当前半径内没有授权候选井。');
  } catch (error) {toast(error.message);}
}
function selectNeighbor(wellId) {
  state.neighborSelectedId = wellId;state.activeResult = null;state.activeJoint = null;state.formDirty = false;
  render({preserveScroll:true});
}
async function runNeighborRule() {
  const selected = state.neighborCandidates?.candidates?.find(candidate => candidate.wellId === state.neighborSelectedId);
  if (!selected) {toast('请先选择候选井。');return;}
  try {
    const run = await api('/business/neighbor-run',{projectId:state.projectId,wellId:state.wellId,candidateWellId:selected.wellId,radius:state.neighborCandidates.radius,focus:state.neighborFocus});
    state.activeResult = run;state.activeJoint = null;state.formDirty = false;state.runs.unshift(run);
    render({preserveScroll:true});toast('邻井判定已保存，可继续生成联合分析。');
  } catch (error) {toast(error.message);}
}
async function reviewNeighbor(decision) {
  if (!state.activeJoint) return;
  const note = $('#neighbor-review-note')?.value.trim() || '';
  if (decision !== 'accepted' && !note) {toast('驳回或修改时请填写审核意见。');return;}
  try {
    const analysis = await api('/business/neighbor-review',{projectId:state.projectId,wellId:state.wellId,analysisId:state.activeJoint.id,decision,note});
    state.activeJoint = analysis;const index = state.jointRuns.findIndex(item => item.id === analysis.id);if (index >= 0) state.jointRuns[index] = analysis;else state.jointRuns.unshift(analysis);
    render({preserveScroll:true});toast('人工意见已保存。');
  } catch (error) {toast(error.message);}
}
async function loadRegression(){
  try{
    const data=await api('/regression?'+new URLSearchParams({projectId:state.projectId}));
    state.regressionData=data;
    if(!data.cases.some(item=>item.id===state.regressionCaseId))state.regressionCaseId=data.cases[0]?.id||'';
    if(!data.issues.some(item=>item.id===state.regressionIssueId))state.regressionIssueId=data.issues[0]?.id||'';
    render({preserveScroll:true});
  }catch(error){toast(error.message);}
}
async function openRegression(){state.reasoningView='regression';state.regressionTab='cases';state.regressionData=null;state.regressionCaseId='';state.regressionIssueId='';render();await loadRegression();}
function closeRegression(){state.reasoningView='rules';render();}
async function regressionMutate(payload){const data=await api('/regression/mutate',{projectId:state.projectId,...payload});state.regressionData=data;return data;}
async function createRegressionCase(){
  if(!$('#regression-case-form'))return;
  try{
    const data=await regressionMutate({action:'create-case',analysisId:$('#regression-analysis').value,name:$('#regression-case-name').value,note:$('#regression-case-note').value});
    state.regressionTab='cases';state.regressionCaseId=data.cases[0]?.id||'';state.regressionIssueId='';render();toast('案例已创建，等待人工校核。');
  }catch(error){toast(error.message);}
}
async function reviewRegressionCase(){
  if(!state.regressionCaseId)return;
  try{
    await regressionMutate({action:'review-case',caseId:state.regressionCaseId,decision:$('#regression-review-decision')?.value,note:$('#regression-review-note')?.value||''});
    render({preserveScroll:true});toast('人工校核意见已保存。');
  }catch(error){toast(error.message);}
}
async function createRegressionIssue(){
  if(!state.regressionCaseId||!$('#regression-issue-form'))return;
  try{
    const data=await regressionMutate({action:'create-issue',caseId:state.regressionCaseId,title:$('#regression-issue-title').value,description:$('#regression-issue-description').value,severity:$('#regression-issue-severity').value,owner:$('#regression-issue-owner').value,expectedStatus:$('#regression-issue-expected').value});
    state.regressionTab='issues';state.regressionIssueId=data.issues[0]?.id||'';render();toast('问题已登记，等待整改回归。');
  }catch(error){toast(error.message);}
}
function selectRegressionIssue(caseId,issueId){state.regressionTab='issues';state.regressionCaseId=caseId;state.regressionIssueId=issueId;render({preserveScroll:true});}
async function runRegressionFix(){
  const issue=regressionIssueById(state.regressionData,state.regressionIssueId);if(!issue)return;
  const affected=[...document.querySelectorAll('input[name="regression-affected"]:checked')].map(input=>input.value);
  try{
    const data=await regressionMutate({action:'fix-issue',caseId:issue.caseId,issueId:issue.id,candidateAnalysisId:$('#regression-candidate')?.value,fixNote:$('#regression-fix-note')?.value||'',affectedCaseIds:affected});
    state.regressionTab='issues';state.regressionIssueId=issue.id;render();toast(data.regressions[0]?.result==='通过'?'回归通过，等待专家关闭。':'回归未通过，问题保持待整改。');
  }catch(error){toast(error.message);}
}
async function closeRegressionIssue(){
  const issue=regressionIssueById(state.regressionData,state.regressionIssueId);if(!issue)return;
  try{
    await regressionMutate({action:'close-issue',caseId:issue.caseId,issueId:issue.id,note:$('#regression-close-note')?.value||''});
    state.regressionTab='issues';state.regressionIssueId=issue.id;render();toast('问题已人工关闭。');
  }catch(error){toast(error.message);}
}
function openRegressionDetail(id){
  const data=state.regressionData,item=data?.regressions?.find(record=>record.id===id);if(!item)return;
  const caseItem=regressionCaseById(data,item.caseId),issue=regressionIssueById(data,item.issueId);
  const affected=item.affectedCaseIds?.map(caseId=>regressionCaseById(data,caseId)).filter(Boolean).map(record=>`${record.id} · ${record.name}`).join('、')||'无';
  modal('回归记录 · '+item.id,`<div class="regression-baseline"><div><span>案例</span><strong>${escape(caseItem?.name||'—')}</strong></div><div><span>问题</span><strong>${escape(issue?.title||'—')}</strong></div><div><span>期望状态</span><strong>${escape(item.expectedLabel)}</strong></div><div><span>实际状态</span><strong>${escape(item.actualLabel)}</strong></div><div class="wide"><span>基线结论</span><strong>${escape(item.baselineConclusion||'—')}</strong></div><div class="wide"><span>整改后结论</span><strong>${escape(item.candidateConclusion||'—')}</strong></div><div class="wide"><span>回归结果</span><strong>${escape(item.result)}</strong></div><div class="wide"><span>受影响用例</span><strong>${escape(affected)}</strong></div><div class="wide"><span>整改说明</span><strong>${escape(item.note||'—')}</strong></div></div><div class="modal-actions"><button class="button" data-action="close-modal">关闭</button></div>`,{wide:true});
}
function integrationTone(state){return ['成功','已接收','恢复'].includes(state)?'teal':state==='重复'?'blue':state==='越权'?'red':['超时','限流','失败','未接收'].includes(state)?'amber':'neutral';}
function integrationFields(rows){return `<div class="table-scroll"><table class="integration-field-table"><thead><tr><th>字段</th><th>类型</th><th>必填</th><th>说明</th></tr></thead><tbody>${rows.map(row=>`<tr><td class="mono">${escape(row[0])}</td><td>${escape(row[1])}</td><td>${escape(row[2])}</td><td>${escape(row[3])}</td></tr>`).join('')}</tbody></table></div>`;}
function integrationRecordsHtml(records,title){
  if(!records.length)return `<section class="panel"><div class="panel-heading"><h2>${icon('clock',17)}${escape(title)}</h2>${badge('0 条','neutral')}</div><div class="empty-state compact"><h3>暂无联调记录</h3><p>发送模拟请求或运行工具链路后，记录会显示在这里。</p></div></section>`;
  return `<section class="panel"><div class="panel-heading"><h2>${icon('clock',17)}${escape(title)}</h2>${badge(`${records.length} 条`,'neutral')}</div><div class="table-scroll"><table class="integration-record-table"><thead><tr><th>编号</th><th>接口 / 工具</th><th>场景</th><th>模式</th><th>状态</th><th>HTTP</th><th>延迟</th><th>重试</th><th>任务</th><th>时间</th><th>操作</th></tr></thead><tbody>${records.map(item=>`<tr><td class="mono">${escape(item.id)}</td><td>${escape(item.endpointName||item.toolName||'—')}<small>${escape(item.method||'TOOL')} ${escape(item.path||'')}</small></td><td>${escape(item.scenarioName||item.scenario||'—')}</td><td>${badge(item.mode||'模拟',item.mode==='真实'?'teal':'neutral')}</td><td>${badge(item.state,integrationTone(item.state))}</td><td>${escape(item.statusCode||'—')}</td><td>${escape(item.latencyMs??'—')} ms</td><td>${escape(item.retryCount??0)}</td><td class="mono">${escape(item.taskId||'—')}</td><td class="nowrap">${escape(item.createdTime||'')}</td><td><button class="text-button" data-action="integration-request-detail" data-request="${escape(item.id)}">详情</button></td></tr>`).join('')}</tbody></table></div></section>`;
}
function integrationApiHtml(data){
  const endpoint=data.endpoints.find(item=>item.id===state.integrationEndpointId)||data.endpoints[0];
  return `<div class="integration-layout"><section class="panel integration-endpoint-list"><div class="panel-heading"><h2>${icon('plug',17)}接口目录</h2>${badge('A12','neutral')}</div>${data.endpoints.map(item=>`<button class="${item.id===endpoint.id?'active':''}" data-action="integration-select-endpoint" data-endpoint="${escape(item.id)}"><span class="method-tag ${item.method.toLowerCase()}">${escape(item.method)}</span><span><strong>${escape(item.name)}</strong><small>${escape(item.path)}</small></span></button>`).join('')}</section><section class="panel integration-detail"><div class="panel-heading"><h2>${escape(endpoint.name)}</h2>${badge(endpoint.covers,'blue')}</div><div class="integration-api-head"><span class="method-tag ${endpoint.method.toLowerCase()}">${escape(endpoint.method)}</span><code>${escape(endpoint.path)}</code></div><p class="integration-description">${escape(endpoint.description)}</p><dl class="integration-meta"><div><dt>鉴权</dt><dd>${escape(endpoint.auth)}</dd></div><div><dt>覆盖</dt><dd>${escape(endpoint.covers)}</dd></div></dl><h3>请求字段</h3>${integrationFields(endpoint.requestFields)}<h3>响应字段</h3>${integrationFields(endpoint.responseFields.map(row=>[row[0],row[1],'—',row[2]]))}<h3>错误码</h3><div class="table-scroll"><table class="integration-field-table"><thead><tr><th>错误码</th><th>类型</th><th>说明</th></tr></thead><tbody>${endpoint.errors.map(row=>`<tr><td class="mono">${escape(row[0])}</td><td>HTTP</td><td>${escape(row[1])}</td></tr>`).join('')}</tbody></table></div><div class="integration-example-grid"><div><h3>请求示例</h3><pre>${escape(JSON.stringify(endpoint.exampleRequest,null,2))}</pre></div><div><h3>响应示例</h3><pre>${escape(JSON.stringify(endpoint.exampleResponse,null,2))}</pre></div></div><div class="integration-run-row"><label>联调场景<select id="integration-api-scenario">${data.scenarios.map(item=>`<option value="${item.id}">${escape(item.name)}</option>`).join('')}</select></label><button type="button" class="button primary" data-action="integration-send">${icon('play',15)}发送模拟请求</button></div></section></div>${integrationRecordsHtml(data.requests.filter(item=>item.group==='api'),'接口请求记录')}`;
}
function integrationTargetHtml(data){
  const config=data.config;
  return `<section class="panel integration-target-config"><div class="panel-heading"><h2>${icon('settings',17)}目标软件配置</h2>${badge('A13','neutral')}</div><div class="integration-note">${icon('info',15)}当前配置用于本地模拟联调；真实目标软件地址、鉴权和字段映射可在同一表单中维护。</div><form id="integration-config-form" class="integration-config-form"><label>软件名称<input id="integration-software-name" value="${escape(config.softwareName)}" maxlength="100"></label><label>版本<input id="integration-software-version" value="${escape(config.version)}" maxlength="40"></label><label>接口地址<input id="integration-software-endpoint" value="${escape(config.endpoint)}" maxlength="300"></label><label>鉴权方式<input id="integration-software-auth" value="${escape(config.authMode)}" maxlength="40"></label><label class="checkbox-label wide"><input id="integration-software-enabled" type="checkbox" ${config.enabled?'checked':''}>启用目标软件推送</label><div class="wide mapping-title">字段映射</div>${[['well','井号'],['interval','井段'],['layer','层位'],['recommendation','推荐结果'],['status','接收状态']].map(([key,label])=>`<label>${label}<input id="integration-map-${key}" value="${escape(config.mappings?.[key]||'')}" maxlength="80"></label>`).join('')}<button type="button" class="button primary wide" data-action="integration-config-save">保存配置</button></form></section><section class="panel"><div class="panel-heading"><h2>${icon('link',17)}目标软件接收状态</h2>${badge(`${data.receipts.length} 条`,'neutral')}</div>${data.receipts.length?`<div class="table-scroll"><table class="integration-record-table"><thead><tr><th>回执</th><th>链路</th><th>目标软件</th><th>模式</th><th>状态</th><th>延迟</th><th>说明</th><th>时间</th></tr></thead><tbody>${data.receipts.map(item=>`<tr><td class="mono">${escape(item.id)}</td><td class="mono">${escape(item.chainId)}</td><td>${escape(item.target)}</td><td>${badge(item.mode,item.mode==='真实'?'teal':'neutral')}</td><td>${badge(item.status,integrationTone(item.status))}</td><td>${escape(item.latencyMs)} ms</td><td>${escape(item.note)}</td><td class="nowrap">${escape(item.createdTime)}</td></tr>`).join('')}</tbody></table></div>`:`<div class="empty-state compact"><h3>暂无接收回执</h3><p>运行智能体工具链路后，目标软件接收状态会显示在这里。</p></div>`}</section>`;
}
function integrationToolsHtml(data){
  const tool=data.tools.find(item=>item.id===state.integrationToolId)||data.tools[0];
  return `<div class="integration-layout"><section class="panel integration-endpoint-list"><div class="panel-heading"><h2>${icon('build',17)}工具目录</h2>${badge('A13','neutral')}</div>${data.tools.map(item=>`<button class="${item.id===tool.id?'active':''}" data-action="integration-select-tool" data-tool="${escape(item.id)}"><span class="method-tag tool">TOOL</span><span><strong>${escape(item.name)}</strong><small>${escape(item.backend)}</small></span></button>`).join('')}</section><section class="panel integration-detail"><div class="panel-heading"><h2>${escape(tool.name)}</h2>${badge('智能体工具','blue')}</div><p class="integration-description">${escape(tool.description)}</p><dl class="integration-meta"><div><dt>后端</dt><dd>${escape(tool.backend)}</dd></div><div><dt>链路</dt><dd>智能体 → 图谱 / 推理 → 目标软件</dd></div></dl><h3>输入</h3><div class="integration-chip-list">${tool.inputs.map(item=>`<span>${escape(item)}</span>`).join('')}</div><h3>输出</h3><div class="integration-chip-list">${tool.outputs.map(item=>`<span>${escape(item)}</span>`).join('')}</div><div class="integration-run-row"><label>联调场景<select id="integration-tool-scenario">${data.scenarios.map(item=>`<option value="${item.id}">${escape(item.name)}</option>`).join('')}</select></label><button type="button" class="button primary" data-action="integration-tool-call">${icon('play',15)}模拟工具调用</button></div></section></div><section class="panel"><div class="panel-heading"><h2>${icon('link',17)}工具调用链路</h2>${badge(`${data.chains.length} 条`,'neutral')}</div>${data.chains.length?`<div class="table-scroll"><table class="integration-record-table"><thead><tr><th>链路</th><th>工具</th><th>场景</th><th>模式</th><th>状态</th><th>步骤</th><th>任务</th><th>时间</th><th>操作</th></tr></thead><tbody>${data.chains.map(item=>`<tr><td class="mono">${escape(item.id)}</td><td>${escape(item.toolName)}</td><td>${escape(item.scenarioName)}</td><td>${badge(item.mode,item.mode==='真实'?'teal':'neutral')}</td><td>${badge(item.state,integrationTone(item.state))}</td><td>${item.steps.length}</td><td class="mono">${escape(item.taskId)}</td><td class="nowrap">${escape(item.createdTime)}</td><td><button class="text-button" data-action="integration-chain-detail" data-chain="${escape(item.id)}">查看链路</button></td></tr>`).join('')}</tbody></table></div>`:`<div class="empty-state compact"><h3>暂无工具链路</h3><p>选择工具并运行模拟调用后，链路详情会显示在这里。</p></div>`}</section>`;
}
function integrationStabilityHtml(data){
  const rows=data.scenarios.map(scenario=>{const api=data.requests.find(item=>item.group==='api'&&item.scenario===scenario.id);const chain=data.chains.find(item=>item.scenario===scenario.id);return `<tr><td><strong>${escape(scenario.name)}</strong><small>${escape(scenario.id)}</small></td><td>${api?badge(api.state,integrationTone(api.state)):'—'}${api?`<small>${escape(api.statusCode)} · ${escape(api.latencyMs)} ms</small>`:''}</td><td>${chain?badge(chain.state,integrationTone(chain.state)):'—'}${chain?`<small>${escape(chain.steps.length)} 步</small>`:''}</td><td><div class="integration-run-buttons"><button type="button" class="text-button" data-action="integration-run-scenario" data-group="api" data-scenario="${escape(scenario.id)}">运行接口</button><button type="button" class="text-button" data-action="integration-run-scenario" data-group="agent" data-scenario="${escape(scenario.id)}">运行链路</button></div></td></tr>`;}).join('');
  return `<section class="panel"><div class="panel-heading"><h2>${icon('refresh',17)}场景矩阵</h2>${badge('A12 / A13','neutral')}</div><div class="integration-note">${icon('info',15)}正常、越权、超时、重试、限流、重复、断线恢复和连续调用分别保留记录。</div><div class="table-scroll"><table class="integration-record-table"><thead><tr><th>场景</th><th>接口结果</th><th>工具链路结果</th><th>运行</th></tr></thead><tbody>${rows}</tbody></table></div></section>${integrationRecordsHtml(data.requests.slice(0,20),'最近请求日志')}`;
}
function integrationHtml(){
  if(state.integrationError)return heading('接口联调','开放接口与软件联调','覆盖图谱查询接口、智能体工具调用和目标软件接收记录。','')+`<section class="panel"><div class="empty-state"><h3>接口联调数据读取失败</h3><p>${escape(state.integrationError)}</p><button class="button" data-action="integration-refresh">重新加载</button></div></section>`;
  if(!state.integrationData)return heading('接口联调','开放接口与软件联调','覆盖图谱查询接口、智能体工具调用和目标软件接收记录。','')+`<section class="panel"><div class="empty-state"><h3>正在读取接口目录与联调记录…</h3><p>请稍候；如果长时间没有显示，请点击刷新。</p><button class="button" data-action="integration-refresh">刷新数据</button></div></section>`;
  const data=state.integrationData,tab=state.integrationTab||'api';const apiCount=data.requests.filter(item=>item.group==='api').length,agentCount=data.requests.filter(item=>item.group==='agent').length;const success=data.requests.filter(item=>['成功','恢复','重复'].includes(item.state)).length;const rate=data.requests.length?Math.round(success/data.requests.length*100):0;
  const content=tab==='target'?integrationTargetHtml(data):tab==='tools'?integrationToolsHtml(data):tab==='stability'?integrationStabilityHtml(data):integrationApiHtml(data);
  return heading('接口联调','开放接口与软件联调','覆盖图谱查询接口、智能体工具调用和目标软件接收记录。',`<button class="button" data-action="integration-refresh">${icon('refresh',15)}刷新记录</button>`)+`
  <div class="notice demo-note">${icon('info',16)}当前为本地模拟联调记录；真实目标软件接入后，同一页面可切换为真实记录并保留同一套请求、任务和回执结构。</div>
  <section class="panel integration-summary"><div><span>接口请求</span><strong>${apiCount}</strong></div><div><span>工具调用</span><strong>${agentCount}</strong></div><div><span>成功比例</span><strong>${rate}%</strong></div><div><span>目标软件回执</span><strong>${data.receipts.length}</strong></div></section>
  <div class="workspace-tabs integration-tabs"><button class="${tab==='api'?'active':''}" data-action="integration-tab" data-tab="api">接口目录</button><button class="${tab==='target'?'active':''}" data-action="integration-tab" data-tab="target">目标软件</button><button class="${tab==='tools'?'active':''}" data-action="integration-tab" data-tab="tools">智能体工具</button><button class="${tab==='stability'?'active':''}" data-action="integration-tab" data-tab="stability">稳定性</button></div>
  ${content}`;
}
async function loadIntegration(force=false){
  if(state.integrationLoading)return;
  state.integrationLoading=true;state.integrationError='';
  try{state.integrationData=await api('/integration?'+new URLSearchParams({projectId:state.projectId}));}
  catch(error){state.integrationError=error.message;toast(error.message);}
  finally{state.integrationLoading=false;if(route()==='integration')render({preserveScroll:!force});}
}
async function sendIntegrationRequest(){const scenario=$('#integration-api-scenario')?.value||'normal';try{state.integrationData=await api('/integration/mutate',{action:'send',projectId:state.projectId,endpointId:state.integrationEndpointId,scenario});render({preserveScroll:true});toast('模拟接口请求已记录。');}catch(error){toast(error.message);}}
async function runIntegrationTool(){const scenario=$('#integration-tool-scenario')?.value||'normal';try{state.integrationData=await api('/integration/mutate',{action:'tool-call',projectId:state.projectId,toolId:state.integrationToolId,scenario});render({preserveScroll:true});toast('模拟工具链路已记录。');}catch(error){toast(error.message);}}
async function runIntegrationScenario(group,scenario){try{state.integrationData=await api('/integration/mutate',group==='agent'?{action:'tool-call',projectId:state.projectId,toolId:state.integrationToolId,scenario}:{action:'send',projectId:state.projectId,endpointId:state.integrationEndpointId,scenario});render({preserveScroll:true});toast('联调场景已运行并记录。');}catch(error){toast(error.message);}}
async function saveIntegrationConfig(){
  if(!$('#integration-config-form'))return;
  const mappings={};for(const key of ['well','interval','layer','recommendation','status'])mappings[key]=$('#integration-map-'+key)?.value||'';
  try{state.integrationData=await api('/integration/mutate',{action:'config',projectId:state.projectId,softwareName:$('#integration-software-name').value,version:$('#integration-software-version').value,endpoint:$('#integration-software-endpoint').value,authMode:$('#integration-software-auth').value,enabled:$('#integration-software-enabled').checked,mappings});render({preserveScroll:true});toast('目标软件配置已保存。');}catch(error){toast(error.message);}
}
function openIntegrationRequest(id){
  const item=state.integrationData?.requests?.find(record=>record.id===id);if(!item)return;
  modal('联调请求详情 · '+item.id,`<dl class="integration-meta"><div><dt>接口</dt><dd>${escape(item.endpointName)}</dd></div><div><dt>场景</dt><dd>${escape(item.scenarioName)}</dd></div><div><dt>模式</dt><dd>${escape(item.mode)}</dd></div><div><dt>状态</dt><dd>${escape(item.state)} · HTTP ${escape(item.statusCode)}</dd></div><div><dt>延迟</dt><dd>${escape(item.latencyMs)} ms · 重试 ${escape(item.retryCount)}</dd></div><div><dt>任务</dt><dd class="mono">${escape(item.taskId)}</dd></div><div><dt>鉴权</dt><dd>${escape(item.auth)}</dd></div></dl><h3>请求</h3><pre>${escape(JSON.stringify(item.requestBody,null,2))}</pre><h3>响应</h3><pre>${escape(JSON.stringify(item.responseBody,null,2))}</pre>`,{wide:true});
}
function openIntegrationChain(id){
  const item=state.integrationData?.chains?.find(record=>record.id===id);if(!item)return;
  const receipt=state.integrationData.receipts.find(record=>record.chainId===id);
  modal('智能体工具链路 · '+item.id,`<dl class="integration-meta"><div><dt>工具</dt><dd>${escape(item.toolName)}</dd></div><div><dt>场景</dt><dd>${escape(item.scenarioName)}</dd></div><div><dt>状态</dt><dd>${escape(item.state)}</dd></div><div><dt>任务</dt><dd class="mono">${escape(item.taskId)}</dd></div></dl><div class="integration-chain">${item.steps.map((step,index)=>`<div class="integration-chain-step"><span>${index+1}</span><div><strong>${escape(step.actor)}</strong><p>${escape(step.action)}</p><small>${escape(step.status)} · ${escape(step.latencyMs)} ms</small></div></div>`).join('')}</div>${receipt?`<div class="regression-result ${receipt.status==='已接收'?'pass':'fail'}"><strong>目标软件：${escape(receipt.status)}</strong><p>${escape(receipt.note)}</p><small>${escape(receipt.id)} · ${escape(receipt.createdTime)}</small></div>`:''}`,{wide:true});
}
function opDisplayTime(value){if(!value)return '—';const parsed=new Date(value);return Number.isFinite(parsed.getTime())?parsed.toLocaleString('zh-CN',{hour12:false}):String(value);}
function opStatusTone(status){return ['成功','完成','一致','通过','正常'].includes(status)?'teal':['失败','超时','限流','越权','存在差异'].includes(status)?'red':['运行中','待执行','模拟模式'].includes(status)?'amber':'neutral';}
function opFilteredLogs(data){
  const query=(state.opLogQuery||'').toLowerCase();
  return data.logs.filter(item=>(state.opLogCategory==='all'||item.category===state.opLogCategory)&&(state.opLogStatus==='all'||item.status===state.opLogStatus)&&(!query||`${item.name} ${item.source} ${item.requestId} ${item.taskId} ${item.error} ${item.detail}`.toLowerCase().includes(query)));
}
function opLogTable(logs){
  if(!logs.length)return `<div class="empty-state compact"><h3>没有匹配日志</h3><p>调整分类、状态或关键词后重试。</p></div>`;
  return `<div class="table-scroll"><table class="operations-table"><thead><tr><th>时间</th><th>分类</th><th>来源</th><th>任务 / 请求</th><th>状态</th><th>耗时</th><th>错误</th><th>操作</th></tr></thead><tbody>${logs.map(item=>`<tr><td class="nowrap">${escape(opDisplayTime(item.time))}</td><td>${badge(item.category,'neutral')}</td><td>${escape(item.source)}<small>${escape(item.name)}</small></td><td class="mono">${escape(item.requestId||item.taskId||'—')}</td><td>${badge(item.status,opStatusTone(item.status))}</td><td>${escape(item.duration||'—')}</td><td class="error-cell">${escape(item.error||'—')}</td><td><button class="text-button" data-action="op-log-detail" data-log="${escape(item.id)}">详情</button></td></tr>`).join('')}</tbody></table></div>`;
}
function operationsOverviewHtml(data){
  const failures=data.logs.filter(item=>['失败','超时','限流','越权'].includes(item.status)).slice(0,6);
  const lastBackup=data.backups[0];
  return `<section class="panel operations-health"><div class="panel-heading"><h2>${icon('settings',17)}运行健康</h2>${badge('本机', 'neutral')}</div><div class="operations-health-grid">${data.health.map(item=>`<div><span>${escape(item.name)}</span><strong>${badge(item.status,opStatusTone(item.status))}</strong><small>${escape(item.detail)}</small></div>`).join('')}</div></section><div class="operations-two-col"><section class="panel"><div class="panel-heading"><h2>${icon('warning',17)}最近失败</h2>${badge(`${data.summary.failed} 项`,'neutral')}</div>${failures.length?`<div class="operations-failure-list">${failures.map(item=>`<button class="recent-run" data-action="op-log-detail" data-log="${escape(item.id)}"><span>${escape(item.category)} · ${escape(item.name)}</span><small>${escape(item.error||item.status)} ${icon('chevron',13)}</small></button>`).join('')}</div>`:`<div class="empty-state compact"><h3>暂无失败日志</h3><p>当前筛选范围内没有失败任务。</p></div>`}</section><section class="panel"><div class="panel-heading"><h2>${icon('clock',17)}运行摘要</h2>${badge(`${data.summary.total} 条`,'neutral')}</div><div class="operations-info-list"><div><span>A12 接口请求</span><strong>${data.summary.apiCount}</strong></div><div><span>A13 工具调用</span><strong>${data.summary.agentCount}</strong></div><div><span>最近备份</span><strong>${escape(lastBackup?.createdTime||'未备份')}</strong></div><div><span>部署版本</span><strong class="mono">${escape(data.deployment.version)}</strong></div><div><span>最近健康检查</span><strong>${escape(opDisplayTime(data.deployment.lastChecked))}</strong></div></div></section></div>`;
}
function operationsLogsHtml(data){
  const logs=opFilteredLogs(data);const categories=['all','导入','抽取','检索','推理','接口','运维','认证'];const statuses=['all','成功','失败','运行中','超时','限流','越权'];
  return `<section class="panel"><div class="panel-heading"><h2>${icon('clock',17)}任务与接口日志</h2>${badge(`${logs.length} / ${data.logs.length} 条`,'neutral')}</div><div class="operations-filters"><label>分类<select id="op-log-category">${categories.map(item=>`<option value="${item}" ${state.opLogCategory===item?'selected':''}>${item==='all'?'全部':item}</option>`).join('')}</select></label><label>状态<select id="op-log-status">${statuses.map(item=>`<option value="${item}" ${state.opLogStatus===item?'selected':''}>${item==='all'?'全部':item}</option>`).join('')}</select></label><label class="wide">关键词<input id="op-log-query" value="${escape(state.opLogQuery)}" placeholder="任务编号、请求编号或错误信息"></label><button type="button" class="button" data-action="op-apply-filter">应用筛选</button></div>${opLogTable(logs)}</section>`;
}
function operationsBackupsHtml(data){
  return `<section class="panel"><div class="panel-heading"><h2>${icon('folder',17)}备份清单</h2><button class="button primary" data-action="op-backup">${icon('download',15)}创建逻辑备份</button></div>${data.backups.length?`<div class="table-scroll"><table class="operations-table"><thead><tr><th>备份编号</th><th>名称</th><th>类型</th><th>状态</th><th>大小</th><th>校验值</th><th>创建时间</th><th>操作</th></tr></thead><tbody>${data.backups.map(item=>`<tr><td class="mono">${escape(item.id)}</td><td>${escape(item.name)}</td><td>${escape(item.kind)}</td><td>${badge(item.status,opStatusTone(item.status))}</td><td>${escape(item.size)} B</td><td class="mono">${escape(item.checksum)}</td><td class="nowrap">${escape(item.createdTime)}</td><td><div class="integration-run-buttons"><button class="text-button" data-action="op-backup-detail" data-backup="${escape(item.id)}">详情</button><button class="text-button" data-action="op-restore" data-backup="${escape(item.id)}">恢复核查</button></div></td></tr>`).join('')}</tbody></table></div>`:`<div class="empty-state compact"><h3>暂无备份</h3><p>创建逻辑备份后，可在这里查看校验值和恢复核查。</p></div>`}</section><section class="panel"><div class="panel-heading"><h2>${icon('refresh',17)}恢复核查记录</h2>${badge(`${data.restores.length} 次`,'neutral')}</div>${data.restores.length?`<div class="table-scroll"><table class="operations-table"><thead><tr><th>核查编号</th><th>备份</th><th>状态</th><th>执行人</th><th>时间</th><th>操作</th></tr></thead><tbody>${data.restores.map(item=>`<tr><td class="mono">${escape(item.id)}</td><td class="mono">${escape(item.backupId)}</td><td>${badge(item.status,opStatusTone(item.status))}</td><td>${escape(item.createdBy)}</td><td class="nowrap">${escape(item.createdTime)}</td><td><button class="text-button" data-action="op-restore-detail" data-restore="${escape(item.id)}">详情</button></td></tr>`).join('')}</tbody></table></div>`:`<div class="empty-state compact"><h3>暂无恢复核查</h3><p>恢复操作会生成一致性核查记录，不直接覆盖原始文件。</p></div>`}</section>`;
}
function operationsSecurityHtml(data){
  return `<section class="panel"><div class="panel-heading"><h2>${icon('users',17)}敏感字段与导出策略</h2>${badge('脱敏', 'teal')}</div><div class="table-scroll"><table class="operations-table"><thead><tr><th>字段</th><th>敏感级别</th><th>导出处理</th><th>示例</th><th>操作</th></tr></thead><tbody>${data.exportPolicies.map(item=>`<tr><td><strong>${escape(item.label)}</strong><small>${escape(item.key)}</small></td><td>${badge(item.level,item.level==='机密'?'red':item.level==='敏感'?'amber':'neutral')}</td><td>${badge(item.masked?'脱敏 / 禁止':'允许',item.masked?'teal':'neutral')}</td><td>${escape(item.sample)}</td><td>${item.key==='credential'?'<span class="subtle">强制脱敏</span>':`<button class="text-button" data-action="op-toggle-policy" data-key="${escape(item.key)}" data-masked="${item.masked?'false':'true'}">${item.masked?'取消脱敏':'启用脱敏'}</button>`}</td></tr>`).join('')}</tbody></table></div><div class="operations-security-actions"><button type="button" class="button primary" data-action="op-test-export">${icon('download',15)}生成测试导出</button><span class="subtle">凭据字段不会进入普通日志或导出文件。</span></div></section><section class="panel"><div class="panel-heading"><h2>${icon('file',17)}受保护导出记录</h2>${badge(`${data.exportRecords.length} 条`,'neutral')}</div>${data.exportRecords.length?`<div class="table-scroll"><table class="operations-table"><thead><tr><th>导出编号</th><th>文件</th><th>状态</th><th>脱敏字段</th><th>执行人</th><th>时间</th></tr></thead><tbody>${data.exportRecords.map(item=>`<tr><td class="mono">${escape(item.id)}</td><td>${escape(item.fileName)}</td><td>${badge(item.status,opStatusTone(item.status))}</td><td>${escape(item.maskedFields.join('、')||'无')}</td><td>${escape(item.createdBy)}</td><td class="nowrap">${escape(item.createdTime)}</td></tr>`).join('')}</tbody></table></div>`:`<div class="empty-state compact"><h3>暂无受保护导出</h3><p>生成测试导出后，会记录脱敏字段和导出人。</p></div>`}</section>`;
}
function operationsDeploymentHtml(data){
  const dep=data.deployment;
  return `<section class="panel deployment-panel"><div class="panel-heading"><h2>${icon('settings',17)}私有化部署信息</h2>${badge(dep.mode,'teal')}</div><div class="deployment-grid"><div><span>服务版本</span><strong class="mono">${escape(dep.version)}</strong></div><div><span>运行方式</span><strong>${escape(dep.mode)}</strong></div><div><span>初始化时间</span><strong>${escape(opDisplayTime(dep.initializedAt))}</strong></div><div><span>最近健康检查</span><strong>${escape(opDisplayTime(dep.lastChecked))}</strong></div></div><div class="deployment-config"><h3>配置模板</h3><pre>PORT=5173\nDATA_FILE=.runtime/platform.json\nSESSION_TTL=1800\nMODE=private\nLOG_LEVEL=info</pre></div><div class="deployment-actions"><button class="button" data-action="op-health-check">${icon('refresh',15)}运行健康检查</button><a class="button" href="/docs/页面搭建步骤.html" target="_blank" rel="noopener">查看部署资料</a></div></section><section class="panel"><div class="panel-heading"><h2>${icon('clock',17)}初始化、升级与回退记录</h2>${badge(`${dep.records.length} 条`,'neutral')}</div><div class="deployment-form"><label>版本号<input id="op-deploy-version" placeholder="例如 0.11.0"></label><label>类型<select id="op-deploy-kind"><option value="upgrade">升级</option><option value="rollback">回退</option></select></label><label class="wide">说明<input id="op-deploy-note" placeholder="记录本次部署变更"></label><button type="button" class="button primary" data-action="op-deploy-record">登记部署记录</button></div><div class="table-scroll"><table class="operations-table"><thead><tr><th>记录</th><th>类型</th><th>版本</th><th>说明</th><th>执行人</th><th>时间</th></tr></thead><tbody>${dep.records.map(item=>`<tr><td class="mono">${escape(item.id)}</td><td>${badge(item.kind,'neutral')}</td><td class="mono">${escape(item.version)}</td><td>${escape(item.note||'—')}</td><td>${escape(item.createdBy)}</td><td class="nowrap">${escape(item.createdTime)}</td></tr>`).join('')}</tbody></table></div></section>`;
}
function operationsHtml(){
  if(state.operationsError)return heading('运行管理','部署与运行管理','查看运行日志、备份恢复、导出保护和私有化部署状态。','')+`<section class="panel"><div class="empty-state"><h3>运行数据读取失败</h3><p>${escape(state.operationsError)}</p><button class="button" data-action="operations-refresh">重新加载</button></div></section>`;
  if(!state.operationsData)return heading('运行管理','部署与运行管理','查看运行日志、备份恢复、导出保护和私有化部署状态。','')+`<section class="panel"><div class="empty-state"><h3>正在读取运行数据…</h3><p>如果长时间没有显示，请刷新。</p><button class="button" data-action="operations-refresh">刷新数据</button></div></section>`;
  const data=state.operationsData,tab=state.operationsTab||'overview';
  const content=tab==='logs'?operationsLogsHtml(data):tab==='backups'?operationsBackupsHtml(data):tab==='security'?operationsSecurityHtml(data):tab==='deployment'?operationsDeploymentHtml(data):operationsOverviewHtml(data);
  return heading('运行管理','部署与运行管理','查看运行日志、备份恢复、导出保护和私有化部署状态。',`<button class="button" data-action="operations-refresh">${icon('refresh',15)}刷新数据</button>`)+`
  <div class="notice demo-note">${icon('info',16)}运行日志汇总本机资料接入、知识构建、规则判定、联合分析和接口联调记录；敏感凭据不进入普通日志。</div>
  <section class="panel operations-summary"><div><span>日志总数</span><strong>${data.summary.total}</strong></div><div><span>失败 / 异常</span><strong>${data.summary.failed}</strong></div><div><span>A12 接口</span><strong>${data.summary.apiCount}</strong></div><div><span>A13 工具</span><strong>${data.summary.agentCount}</strong></div></section>
  <div class="workspace-tabs operations-tabs"><button class="${tab==='overview'?'active':''}" data-action="operations-tab" data-tab="overview">运行概览</button><button class="${tab==='logs'?'active':''}" data-action="operations-tab" data-tab="logs">日志</button><button class="${tab==='backups'?'active':''}" data-action="operations-tab" data-tab="backups">备份恢复</button><button class="${tab==='security'?'active':''}" data-action="operations-tab" data-tab="security">安全与导出</button><button class="${tab==='deployment'?'active':''}" data-action="operations-tab" data-tab="deployment">部署信息</button></div>
  ${content}`;
}
async function loadOperations(force=false){
  if(state.operationsLoading)return;state.operationsLoading=true;state.operationsError='';
  try{state.operationsData=await api('/operations?'+new URLSearchParams({projectId:state.projectId}));}
  catch(error){state.operationsError=error.message;toast(error.message);}
  finally{state.operationsLoading=false;if(route()==='operations')render({preserveScroll:!force});}
}
async function opBackup(){try{state.operationsData=await api('/operations/mutate',{action:'backup',projectId:state.projectId});render({preserveScroll:true});toast('逻辑备份已创建。');}catch(error){toast(error.message);}}
async function opRestore(backupId){try{state.operationsData=await api('/operations/mutate',{action:'restore',projectId:state.projectId,backupId});render({preserveScroll:true});toast('恢复一致性核查已完成。');}catch(error){toast(error.message);}}
async function opTogglePolicy(key,masked){try{state.operationsData=await api('/operations/mutate',{action:'toggle-policy',projectId:state.projectId,key,masked});render({preserveScroll:true});toast('导出策略已更新。');}catch(error){toast(error.message);}}
async function opTestExport(){try{state.operationsData=await api('/operations/mutate',{action:'test-export',projectId:state.projectId});render({preserveScroll:true});toast('测试导出记录已生成。');}catch(error){toast(error.message);}}
async function opDeployRecord(){try{state.operationsData=await api('/operations/mutate',{action:'deploy-record',projectId:state.projectId,kind:$('#op-deploy-kind')?.value,version:$('#op-deploy-version')?.value,note:$('#op-deploy-note')?.value||''});render({preserveScroll:true});toast('部署记录已保存。');}catch(error){toast(error.message);}}
async function opHealthCheck(){try{state.operationsData=await api('/operations/mutate',{action:'health-check',projectId:state.projectId});render({preserveScroll:true});toast('健康检查已完成。');}catch(error){toast(error.message);}}
function opLogDetail(id){const item=state.operationsData?.logs?.find(record=>record.id===id);if(!item)return;modal('运行日志 · '+item.id,`<dl class="integration-meta"><div><dt>分类</dt><dd>${escape(item.category)}</dd></div><div><dt>来源</dt><dd>${escape(item.source)}</dd></div><div><dt>名称</dt><dd>${escape(item.name)}</dd></div><div><dt>状态</dt><dd>${escape(item.status)}</dd></div><div><dt>耗时</dt><dd>${escape(item.duration||'—')}</dd></div><div><dt>请求编号</dt><dd class="mono">${escape(item.requestId||'—')}</dd></div><div><dt>任务编号</dt><dd class="mono">${escape(item.taskId||'—')}</dd></div><div><dt>错误</dt><dd>${escape(item.error||'—')}</dd></div></dl><h3>说明</h3><pre>${escape(item.detail||'—')}</pre>`,{wide:true});}
function opBackupDetail(id){const item=state.operationsData?.backups?.find(record=>record.id===id);if(!item)return;modal('备份详情 · '+item.id,`<dl class="integration-meta"><div><dt>名称</dt><dd>${escape(item.name)}</dd></div><div><dt>状态</dt><dd>${escape(item.status)}</dd></div><div><dt>校验值</dt><dd class="mono">${escape(item.checksum)}</dd></div><div><dt>大小</dt><dd>${escape(item.size)} B</dd></div></dl><h3>一致性检查</h3><div class="table-scroll"><table class="operations-table"><thead><tr><th>对象</th><th>数量</th><th>状态</th></tr></thead><tbody>${item.consistency.checks.map(check=>`<tr><td>${escape(check.key)}</td><td>${escape(check.value)}</td><td>${badge(check.status,opStatusTone(check.status))}</td></tr>`).join('')}</tbody></table></div>`,{wide:true});}
function opRestoreDetail(id){const item=state.operationsData?.restores?.find(record=>record.id===id);if(!item)return;modal('恢复核查 · '+item.id,`<dl class="integration-meta"><div><dt>备份</dt><dd class="mono">${escape(item.backupId)}</dd></div><div><dt>状态</dt><dd>${escape(item.status)}</dd></div><div><dt>执行人</dt><dd>${escape(item.createdBy)}</dd></div><div><dt>时间</dt><dd>${escape(item.createdTime)}</dd></div></dl><p class="subtle">${escape(item.note)}</p><div class="table-scroll"><table class="operations-table"><thead><tr><th>对象</th><th>备份值</th><th>当前值</th><th>状态</th></tr></thead><tbody>${item.checks.map(check=>`<tr><td>${escape(check.key)}</td><td>${escape(check.snapshot)}</td><td>${escape(check.current)}</td><td>${badge(check.status,opStatusTone(check.status))}</td></tr>`).join('')}</tbody></table></div>`,{wide:true});}
function reasoningHtml(){return state.reasoningView==='regression'?regressionHtml():rulesHtml();}
function rulesHtml() {
  return heading('规则与推理','规则库与判定记录','维护规则适用范围与版本，在检索结果页执行规则判定。',`<button class="button primary" data-route="retrieval">${icon('play',15)}打开规则判定面板</button>`)+`
  <section class="panel rule-library"><div class="panel-heading"><h2>${icon('rule',18)}专家规则库</h2>${badge('示例规则 · 待专家确认','amber')}</div><div class="rule-library-body"><div><h3>${escape(state.rule.name)}</h3><p>${escape(state.rule.description)}</p><dl class="rule-attributes"><div><dt>规则编号</dt><dd class="mono">${state.rule.id}</dd></div><div><dt>适用场景</dt><dd>地层对比 / 已确认同层位</dd></div><div><dt>版本</dt><dd>${escape(state.rule.version)}</dd></div><div><dt>来源</dt><dd>${escape(state.rule.source)}</dd></div></dl></div><form id="rule-form" class="rule-settings"><label for="rule-threshold">厚度差阈值（m）</label><input id="rule-threshold" type="number" min="0.000001" step="any" value="${escape(state.rule.threshold)}" required><label class="checkbox-label"><input id="rule-enabled" type="checkbox" ${state.rule.enabled?'checked':''}>启用示例规则</label><button class="button primary" type="submit">保存示例规则</button><small>修改生成新示例版本，历史运行保留原规则快照。</small></form></div></section>
  <section class="panel rule-library neighbor-rule-library"><div class="panel-heading"><h2>${icon('well',18)}邻井可参考性规则</h2>${badge('示例规则 · 待专家确认','amber')}</div><div class="rule-library-body"><div><h3>${escape(state.neighborRule?.name||'邻井可参考性规则')}</h3><p>${escape(state.neighborRule?.description||'')}</p><dl class="rule-attributes"><div><dt>规则编号</dt><dd class="mono">${escape(state.neighborRule?.id||'—')}</dd></div><div><dt>适用场景</dt><dd>邻井推荐 / 候选井可参考性</dd></div><div><dt>厚度差阈值</dt><dd>${escape(state.neighborRule?.maxThicknessDifference??'—')} m</dd></div><div><dt>版本</dt><dd>${escape(state.neighborRule?.version||'—')}</dd></div><div><dt>来源</dt><dd>${escape(state.neighborRule?.source||'—')}</dd></div></dl></div><div class="rule-settings"><small>在“混合检索 → 邻井推荐”中选择候选井后运行。当前为只读示例配置；阈值和启停维护留待规则库扩展。</small></div></div></section>
  ${historyHtml()}
  ${jointHistoryHtml()}
  <section class="panel typical-well"><div class="panel-heading"><h2>${icon('well',18)}典型井与整改回归</h2>${badge('M7-F6','neutral')}</div><div class="typical-body"><p>从已完成的联合分析建立案例，保存专家意见，登记问题，记录整改版本，复测原失败及受影响用例，并由专家确认关闭。</p><div class="typical-actions"><button class="button primary" data-action="regression-open">${icon('arrow',15)}进入整改回归</button></div></div></section>`;
}
function regressionStatusTone(status){return status==='待校核'?'amber':status==='已校核'||status==='已关闭'?'teal':status==='已驳回'?'red':status==='整改中'?'blue':status==='待关闭'?'teal':status==='待整改'?'amber':'neutral';}
function regressionStatusLabel(status){return ({triggered:'厚度差待复核',not_triggered:'未触发',insufficient:'资料不足',no_rule:'无规则',conflict:'规则冲突',recommended:'可参考',review:'厚度差异待复核',not_recommended:'不建议参考'})[status]||status||'—';}
function regressionAnalysisLabel(analysis){return `${analysis.id} · ${analysis.wellName}${analysis.referenceWellName?' / '+analysis.referenceWellName:''} · ${analysis.scenario==='neighbor'?'邻井推荐':'地层对比'} · ${analysis.result?.conclusion?.title||'未形成结论'}`;}
function regressionCaseById(data,id){return data?.cases?.find(item=>item.id===id)||null;}
function regressionIssueById(data,id){return data?.issues?.find(item=>item.id===id)||null;}
function regressionCaseCreateHtml(data){
  if(!data.analyses.length)return `<div class="empty-state compact"><h3>暂无可选联合分析</h3><p>请先在“混合检索”中完成规则判定和联合分析，再建立典型案例。</p><button class="button" data-route="retrieval">去生成联合分析</button></div>`;
  return `<form id="regression-case-form" class="regression-form"><label>基线联合分析<select id="regression-analysis">${data.analyses.map(item=>`<option value="${escape(item.id)}">${escape(regressionAnalysisLabel(item))}</option>`).join('')}</select></label><label>案例名称<input id="regression-case-name" maxlength="100" placeholder="例如：JH-01 长 8₁ 厚度差异复核"></label><label class="wide">案例说明<input id="regression-case-note" maxlength="500" placeholder="说明该案例要验证的典型井问题"></label><button type="button" class="button primary" data-action="regression-case-create">${icon('play',15)}创建案例</button></form>`;
}
function regressionCaseListHtml(data,cases=data.cases){
  if(!cases.length)return `<div class="empty-state compact"><h3>暂无典型案例</h3><p>从已完成的联合分析建立第一个案例。</p></div>`;
  return `<div class="table-scroll"><table class="regression-table"><thead><tr><th>案例</th><th>井 / 场景</th><th>基线结论</th><th>状态</th><th>人工意见</th><th>问题</th><th>操作</th></tr></thead><tbody>${cases.map(item=>`<tr class="${item.id===state.regressionCaseId?'selected':''}"><td><strong>${escape(item.name)}</strong><small>${escape(item.id)} · ${escape(item.createdBy)}</small></td><td>${escape(item.wellName)}${item.referenceWellName?' / '+escape(item.referenceWellName):''}<small>${item.scenario==='neighbor'?'邻井推荐':'地层对比'}</small></td><td>${escape(item.baseline?.conclusion||'—')}<small>${escape(item.baseline?.statusLabel||'')}</small></td><td>${badge(item.status,regressionStatusTone(item.status))}</td><td>${item.expertReview?badge(item.expertReview.decision==='accepted'?'已接受':item.expertReview.decision==='modified'?'修改后接受':'已驳回',regressionStatusTone(item.expertReview.decision==='rejected'?'已驳回':'已校核')):'未校核'}</td><td>${item.issueIds?.length||0}</td><td><button class="text-button" data-action="regression-case-select" data-case="${escape(item.id)}">查看</button></td></tr>`).join('')}</tbody></table></div>`;
}
function regressionIssueListHtml(data,issues){
  if(!issues.length)return `<div class="empty-state compact"><h3>暂无问题记录</h3><p>在案例详情中登记需要整改的问题。</p></div>`;
  return `<div class="table-scroll"><table class="regression-table"><thead><tr><th>问题</th><th>所属案例</th><th>严重度</th><th>责任人</th><th>期望状态</th><th>实际状态</th><th>状态</th><th>操作</th></tr></thead><tbody>${issues.map(item=>{const caseItem=regressionCaseById(data,item.caseId);return `<tr class="${item.id===state.regressionIssueId?'selected':''}"><td><strong>${escape(item.title)}</strong><small>${escape(item.id)}</small></td><td>${escape(caseItem?.name||'—')}</td><td>${badge(item.severity,item.severity==='高'?'red':item.severity==='低'?'neutral':'amber')}</td><td>${escape(item.owner)}</td><td>${escape(regressionStatusLabel(item.expectedStatus))}</td><td>${escape(regressionStatusLabel(item.actualStatus))}</td><td>${badge(item.status,regressionStatusTone(item.status))}</td><td><button class="text-button" data-action="regression-issue-select" data-case="${escape(item.caseId)}" data-issue="${escape(item.id)}">查看</button></td></tr>`;}).join('')}</tbody></table></div>`;
}
function regressionCaseDetailHtml(data,item){
  if(!item)return '';
  const review=item.expertReview;
  const issues=data.issues.filter(issue=>issue.caseId===item.id);
  const expected=(data.statusOptions[item.scenario]||[]).map(status=>`<option value="${status}">${escape(regressionStatusLabel(status))}</option>`).join('');
  return `<section class="panel regression-detail"><div class="panel-heading"><h2>${icon('well',17)}${escape(item.name)}</h2>${badge(item.status,regressionStatusTone(item.status))}</div><div class="regression-baseline"><div><span>案例编号</span><strong class="mono">${escape(item.id)}</strong></div><div><span>基线分析</span><strong class="mono">${escape(item.analysisId)}</strong></div><div><span>对象</span><strong>${escape(item.wellName)}${item.referenceWellName?' / '+escape(item.referenceWellName):''}</strong></div><div><span>场景</span><strong>${item.scenario==='neighbor'?'邻井推荐':'地层对比'}</strong></div><div class="wide"><span>基线结论</span><strong>${escape(item.baseline?.conclusion||'—')}</strong><small>${escape(item.baseline?.statusLabel||'')} · ${escape(item.baseline?.time||'')}</small></div></div><div class="regression-columns"><section class="regression-block"><h3>${icon('users',15)}人工校核</h3>${review?`<div class="review-summary"><strong>${escape(review.decision==='accepted'?'已接受':review.decision==='modified'?'修改后接受':'已驳回')}</strong><p>${escape(review.note||'未填写备注')}</p><small>${escape(review.reviewer)} · ${escape(review.time)}</small></div>`:'<p class="subtle">该案例尚未完成人工校核。</p>'}${data.capabilities.review?`<div class="regression-form compact"><label>校核结论<select id="regression-review-decision"><option value="accepted" ${review?.decision==='accepted'?'selected':''}>接受</option><option value="modified" ${review?.decision==='modified'?'selected':''}>修改后接受</option><option value="rejected" ${review?.decision==='rejected'?'selected':''}>驳回</option></select></label><label>校核意见<textarea id="regression-review-note" maxlength="500" placeholder="驳回或修改必须填写意见">${escape(review?.note||'')}</textarea></label><button type="button" class="button primary" data-action="regression-case-review">保存校核意见</button></div>`:'<div class="admin-note">当前账号无人工校核权限。</div>'}</section><section class="regression-block"><h3>${icon('warning',15)}登记问题</h3>${data.capabilities.run?`<form id="regression-issue-form" class="regression-form compact"><label>问题标题<input id="regression-issue-title" maxlength="100" placeholder="例如：厚度差异未解释"></label><label>严重度<select id="regression-issue-severity"><option value="高">高</option><option value="中" selected>中</option><option value="低">低</option></select></label><label>责任人<input id="regression-issue-owner" maxlength="40" placeholder="例如：张工"></label><label>期望回归状态<select id="regression-issue-expected">${expected}</select></label><label class="wide">问题说明<textarea id="regression-issue-description" maxlength="500" placeholder="记录发现依据、影响范围和整改要求"></textarea></label><button type="button" class="button primary" data-action="regression-issue-create">登记问题</button></form>`:'<div class="admin-note">当前账号无问题登记权限。</div>'}</section></div><section class="regression-block"><h3>${icon('clock',15)}问题台账 <span>${issues.length} 项</span></h3>${regressionIssueListHtml(data,issues)}</section></section>`;
}
function regressionReviewHtml(data){
  const cases=[...data.cases].sort((a,b)=>Number(b.status==='待校核')-Number(a.status==='待校核'));
  const selected=regressionCaseById(data,state.regressionCaseId)||cases[0];
  return `<section class="panel"><div class="panel-heading"><h2>${icon('users',17)}结果校核</h2>${badge('人工意见', 'neutral')}</div><div class="regression-note">${icon('info',15)}先选择案例查看基线结论，再保存接受、修改后接受或驳回意见。</div>${regressionCaseListHtml(data,cases)}</section>${regressionCaseDetailHtml(data,selected)}`;
}
function regressionIssueDetailHtml(data,item){
  if(!item)return '';
  const caseItem=regressionCaseById(data,item.caseId);const regression=data.regressions.find(record=>record.id===item.regressionId);
  const candidates=(data.analyses||[]).filter(analysis=>analysis.scenario===caseItem?.scenario&&analysis.id!==caseItem?.analysisId);
  const affected=data.cases.filter(record=>record.id!==item.caseId);
  const fixForm=item.status==='待整改'?`<section class="regression-block"><h3>${icon('refresh',15)}整改与回归</h3>${candidates.length?`<div class="regression-form compact"><label>整改后的联合分析<select id="regression-candidate">${candidates.map(analysis=>`<option value="${escape(analysis.id)}">${escape(regressionAnalysisLabel(analysis))}</option>`).join('')}</select></label><label class="wide">整改说明<textarea id="regression-fix-note" maxlength="500" placeholder="说明修改了哪些数据、规则或判断条件"></textarea></label><div class="regression-affected"><span>受影响用例</span>${affected.map(record=>`<label class="checkbox-label"><input type="checkbox" name="regression-affected" value="${escape(record.id)}">${escape(record.id)} · ${escape(record.name)}</label>`).join('')||'<small>暂无其他案例</small>'}</div><button type="button" class="button primary" data-action="regression-fix-run">运行整改回归</button></div>`:`<div class="admin-note">暂无可用的同场景新分析，请先生成整改后的联合分析。</div>`}</section>`:'';
  const closeForm=item.status==='待关闭'&&data.capabilities.review?`<section class="regression-block"><h3>${icon('check',15)}人工关闭</h3><label class="wide">关闭意见<textarea id="regression-close-note" maxlength="500" placeholder="确认原失败用例和受影响用例均已复测通过"></textarea></label><button type="button" class="button primary" data-action="regression-close-issue">确认关闭</button></section>`:'';
  return `<section class="panel regression-detail"><div class="panel-heading"><h2>${icon('warning',17)}${escape(item.title)}</h2>${badge(item.status,regressionStatusTone(item.status))}</div><div class="regression-baseline"><div><span>问题编号</span><strong class="mono">${escape(item.id)}</strong></div><div><span>所属案例</span><strong>${escape(caseItem?.name||'—')}</strong></div><div><span>责任人</span><strong>${escape(item.owner)}</strong></div><div><span>严重度</span><strong>${escape(item.severity)}</strong></div><div><span>期望状态</span><strong>${escape(regressionStatusLabel(item.expectedStatus))}</strong></div><div><span>实际状态</span><strong>${escape(regressionStatusLabel(item.actualStatus))}</strong></div><div class="wide"><span>问题说明</span><strong>${escape(item.description||'未填写说明')}</strong></div></div>${regression?`<div class="regression-result ${regression.result==='通过'?'pass':'fail'}"><strong>回归${escape(regression.result)}</strong><p>${escape(regression.baselineConclusion||'—')} → ${escape(regression.candidateConclusion||'—')}</p><small>${escape(regression.id)} · ${escape(regression.createdBy)} · ${escape(regression.createdTime)}</small></div>`:''}${fixForm}${closeForm}${item.status==='已关闭'?`<div class="regression-closed">${icon('check',15)}<div><strong>已由 ${escape(item.closedBy)} 关闭</strong><p>${escape(item.closeNote)}</p><small>${escape(item.closedTime)}</small></div></div>`:''}</section>`;
}
function regressionIssuesHtml(data){
  const selected=regressionIssueById(data,state.regressionIssueId)||data.issues[0];
  return `<section class="panel"><div class="panel-heading"><h2>${icon('warning',17)}问题台账</h2>${badge(`${data.issues.length} 项`,'neutral')}</div>${regressionIssueListHtml(data,data.issues)}</section>${regressionIssueDetailHtml(data,selected)}`;
}
function regressionRunsHtml(data){
  if(!data.regressions.length)return `<section class="panel"><div class="empty-state compact"><h3>暂无回归记录</h3><p>登记问题并运行整改回归后，记录会显示在这里。</p></div></section>`;
  return `<section class="panel"><div class="panel-heading"><h2>${icon('refresh',17)}回归记录</h2>${badge(`${data.regressions.length} 次`,'neutral')}</div><div class="table-scroll"><table class="regression-table"><thead><tr><th>回归编号</th><th>案例 / 问题</th><th>期望状态</th><th>实际状态</th><th>结果</th><th>执行人</th><th>时间</th><th>操作</th></tr></thead><tbody>${data.regressions.map(item=>{const caseItem=regressionCaseById(data,item.caseId),issue=regressionIssueById(data,item.issueId);return `<tr><td class="mono">${escape(item.id)}</td><td>${escape(caseItem?.name||'—')}<small>${escape(issue?.title||'—')}</small></td><td>${escape(item.expectedLabel)}</td><td>${escape(item.actualLabel)}</td><td>${badge(item.result,item.result==='通过'?'teal':'red')}</td><td>${escape(item.createdBy)}</td><td class="nowrap">${escape(item.createdTime)}</td><td><button class="text-button" data-action="regression-detail" data-regression="${escape(item.id)}">详情</button></td></tr>`;}).join('')}</tbody></table></div></section>`;
}
function regressionHtml(){
  if(!state.regressionData)return heading('规则与推理','典型井与整改回归','从典型井案例出发，完成人工校核、问题登记、整改回归和人工关闭。',`<button class="button" data-action="regression-back">返回规则库</button>`)+`<section class="panel"><div class="empty-state"><h3>正在读取整改回归数据…</h3><p>如果长时间没有显示，请刷新。</p><button class="button" data-action="regression-refresh">刷新数据</button></div></section>`;
  const data=state.regressionData;const openIssues=data.issues.filter(item=>item.status!=='已关闭').length;const passed=data.regressions.filter(item=>item.result==='通过').length;
  const tab=state.regressionTab||'cases';
  const content=tab==='review'?regressionReviewHtml(data):tab==='issues'?regressionIssuesHtml(data):tab==='regressions'?regressionRunsHtml(data):`${regressionCaseCreateHtml(data)}${regressionCaseListHtml(data)}${regressionCaseDetailHtml(data,regressionCaseById(data,state.regressionCaseId)||data.cases[0])}`;
  return heading('规则与推理','典型井与整改回归','案例 → 校核 → 问题 → 整改回归 → 人工关闭。',`<button class="button" data-action="regression-back">返回规则库</button>`)+`
  <section class="panel regression-summary"><div><span>案例</span><strong>${data.cases.length}</strong></div><div><span>待处理问题</span><strong>${openIssues}</strong></div><div><span>回归通过</span><strong>${passed}</strong></div><div><span>回归未通过</span><strong>${data.regressions.length-passed}</strong></div></section>
  <div class="workspace-tabs regression-tabs"><button class="${tab==='cases'?'active':''}" data-action="regression-tab" data-tab="cases">案例</button><button class="${tab==='review'?'active':''}" data-action="regression-tab" data-tab="review">结果校核</button><button class="${tab==='issues'?'active':''}" data-action="regression-tab" data-tab="issues">问题台账</button><button class="${tab==='regressions'?'active':''}" data-action="regression-tab" data-tab="regressions">回归记录</button></div>
  ${content}`;
}
function historyHtml() {
  const runs=state.runs.filter(r=>r.projectId===state.projectId);
  return `<section class="panel history-panel"><div class="panel-heading"><h2>${icon('clock',17)}规则判定运行记录</h2>${badge(`${runs.length} 条`,'neutral')}</div>${runs.length?`<div class="table-scroll"><table><thead><tr><th>运行编号</th><th>分析对象</th><th>判定结论</th><th>规则版本</th><th>时间</th><th>操作</th></tr></thead><tbody>${runs.map(run=>`<tr><td class="mono">${escape(run.id)}</td><td>${escape(run.wellName)}</td><td>${badge(neighborStatusLabel(run.result.status),['not_triggered','recommended'].includes(run.result.status)?'teal':['triggered','conflict','review'].includes(run.result.status)?'amber':'neutral')}</td><td>${escape(run.result.rule.version)}</td><td class="nowrap">${escape(run.time)}</td><td><button class="text-button" data-action="run-detail" data-run="${escape(run.id)}">详情</button></td></tr>`).join('')}</tbody></table></div>`:`<div class="empty-state">${icon('clock',30)}<h3>暂无规则判定记录</h3><p>在检索结果页运行判定后，可在这里回看输入、规则与证据。</p><button class="button" data-route="retrieval">打开规则判定面板</button></div>`}</section>`;
}
function evidenceModal(which) {
  const well=which==='reference'?referenceWell():currentWell();
  if(!authorizedAssets.some(a=>a.wellId===well.id&&a.objectType==='stratum')){toast('无权查看该分层证据。');return;}
  modal('资料来源 · 分层记录',`<div class="source-dialog-title">${icon('file',23)}<div><h3>${escape(well.source??'受限或未提供')}</h3><p>${badge('虚构示例资料','neutral')} ${well.version}</p></div></div><dl class="evidence-attributes"><div><dt>井号</dt><dd>${well.short}</dd></div><div><dt>层位</dt><dd>${escape(well.layer??'受限或未提供')}</dd></div><div><dt>井段</dt><dd>${escape(well.depth??'受限或未提供')}</dd></div><div><dt>厚度</dt><dd>${escape(well.thickness??'字段受限')} m</dd></div><div><dt>定位</dt><dd>示例分层表 · 第1行</dd></div><div><dt>基准</dt><dd>MD / m</dd></div></dl><div class="source-quote">“${well.short}，${escape(well.layer??'受限或未提供')}，井段 ${escape(well.depth??'受限或未提供')}，厚度 ${escape(well.thickness??'字段受限')} m。”</div><p class="subtle">规则面板的样例数据或手工厚度值可能与此原始样例不同；实际判定所用数值及来源请查看本次输入快照。</p>`);
}
async function runRule() {
  const sample=demoCases.find(c=>c.id===state.sampleId);
  const run=await api('/business/run',{projectId:state.projectId,wellId:state.wellId,referenceWellId:referenceWell().id,scenario:state.scenario,aligned:sample.aligned,sameBasis:sample.sameBasis,conflict:sample.conflict,targetThickness:$('#target-thickness').value,referenceThickness:$('#reference-thickness').value});
  state.activeResult=run;state.runs.unshift(run);state.formDirty=false;
  state.activeJoint=null;state.jointRuns=state.jointRuns||[];
  $('#judgement-result').innerHTML=resultHtml(run);
  const jointHost=$('#joint-result');if(jointHost)jointHost.innerHTML=jointEmptyHtml();
  const jointButton=$('[data-action="joint-analysis"]');if(jointButton)jointButton.disabled=state.scenario!=='strata';
  applyPermissions();toast('判定已保存，输入、规则版本与审计记录可回查。');
}
function invalidateNeighborResult() {
  state.activeResult = null;state.activeJoint = null;state.formDirty = true;
  const host = $('#judgement-result');if (host) host.innerHTML = '<div class="notice">'+icon('info',16)+'输入已修改，请重新运行邻井判定。历史结果保留在运行记录中。</div>';
  document.querySelector('.neighbor-review-panel')?.remove();
  const button = $('[data-action="joint-analysis"]');if (button) button.disabled = true;
}
function invalidateResult() {
  state.formDirty=true;state.activeResult=null;
  state.activeJoint=null;
  $('#judgement-result').innerHTML='<div class="notice">'+icon('info',16)+'输入已修改，请重新运行规则判定。历史结果保留在运行记录中。</div>';
  const jointHost=$('#joint-result');if(jointHost)jointHost.innerHTML=jointEmptyHtml();
  document.querySelector('.neighbor-review-panel')?.remove();
  const jointButton=$('[data-action="joint-analysis"]');if(jointButton)jointButton.disabled=true;
  const origin=$('#measurement-origin');if(origin)origin.textContent='手工输入（示例）';
}

// SVG 原生鼠标聚焦会滚动整个图形；保留焦点但不移动当前视口。
document.addEventListener('mousedown',event=>{
  const node=event.target.closest('.graph-node,.onto-node,.onto-edge');
  if(!node||event.button!==0)return;
  event.preventDefault();
  node.focus({preventScroll:true});
});
document.addEventListener('click',async event=>{
  if(event.target.closest('[data-auth]')){await handleAuthAction(event);return;}
  if(await usersUI.click(event))return;
  if(!currentUser)return;
  const permissionButton=event.target.closest('[data-action]');
  const actionPermission={import:'import','run-rule':'run','neighbor-search':'run','neighbor-run':'run','neighbor-review':'review','export-run':'export','joint-analysis':'run','joint-export':'export'}[permissionButton?.dataset.action];
  if(actionPermission&&!permitted(actionPermission)){toast('无权执行此操作。');return;}
  try {
  if(await graphUI.click(event))return;
  if(await constructionUI.click(event))return;
  if(await ontologyUI.click(event))return;
  if(await ingestionUI.click(event))return;
  const routeButton=event.target.closest('[data-route]');
  if(routeButton){go(routeButton.dataset.route);return;}
  const control=event.target.closest('[data-action]');if(!control)return;
  const {action,well,type,run:runId}=control.dataset;
  if(action==='close-modal') {$('dialog')?.close();return;}
  if(action==='toggle-well'){state.expanded.has(well)?state.expanded.delete(well):state.expanded.add(well);$('#tree-list').innerHTML=treeHtml();return;}
  if(action==='expand-tree'){projectWells().forEach(w=>state.expanded.add(w.id));$('#tree-list').innerHTML=treeHtml();return;}
  if(action==='select-node'){
    state.selectedAssetId='';
    const changed=state.wellId!==well;
    state.wellId=well;state.selectedType=type;state.expanded.add(well);
    if(changed){state.activeResult=null;state.activeJoint=null;}
    persist();
    graphUI.selectContext();
    if(changed||['graph','retrieval'].includes(route()))render({preserveScroll:true});else updateObjectSelection();
    return;
  }
  if(action==='home-tab'){state.homeTab=control.dataset.tab;render();return;}
  if(action==='refresh'){state.updatedAt=new Date();await refreshWorkspace();toast('已重新读取当前身份与授权范围。');return;}
  if(action==='scenario'){go('retrieval',control.dataset.scenario);return;}
  if(action==='run-rule'){await runRule();return;}
  if(action==='evidence'){evidenceModal(control.dataset.evidence);return;}
  if(action==='run-detail'||action==='run-evidence'){
    const run=state.runs.find(r=>r.id===runId)||state.activeResult;if(!run)return;
    modal(action==='run-evidence'?'本次判定依据与输入快照':'规则判定记录',`<p>${escape(run.wellName)} / ${escape(run.referenceWellName)} · ${escape(run.time)}</p>${resultHtml(run)}<details class="snapshot"><summary>查看完整输入与版本快照</summary><pre>${escape(JSON.stringify(run,null,2))}</pre></details>`,{wide:true});return;
  }
  if(action==='export-run'){const existing=state.runs.find(r=>r.id===runId)||state.activeResult;if(existing){const run=await api('/business/export',{projectId:existing.projectId,wellId:existing.wellId,runId:existing.id});downloadJson(run,run.id+'.json');}return;}
  if(action==='joint-open'){
    const analysis=state.jointRuns.find(item=>item.id===control.dataset.analysis)||state.activeJoint;
    if(!analysis)return;
    state.scenario=analysis.scenario||'strata';state.wellId=analysis.wellId;state.expanded.add(analysis.wellId);
    const snapshot=analysis.result?.inputSnapshot;const input=snapshot?.run?.result?.input||{};const ref=snapshot?.referenceWell||{};
    if(analysis.scenario==='neighbor'&&snapshot){
      state.neighborRadius=Number(input.radius)||state.neighborRadius;state.neighborFocus=input.focus||'';state.neighborSelectedId=analysis.referenceWellId||'';
      state.neighborCandidates={target:{wellId:snapshot.targetWell?.id,short:snapshot.targetWell?.short,layer:input.targetLayer,depth:snapshot.targetWell?.depth,thickness:snapshot.targetWell?.thickness,source:snapshot.targetWell?.source,version:snapshot.targetWell?.version},radius:state.neighborRadius,outOfRange:0,rule:snapshot.run?.result?.rule||state.neighborRule,candidates:[{wellId:analysis.referenceWellId,name:ref.name,short:ref.short,layer:ref.layer,depth:ref.depth,thickness:ref.thickness,distance:Number(input.distance),source:ref.source,version:ref.version,sameLayer:input.layerMatch===true,thicknessDifference:snapshot.run?.result?.difference??null,dataComplete:input.dataComplete===true}]};
    } else if(analysis.scenario!=='neighbor'){state.neighborCandidates=null;state.neighborSelectedId='';}
    state.jointMode=analysis.mode==='demo-llm'?'demo-llm':'local';state.activeJoint=analysis;state.activeResult=state.runs.find(item=>item.id===analysis.runId)||snapshot?.run||null;state.formDirty=false;
    $('dialog')?.close();if(route()==='retrieval')render();else location.hash='#/retrieval';return;
  }
  if(action==='operations-tab'){state.operationsTab=control.dataset.tab;render({preserveScroll:true});return;}
  if(action==='operations-refresh'){await loadOperations(true);return;}
  if(action==='op-apply-filter'){render({preserveScroll:true});return;}
  if(action==='op-log-detail'){opLogDetail(control.dataset.log);return;}
  if(action==='op-backup'){await opBackup();return;}
  if(action==='op-restore'){await opRestore(control.dataset.backup);return;}
  if(action==='op-backup-detail'){opBackupDetail(control.dataset.backup);return;}
  if(action==='op-restore-detail'){opRestoreDetail(control.dataset.restore);return;}
  if(action==='op-toggle-policy'){await opTogglePolicy(control.dataset.key,control.dataset.masked==='true');return;}
  if(action==='op-test-export'){await opTestExport();return;}
  if(action==='op-deploy-record'){await opDeployRecord();return;}
  if(action==='op-health-check'){await opHealthCheck();return;}
  if(action==='integration-tab'){state.integrationTab=control.dataset.tab;render({preserveScroll:true});return;}
  if(action==='integration-select-endpoint'){state.integrationEndpointId=control.dataset.endpoint;render({preserveScroll:true});return;}
  if(action==='integration-select-tool'){state.integrationToolId=control.dataset.tool;render({preserveScroll:true});return;}
  if(action==='integration-send'){await sendIntegrationRequest();return;}
  if(action==='integration-tool-call'){await runIntegrationTool();return;}
  if(action==='integration-config-save'){await saveIntegrationConfig();return;}
  if(action==='integration-run-scenario'){await runIntegrationScenario(control.dataset.group,control.dataset.scenario);return;}
  if(action==='integration-request-detail'){openIntegrationRequest(control.dataset.request);return;}
  if(action==='integration-chain-detail'){openIntegrationChain(control.dataset.chain);return;}
  if(action==='integration-refresh'){await loadIntegration(true);return;}
  if(action==='regression-open'){await openRegression();return;}
  if(action==='regression-back'){closeRegression();return;}
  if(action==='regression-refresh'){await loadRegression();return;}
  if(action==='regression-tab'){state.regressionTab=control.dataset.tab;render({preserveScroll:true});return;}
  if(action==='regression-case-select'){state.regressionCaseId=control.dataset.case;state.regressionIssueId='';render({preserveScroll:true});return;}
  if(action==='regression-case-create'){await createRegressionCase();return;}
  if(action==='regression-case-review'){await reviewRegressionCase();return;}
  if(action==='regression-issue-create'){await createRegressionIssue();return;}
  if(action==='regression-issue-select'){selectRegressionIssue(control.dataset.case,control.dataset.issue);return;}
  if(action==='regression-fix-run'){await runRegressionFix();return;}
  if(action==='regression-close-issue'){await closeRegressionIssue();return;}
  if(action==='regression-detail'){openRegressionDetail(control.dataset.regression);return;}
  if(action==='neighbor-search'){await loadNeighbors();return;}
  if(action==='neighbor-select'){selectNeighbor(control.dataset.well);return;}
  if(action==='neighbor-run'){await runNeighborRule();return;}
  if(action==='neighbor-review'){await reviewNeighbor(control.dataset.decision);return;}
  if(action==='neighbor-evidence'){neighborEvidenceModal(control.dataset.well);return;}
  if(action==='joint-analysis'){await runJointAnalysis();return;}
  if(action==='joint-export'){await exportJointAnalysis(control.dataset.analysis);return;}
  if(action==='joint-detail'){openJointDetail(control.dataset.analysis);return;}
  if(action==='joint-clear'){state.activeJoint=null;const jointHost=$('#joint-result');if(jointHost)jointHost.innerHTML=jointEmptyHtml();return;}
  if(action==='asset-detail'){
    await ingestionUI.open(control.dataset.asset);return;
  }
  if(action==='import'){
    await ingestionUI.import();return;
  }
  if(action==='notifications'){modal('我的待办',`<div class="task-list">${taskList()}</div><p class="subtle">当前展示示例校核任务。</p>`);return;}
  if(action==='profile'){modal('个人信息',`<div class="profile-card"><span class="avatar large">${escape(currentUser.name.slice(0,1))}</span><h3>${escape(currentUser.name)}</h3><p>${escape(currentUser.roleName)}</p></div><dl class="evidence-attributes"><div><dt>账号</dt><dd>${escape(currentUser.account)}</dd></div><div><dt>组织</dt><dd>${escape(currentUser.orgName)}</dd></div><div><dt>可访问项目</dt><dd>${projects.map(p=>escape(p.name)).join('、')||'尚未分配'}</dd></div></dl><div class="modal-actions"><button class="button danger" data-auth="logout">退出登录</button></div>`);return;}
  if(action==='help') modal('工作台使用说明','<ol><li>从左侧数据树选择井或知识对象，下方查看属性。</li><li>进入数据接入，上传CSV/JSON并确认字段、单位和深度基准。</li><li>查看质量问题，配置主数据映射或修正副本，再运行校验。</li><li>合格版本可提交至待知识构建清单，原件与历史版本保留。</li><li>混合检索与规则判定仍使用独立的虚构样例数据。</li></ol><p class="subtle">OCR、外部连接器、实时流及知识实体关系抽取尚未接入。</p>');
  }catch(error){toast(error.message);}
});
document.addEventListener('change',event=>{
  usersUI.change(event);
  ontologyUI.change(event);
  constructionUI.change(event);
  graphUI.change(event);
  if(event.target.id==='project-select'&&ontologyUI.hasUnsaved()&&!window.confirm('当前本体有未保存修改，切换项目将放弃这些修改。是否继续？')){event.target.value=state.projectId;return;}
  if(event.target.id==='project-select'){state.selectedAssetId='';state.graphReferenceWellId='';state.projectId=event.target.value;state.wellId=currentProject().wells[0];state.selectedType='well';state.expanded=new Set([state.wellId]);state.activeResult=null;state.treeFilter='';state.reasoningView='rules';state.regressionData=null;state.regressionCaseId='';state.regressionIssueId='';persist();render();}
  if(event.target.id==='analysis-well'){state.wellId=event.target.value;state.selectedType='well';state.expanded.add(state.wellId);state.activeResult=null;state.activeJoint=null;state.neighborCandidates=null;state.neighborSelectedId='';graphUI.selectContext();persist();render();}
  if(event.target.id==='op-log-category'){state.opLogCategory=event.target.value;render({preserveScroll:true});}
  if(event.target.id==='op-log-status'){state.opLogStatus=event.target.value;render({preserveScroll:true});}
  if(event.target.id==='neighbor-radius'){state.neighborRadius=Number(event.target.value)||0;state.neighborCandidates=null;state.neighborSelectedId='';state.activeResult=null;state.activeJoint=null;state.formDirty=false;render({preserveScroll:true});}
  if(event.target.id==='sample-select'){state.sampleId=event.target.value;state.formDirty=false;state.activeResult=null;state.activeJoint=null;render();}
  if(event.target.id==='scenario-select'){state.scenario=event.target.value;state.activeResult=null;state.activeJoint=null;render();}
  if(event.target.id==='joint-mode'){state.jointMode=event.target.value;state.activeJoint=null;state.formDirty=false;render({preserveScroll:true});}
});
document.addEventListener('input',event=>{
  if(event.target.id==='neighbor-focus'){state.neighborFocus=event.target.value;invalidateNeighborResult();}
  if(event.target.id==='op-log-query'){state.opLogQuery=event.target.value;}
  ontologyUI.input(event);
  if(event.target.id==='tree-search'){state.treeFilter=event.target.value;$('#tree-list').innerHTML=treeHtml();}
  if(['target-thickness','reference-thickness'].includes(event.target.id))invalidateResult();
});
document.addEventListener('submit',async event=>{
  if(event.target.id.startsWith('gm-')){event.preventDefault();await graphUI.submit(event);return;}
  if(event.target.id.startsWith('kc-')){event.preventDefault();await constructionUI.submit(event);return;}
  if(event.target.id.startsWith('onto-')||event.target.id.startsWith('ing-')||['login-form','admin-edit-form','audit-filter-form','rule-form'].includes(event.target.id))event.preventDefault();
  if(await ontologyUI.submit(event))return;
  if(event.target.id.startsWith('ing-')||['login-form','admin-edit-form','audit-filter-form','rule-form'].includes(event.target.id))event.preventDefault();
  if(await ingestionUI.submit(event))return;
  if(['login-form','admin-edit-form','audit-filter-form','rule-form'].includes(event.target.id))event.preventDefault();
  if(event.target.id==='login-form'){event.preventDefault();await login(event.target);return;}
  if(await usersUI.submit(event))return;
  if(!currentUser)return;
  try {
  if(event.target.id==='rule-form'){
    event.preventDefault();const threshold=Number($('#rule-threshold').value);if(!Number.isFinite(threshold)||threshold<=0){toast('请输入大于零的阈值。');return;}
    state.rule=await api('/business/rule-edit',{projectId:state.projectId,wellId:state.wellId,threshold,enabled:$('#rule-enabled').checked});state.activeResult=null;await refreshWorkspace();toast('规则已保存，历史记录保留原版本。');
  }
  }catch(error){toast(error.message);}
});
document.addEventListener('keydown',event=>{if((event.key==='Enter'||event.key===' ')&&event.target.matches('.graph-node')){event.preventDefault();event.target.dispatchEvent(new MouseEvent('click',{bubbles:true}));}});
const usersUI=createUsersUI({modal,toast,refresh:refreshWorkspace,getUser:()=>currentUser});
const ingestionUI=createIngestionUI({getContext:()=>({projectId:state.projectId,wellId:state.wellId,block:currentProject().block,canData:permitted('data'),canImport:permitted('import'),route:route()}),repaint:render,refresh:refreshWorkspace,modal,toast,go,constructionSelector:id=>ontologyUI.constructionSelector(id),selectAsset:asset=>{state.wellId=asset.wellId;state.selectedType=asset.objectType;state.selectedAssetId=asset.id;state.expanded.add(asset.wellId);}});
const ontologyUI=createOntologyUI({getContext:()=>({projectId:state.projectId,canOntology:permitted('ontology'),canConstruction:permitted('construction'),assets:getAssets()}),repaint:render,modal,toast,go});
const constructionUI=createConstructionUI({getContext:()=>({projectId:state.projectId,wellId:state.wellId,canConstruction:permitted('construction'),route:route()}),repaint:render,modal,toast,go});
const graphUI=createGraphUI({getContext:()=>({projectId:state.projectId,wellId:state.wellId,selectedType:state.selectedType,canGraph:permitted('graph')}),repaint:render,modal,toast,go,openAsset:id=>ingestionUI.open(id),onSelect:context=>{if(context.wellId){if(state.wellId!==context.wellId)state.graphReferenceWellId='';state.wellId=context.wellId;state.expanded.add(context.wellId);}state.selectedType=objectTypes.some(t=>t.id===context.type)?context.type:'well';state.selectedAssetId='';state.activeResult=null;},onContext:context=>{if(context.wellId){state.wellId=context.wellId;state.expanded.add(context.wellId);}state.selectedType=objectTypes.some(t=>t.id===context.type)?context.type:'well';state.selectedAssetId='';state.graphReferenceWellId=context.referenceWellId||'';state.activeResult=null;}});
document.addEventListener('keydown',event=>{if((event.key==='Enter'||event.key===' ')&&event.target.matches('.gm-canvas [data-gm]')){event.preventDefault();event.target.dispatchEvent(new MouseEvent('click',{bubbles:true}));}});
document.addEventListener('dragstart',event=>ontologyUI.dragstart(event));
document.addEventListener('dragover',event=>{if(event.target.closest('.onto-canvas'))event.preventDefault();});
document.addEventListener('drop',event=>ontologyUI.drop(event));
document.addEventListener('pointerdown',event=>ontologyUI.pointerdown(event));
document.addEventListener('pointermove',event=>ontologyUI.pointermove(event));
document.addEventListener('pointerup',event=>ontologyUI.pointerup(event));
document.addEventListener('pointercancel',event=>ontologyUI.pointerup(event));
document.addEventListener('keydown',event=>{if((event.key==='Enter'||event.key===' ')&&event.target.matches('.onto-node,.onto-edge')){event.preventDefault();event.target.dispatchEvent(new MouseEvent('click',{bubbles:true}));}});
window.addEventListener('beforeunload',event=>{if(ontologyUI.hasUnsaved()){event.preventDefault();event.returnValue='';}});
function applyPermissions(){
  for(const button of document.querySelectorAll('[data-route]'))if(!permitted(button.dataset.route))button.disabled=true;
  for(const button of document.querySelectorAll('[data-action]')){const key={import:'import','run-rule':'run','neighbor-search':'retrieval','neighbor-run':'run','neighbor-review':'review','export-run':'export','joint-analysis':'run','joint-export':'export'}[button.dataset.action];if(key&&!permitted(key))button.hidden=true;}
  if(!permitted('rule-edit'))for(const input of document.querySelectorAll('#rule-form input,#rule-form button'))input.disabled=true;
  if(!projects.length||route()==='users'){document.querySelector('.context-bar')?.classList.add('hidden');document.querySelector('.data-sidebar')?.classList.add('hidden');document.querySelector('.app-body')?.classList.add('admin-layout');}
}
function clearSession(message=''){
  ingestionUI.clear();
  ontologyUI.clear();
  constructionUI.clear();
  graphUI.clear();state.graphReferenceWellId='';
  state.selectedAssetId='';
  currentUser=null;projects=[];wells=[];initialTasks=[];authorizedAssets=[];allowedActions={};state.runs=[];state.jointRuns=[];state.neighborCandidates=null;state.neighborSelectedId='';state.reasoningView='rules';state.regressionData=null;state.regressionCaseId='';state.regressionIssueId='';state.integrationData=null;state.integrationError='';state.operationsData=null;state.operationsError='';state.imported=[];state.activeResult=null;state.activeJoint=null;state.jointMode='local';state.projectId='';state.wellId='';state.homeTab='overview';state.treeFilter='';state.selectedType='well';state.expanded=new Set();usersUI.clear();clearTimeout(sessionTimer);$('#overlay-root').innerHTML='';loginNotice=message;authLoading=false;location.hash='/login';render();
}
async function refreshWorkspace(fetchData=true){
  if(fetchData){const me=await api('/auth/me');currentUser=me.user;const data=await api('/workspace');projects=data.projects;wells=data.wells;initialTasks=data.tasks;authorizedAssets=data.assets;allowedActions=data.capabilities||{};state.runs=data.runs;state.jointRuns=data.jointRuns||[];state.rule=data.rule;state.neighborRule=data.neighborRule||state.neighborRule;state.jointProvider=data.jointProvider||state.jointProvider;state.demoLlmProvider=data.demoLlmProvider||state.demoLlmProvider;state.regressionData=null;state.integrationData=null;state.integrationError='';state.operationsData=null;state.operationsError='';if(!projects.some(p=>p.id===state.projectId))state.projectId=projects[0]?.id||'';if(!projectWells().some(w=>w.id===state.wellId))state.wellId=projectWells()[0]?.id||'';state.expanded.add(state.wellId);state.activeResult=null;state.activeJoint=null;clearTimeout(sessionTimer);sessionTimer=setTimeout(()=>clearSession('登录已失效，请重新登录。'),Math.max(1,me.expires-Date.now()));}
  render();
}
async function login(form){
  const button=form.querySelector('[type="submit"]');button.disabled=true;button.textContent='正在登录…';
  try{const result=await api('/auth/login',{account:form.elements.account.value.trim(),password:form.elements.password.value});currentUser=result.user;loginNotice='';await refreshWorkspace();location.hash='/home';render();}
  catch(error){currentUser=null;const message=$('#login-message');if(message){message.textContent=error.message;message.classList.remove('hidden');}else clearSession(error.message);}
  finally{button.disabled=false;button.textContent='登录平台 →';}
}
async function handleAuthAction(event){const control=event.target.closest('[data-auth]');if(control.dataset.auth==='password'){const password=$('#login-password');password.type=password.type==='password'?'text':'password';control.textContent=password.type==='password'?'显示':'隐藏';control.setAttribute('aria-label',password.type==='password'?'显示密码':'隐藏密码');}
  if(control.dataset.auth==='account'){$('#login-account').value=control.dataset.account;$('#login-password').value='GeoDemo!2026';$('#login-account').focus();}
  if(control.dataset.auth==='logout'){try{await api('/auth/logout',{});clearSession('您已退出登录。');}catch(error){toast(error.message);}}
}
window.addEventListener('session-expired',()=>clearSession('登录已失效或账号已停用，请重新登录。'));
window.addEventListener('hashchange',async()=>{$('dialog')?.close();if(currentUser&&route()==='users')await usersUI.load();if(currentUser&&route()==='construction')await constructionUI.load();if(currentUser&&permitted('graph')&&['graph','retrieval'].includes(route()))await graphUI.load();render();});
window.addEventListener('focus',async()=>{if(!currentUser)return;try{await refreshWorkspace();if(permitted('graph')&&['graph','retrieval'].includes(route()))await graphUI.load();}catch(error){if(error.status!==401)toast(error.message);}});
async function start(){render();try{await refreshWorkspace();if(route()==='users')await usersUI.load();authLoading=false;render();}catch(error){if(error.status===401)clearSession();else {authLoading=false;clearSession('无法连接服务，请确认本机服务已启动后刷新。');}}}
start();
