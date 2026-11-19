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
  sampleId:'triggered', scenario:'strata', activeResult:null, formDirty:false,
  rule: saved.rule && Number(saved.rule.threshold)>0 ? {...defaultRule,...saved.rule} : {...defaultRule},
  runs: Array.isArray(saved.runs) ? saved.runs.slice(0,30) : [],
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
  if(scenario) {state.scenario=scenario;state.activeResult=null;}
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
  if(page==='operations') return heading('运行管理','运行记录','查看本次工作台中的规则判定记录及其输入快照。')+historyHtml()+moduleRoadmap(page);
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

function retrievalHtml() {
  const sample=demoCases.find(c=>c.id===state.sampleId);const target=currentWell();const ref=referenceWell();
  return heading('混合检索','检索与规则判定','查到哪些资料、为什么选这条规则、各项条件如何判断，在同一面板中逐项核查。',`<button class="button" data-route="reasoning">${icon('rule',15)}规则库与运行记录</button>`)+`
  ${graphUI.retrievalHtml()}<div class="notice demo-note">${icon('info',16)}当前使用示例资料与规则。厚度差阈值 ${escape(state.rule.threshold)} m 为示例值，正式规则需经专家确认。</div>
  <section class="panel analysis-context"><div class="panel-heading"><h2><span class="section-index">01</span>选择分析对象</h2>${badge('规则判定','blue')}</div><div class="analysis-fields"><label>目标井<select id="analysis-well">${projectWells().map(w=>`<option value="${w.id}" ${w.id===state.wellId?'selected':''}>${w.name}</option>`).join('')}</select></label><label>参考井<input value="${ref.name}" readonly></label><label>分析场景<select id="scenario-select"><option value="strata" ${state.scenario==='strata'?'selected':''}>地层对比</option><option value="neighbor" ${state.scenario==='neighbor'?'selected':''}>邻井推荐</option></select></label><label>井段 / 层位<input value="${escape(target.layer??'字段受限')} · ${escape(target.depth??'字段受限')}" readonly></label></div><div class="sample-controls"><label for="sample-select">样例数据</label><select id="sample-select">${demoCases.map(c=>`<option value="${c.id}" ${c.id===state.sampleId?'selected':''}>${c.name}</option>`).join('')}</select><button class="button primary" id="run-rule" data-action="run-rule">${icon('play',15)}运行规则判定</button><span class="subtle">T3：检索 → 规则关联 → 确定性判断</span></div></section>
  <div class="analysis-grid"><section class="panel retrieved-panel"><div class="panel-heading"><h2><span class="section-index">02</span>检索到的资料</h2>${badge('A07','neutral')}</div>${[target,ref].filter((w,i,list)=>list.findIndex(x=>x.id===w.id)===i).map(w=>{const asset=authorizedAssets.find(a=>a.wellId===w.id&&a.objectType==='stratum');return asset?`<div class="source-card"><div class="source-icon">${icon('file',19)}</div><div><strong>${escape(w.short)} 分层记录</strong><small>${escape(w.layer??'字段受限')} · ${escape(w.depth??'字段受限')} · MD / m</small><p>${escape(asset.source??'来源字段受限')}</p><button class="text-button" data-action="evidence" data-evidence="${w.id===target.id?'target':'reference'}">查看原始记录</button></div></div>`:`<div class="admin-note">${escape(w.short)} 分层证据不可访问。</div>`;}).join('')}<div class="evidence-footnote">${icon('link',14)}井 → 井段 → 地层 → 分层记录；资料版本 ${target.version}</div></section>
  <section class="panel selected-rule"><div class="panel-heading"><h2><span class="section-index">03</span>系统选择的规则</h2>${badge('A08','neutral')}</div>${!sample.aligned||state.scenario!=='strata'||!state.rule.enabled?`<div class="rule-empty">${icon('info',24)}<strong>无适用规则</strong><p>${!state.rule.enabled?'示例规则已停用。':state.scenario!=='strata'?'当前厚度差规则仅适用于地层对比；邻井推荐规则待专家提供。':'尚未确认两井层位对应，本规则不适用。'}</p></div>`:`<div class="rule-detail"><div class="rule-name"><strong>${escape(state.rule.name)}</strong>${badge(sample.conflict?'存在冲突':'适用',sample.conflict?'amber':'teal')}</div><div class="rule-code mono">${state.rule.id} · ${escape(state.rule.version)}</div><p>${escape(state.rule.description)}</p><dl><div><dt>选用理由</dt><dd>已选择地层对比；样例数据标记层位已确认对应。</dd></div><div><dt>判定条件</dt><dd>两井厚度差绝对值 &gt; ${escape(state.rule.threshold)} m</dd></div><div><dt>规则来源</dt><dd>${escape(state.rule.source)}</dd></div></dl>${sample.conflict?'<div class="inline-warning">样例模拟同一工况存在相反规则结论，需人工处理。</div>':''}</div>`}</section></div>
  <section class="panel judgement-panel"><div class="panel-heading"><h2><span class="section-index">04</span>逐项判定与最终结论</h2>${badge('A09','neutral')}</div><div class="measurement-row"><label>目标井厚度 <span>m</span><input id="target-thickness" type="number" min="0" step="0.1" value="${permitted('run')?(sample.target??''):''}" placeholder="${permitted('run')?'缺失':'无判定权限或字段受限'}" ${permitted('run')?'':'disabled'}></label><label>参考井厚度 <span>m</span><input id="reference-thickness" type="number" min="0" step="0.1" value="${permitted('run')?(sample.reference??''):''}" placeholder="${permitted('run')?'缺失':'无判定权限或字段受限'}" ${permitted('run')?'':'disabled'}></label><div class="measurement-basis"><span>本次实测输入</span><strong id="measurement-origin">样例数据 · ${sample.sameBasis?'同一基准':'基准未统一'}</strong><small>输入值和来源会保存在运行快照中</small></div></div><div id="judgement-result">${state.activeResult?resultHtml(state.activeResult):'<div class="judgement-empty">'+icon('rule',28)+'<strong>等待运行规则判定</strong><p>上方查看资料和适用规则，点击“运行规则判定”后查看计算过程、结论与证据。</p></div>'}</div></section>
  <section class="panel joint-panel"><div><h2>${icon('graph',18)}图谱与大模型联合分析 <span class="badge neutral">A10 / T4</span></h2><p>在规则判定后，将事实、规则结果和引用作为分析输入。</p></div><button class="button" data-action="joint-analysis" ${!state.activeResult||state.formDirty?'disabled':''}>${icon('play',15)}生成联合分析</button></section>`;
}
function resultHtml(run) {
  const r=run.result;const tone=r.status==='triggered'||r.status==='conflict'?'amber':r.status==='not_triggered'?'teal':r.status==='error'?'red':'slate';
  return `<div class="result-summary ${tone}"><span class="result-icon">${icon(r.status==='not_triggered'?'check':r.status==='triggered'?'warning':'info',24)}</span><div><strong>${escape(r.title)}</strong><p>${escape(r.reason)}</p></div>${badge('示例判定',tone)}</div>${r.steps.length?`<div class="table-scroll"><table class="judgement-table"><thead><tr><th>判定项</th><th>实际值</th><th>规则条件</th><th>逐项结果</th></tr></thead><tbody>${r.steps.map(step=>`<tr><td>${step.name}</td><td>${escape(step.actual)}</td><td>${escape(step.condition)}</td><td>${badge(step.passed?'满足':'不满足',step.passed?'teal':'neutral')}</td></tr>`).join('')}</tbody></table></div>`:''}<div class="result-evidence"><span>${icon('link',14)}证据：${escape(run.measurementSource)} · 输入快照已留存</span><button class="text-button" data-action="run-evidence" data-run="${escape(run.id)}">查看本次依据</button></div><div class="run-meta"><span class="mono">${escape(run.id)}</span><span>${escape(run.time)} · ${escape(r.rule.version)}</span><button class="text-button" data-action="export-run" data-run="${escape(run.id)}">${icon('download',13)}导出记录</button></div>`;
}
function reasoningHtml() {
  return heading('规则与推理','规则库与判定记录','维护规则适用范围与版本，在检索结果页执行规则判定。',`<button class="button primary" data-route="retrieval">${icon('play',15)}打开规则判定面板</button>`)+`
  <section class="panel rule-library"><div class="panel-heading"><h2>${icon('rule',18)}专家规则库</h2>${badge('示例规则 · 待专家确认','amber')}</div><div class="rule-library-body"><div><h3>${escape(state.rule.name)}</h3><p>${escape(state.rule.description)}</p><dl class="rule-attributes"><div><dt>规则编号</dt><dd class="mono">${state.rule.id}</dd></div><div><dt>适用场景</dt><dd>地层对比 / 已确认同层位</dd></div><div><dt>版本</dt><dd>${escape(state.rule.version)}</dd></div><div><dt>来源</dt><dd>${escape(state.rule.source)}</dd></div></dl></div><form id="rule-form" class="rule-settings"><label for="rule-threshold">厚度差阈值（m）</label><input id="rule-threshold" type="number" min="0.000001" step="any" value="${escape(state.rule.threshold)}" required><label class="checkbox-label"><input id="rule-enabled" type="checkbox" ${state.rule.enabled?'checked':''}>启用示例规则</label><button class="button primary" type="submit">保存示例规则</button><small>修改生成新示例版本，历史运行保留原规则快照。</small></form></div></section>
  ${historyHtml()}
  <section class="panel typical-well"><div class="panel-heading"><h2>${icon('well',18)}典型井与整改回归</h2>${badge('暂未开放','neutral')}</div><div class="typical-body"><p>案例运行、专家意见、问题登记、整改版本、原失败及受影响用例回归、人工确认关闭。</p><span class="subtle">案例管理、结果校核与整改回归功能暂未开放。</span></div></section>`;
}
function historyHtml() {
  const runs=state.runs.filter(r=>r.projectId===state.projectId);
  return `<section class="panel history-panel"><div class="panel-heading"><h2>${icon('clock',17)}规则判定运行记录</h2>${badge(`${runs.length} 条`,'neutral')}</div>${runs.length?`<div class="table-scroll"><table><thead><tr><th>运行编号</th><th>分析对象</th><th>判定结论</th><th>规则版本</th><th>时间</th><th>操作</th></tr></thead><tbody>${runs.map(run=>`<tr><td class="mono">${escape(run.id)}</td><td>${escape(run.wellName)}</td><td>${badge(run.result.status==='triggered'?'厚度差待复核':run.result.status==='not_triggered'?'未触发':run.result.status==='no_rule'?'无规则':run.result.status==='conflict'?'规则冲突':'资料不足',run.result.status==='not_triggered'?'teal':'amber')}</td><td>${escape(run.result.rule.version)}</td><td class="nowrap">${escape(run.time)}</td><td><button class="text-button" data-action="run-detail" data-run="${escape(run.id)}">详情</button></td></tr>`).join('')}</tbody></table></div>`:`<div class="empty-state">${icon('clock',30)}<h3>暂无规则判定记录</h3><p>在检索结果页运行判定后，可在这里回看输入、规则与证据。</p><button class="button" data-route="retrieval">打开规则判定面板</button></div>`}</section>`;
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
  $('#judgement-result').innerHTML=resultHtml(run);$('.joint-panel button').disabled=false;applyPermissions();toast('判定已保存，输入、规则版本与审计记录可回查。');
}
function invalidateResult() {
  state.formDirty=true;state.activeResult=null;
  $('#judgement-result').innerHTML='<div class="notice">'+icon('info',16)+'输入已修改，请重新运行规则判定。历史结果保留在运行记录中。</div>';
  $('#measurement-origin').textContent='手工输入（示例）';$('.joint-panel button').disabled=true;
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
  const actionPermission={import:'import','run-rule':'run','export-run':'export','joint-analysis':'run'}[permissionButton?.dataset.action];
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
    if(changed)state.activeResult=null;
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
  if(action==='joint-analysis'){
    if(!state.activeResult||state.formDirty){toast('请先完成有效的规则判定。');return;}
    modal('生成联合分析',`<div class="notice">${icon('info',18)}尚未配置大模型分析服务，本次没有生成联合分析结果。</div><p>当前已整理好可供分析使用的资料与证据包，可导出交由后续服务接入。</p><ul><li>场景：${state.scenario==='strata'?'地层对比':'邻井推荐'}</li><li>对象：${currentWell().short} / ${referenceWell().short}</li><li>规则：${escape(state.activeResult.result.rule.name)}（${escape(state.activeResult.result.rule.version)}）</li><li>判定：${escape(state.activeResult.result.title)}</li><li>内容：资料标识、实测输入、逐项判断、结论及来源快照</li></ul><button class="button primary" data-action="export-run" data-run="${state.activeResult.id}">${icon('download',15)}导出分析输入包</button>`);return;
  }
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
  if(event.target.id==='project-select'){state.selectedAssetId='';state.graphReferenceWellId='';state.projectId=event.target.value;state.wellId=currentProject().wells[0];state.selectedType='well';state.expanded=new Set([state.wellId]);state.activeResult=null;state.treeFilter='';persist();render();}
  if(event.target.id==='analysis-well'){state.wellId=event.target.value;state.selectedType='well';state.expanded.add(state.wellId);state.activeResult=null;graphUI.selectContext();persist();render();}
  if(event.target.id==='sample-select'){state.sampleId=event.target.value;state.formDirty=false;state.activeResult=null;render();}
  if(event.target.id==='scenario-select'){state.scenario=event.target.value;state.activeResult=null;render();}
});
document.addEventListener('input',event=>{
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
  for(const button of document.querySelectorAll('[data-action]')){const key={import:'import','run-rule':'run','export-run':'export','joint-analysis':'run'}[button.dataset.action];if(key&&!permitted(key))button.hidden=true;}
  if(!permitted('rule-edit'))for(const input of document.querySelectorAll('#rule-form input,#rule-form button'))input.disabled=true;
  if(!projects.length||route()==='users'){document.querySelector('.context-bar')?.classList.add('hidden');document.querySelector('.data-sidebar')?.classList.add('hidden');document.querySelector('.app-body')?.classList.add('admin-layout');}
}
function clearSession(message=''){
  ingestionUI.clear();
  ontologyUI.clear();
  constructionUI.clear();
  graphUI.clear();state.graphReferenceWellId='';
  state.selectedAssetId='';
  currentUser=null;projects=[];wells=[];initialTasks=[];authorizedAssets=[];allowedActions={};state.runs=[];state.imported=[];state.activeResult=null;state.projectId='';state.wellId='';state.homeTab='overview';state.treeFilter='';state.selectedType='well';state.expanded=new Set();usersUI.clear();clearTimeout(sessionTimer);$('#overlay-root').innerHTML='';loginNotice=message;authLoading=false;location.hash='/login';render();
}
async function refreshWorkspace(fetchData=true){
  if(fetchData){const me=await api('/auth/me');currentUser=me.user;const data=await api('/workspace');projects=data.projects;wells=data.wells;initialTasks=data.tasks;authorizedAssets=data.assets;allowedActions=data.capabilities||{};state.runs=data.runs;state.rule=data.rule;if(!projects.some(p=>p.id===state.projectId))state.projectId=projects[0]?.id||'';if(!projectWells().some(w=>w.id===state.wellId))state.wellId=projectWells()[0]?.id||'';state.expanded.add(state.wellId);state.activeResult=null;clearTimeout(sessionTimer);sessionTimer=setTimeout(()=>clearSession('登录已失效，请重新登录。'),Math.max(1,me.expires-Date.now()));}
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
