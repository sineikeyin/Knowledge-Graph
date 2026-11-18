import {icon} from './icons.js';
import {projects, wells, objectTypes, defaultRule, demoCases, initialTasks, moduleDefinitions} from './data.js';
import {evaluateThicknessRule} from './rules.js';

const $ = (selector, parent = document) => parent.querySelector(selector);
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function readSaved() {try {return JSON.parse(localStorage.getItem('geokg-workbench-v1') || '{}');} catch {return {};}}
const saved = readSaved();
const state = {
  projectId: projects.some(p => p.id === saved.projectId) ? saved.projectId : 'p1',
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
const currentProject = () => projects.find(p => p.id === state.projectId);
const projectWells = () => wells.filter(w => currentProject().wells.includes(w.id));
if (!currentProject().wells.includes(state.wellId)) state.wellId=currentProject().wells[0];
const currentWell = () => wells.find(w => w.id === state.wellId);
const referenceWell = () => projectWells().find(w => w.id !== state.wellId) || currentWell();
const route = () => (location.hash.match(/^#\/([a-z]+)/)?.[1] || 'home');
function persist() {
  try {localStorage.setItem('geokg-workbench-v1',JSON.stringify({projectId:state.projectId,wellId:state.wellId,selectedType:state.selectedType,rule:state.rule,runs:state.runs.slice(0,30),imported:state.imported}));}
  catch {toast('浏览器存储不可用，本次修改仅在当前页面保留。');}
}
function toast(message) {const target=$('#toast');target.textContent=message;target.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>target.classList.remove('show'),4200);}
function badge(text,tone='blue') {return `<span class="badge ${tone}">${escape(text)}</span>`;}
function go(page,scenario) {
  if(scenario) {state.scenario=scenario;state.activeResult=null;}
  if(route()===page) render(); else location.hash=`/${page}`;
}
function getAssets() {
  const rows=[];
  for(const well of projectWells()) for(const type of objectTypes) {
    for(let n=0;n<type.count;n++) rows.push({id:`${well.id}-${type.id}-${n}`,wellId:well.id,name:`${well.short}_${type.name}${type.id==='log' ? (n ? '_AC':'_GR'):''}`,type:type.type,source:well.source,version:well.version,status:'演示资料',tone:'neutral'});
  }
  return [...state.imported.filter(a=>projectWells().some(w=>w.id===a.wellId)),...rows];
}
function modal(title,body,{wide=false}={}) {
  $('#overlay-root').innerHTML=`<dialog class="modal ${wide?'wide':''}" aria-labelledby="dialog-title"><div class="modal-head"><h2 id="dialog-title">${escape(title)}</h2><button class="icon-button" data-action="close-modal" aria-label="关闭弹窗">${icon('close')}</button></div><div class="modal-body">${body}</div></dialog>`;
  const dialog=$('dialog');dialog.addEventListener('click',event=>{if(event.target===dialog) dialog.close();});dialog.showModal();
}
function downloadJson(data,name) {
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json;charset=utf-8'}));
  const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
function render() {
  const page=route();
  $('#app').innerHTML=`
  <header class="app-header">
    <a class="brand" href="#/home"><span class="brand-mark">${icon('graph',26)}</span><span><strong>智能地质导向知识图谱平台</strong><small>专业资料 · 知识关联 · 辅助分析</small></span></a>
    <div class="header-right"><span class="demo-indicator"><i></i>本地演示</span><span class="update-time">更新于 <span id="updated-time">${state.updatedAt.toLocaleTimeString('zh-CN',{hour12:false})}</span></span><span class="header-divider"></span><button class="icon-button" data-action="notifications" aria-label="查看待办通知">${icon('bell')}</button><button class="icon-button" data-action="help" aria-label="查看使用说明">${icon('info')}</button><button class="user-button" data-action="profile" aria-label="查看个人信息"><span class="avatar">演</span><span><strong>演示用户</strong><small>地质工程师</small></span>${icon('down',14)}</button></div>
  </header>
  <nav class="main-nav" aria-label="主菜单">${navigation.map(([id,glyph,label])=>`<button data-route="${id}" class="nav-item ${page===id?'active':''}" ${page===id?'aria-current="page"':''}>${icon(glyph,17)}<span>${label}</span></button>`).join('')}</nav>
  <div class="context-bar"><div class="context-controls"><label for="project-select">当前项目</label><select id="project-select">${projects.map(p=>`<option value="${p.id}" ${p.id===state.projectId?'selected':''}>${p.name}</option>`).join('')}</select><span class="context-stat">井数 <b>${projectWells().length}</b></span><span class="context-stat">资料 <b>${getAssets().length}</b></span><span class="context-stat current-well">当前井 <b>${currentWell().short}</b></span></div><div class="context-steps"><span>工作流程</span><button data-action="import">1 导入资料</button>${icon('chevron',12)}<button data-route="construction">2 构建知识</button>${icon('chevron',12)}<button class="step-current" data-route="retrieval">3 检索与推理</button></div></div>
  <div class="app-body"><aside class="data-sidebar" aria-label="数据树与属性"><section class="tree-pane"><div class="pane-heading"><h2>${icon('folder',17)}数据资源</h2><button class="icon-button small" data-action="expand-tree" aria-label="展开全部井">${icon('layers',16)}</button></div><label class="tree-search">${icon('search',15)}<input id="tree-search" placeholder="搜索井、资料或对象" aria-label="搜索数据树" value="${escape(state.treeFilter)}"></label><div id="tree-list" class="tree-list">${treeHtml()}</div><button class="tree-import" data-action="import">${icon('upload',15)}导入资料</button></section><section id="properties" class="properties-pane">${propertiesHtml()}</section></aside><main class="main-content" id="main-content" tabindex="-1">${pageHtml(page)}</main></div>
  <footer class="status-bar"><span><i class="status-dot"></i>示例数据 · ${currentProject().block} / ${currentWell().short}</span><span>资料版本 ${currentWell().version}<span class="footer-separator">|</span>知识可追溯 · 结果可校核</span></footer>`;
}
function treeHtml() {
  const filter=state.treeFilter.toLowerCase();
  let count=0;
  const rows=projectWells().map(well=>{
    const wellMatch=well.name.toLowerCase().includes(filter);
    const types=objectTypes.filter(t=>wellMatch || t.name.includes(filter) || t.type.includes(filter));
    if(!wellMatch&&!types.length) return '';
    count++;
    const expanded=state.expanded.has(well.id)||Boolean(filter);
    return `<div class="well-group"><div class="tree-well-row ${well.id===state.wellId&&state.selectedType==='well'?'selected':''}"><button class="tree-toggle ${expanded?'expanded':''}" data-action="toggle-well" data-well="${well.id}" aria-label="${expanded?'折叠':'展开'}${well.name}" aria-expanded="${expanded}">${icon('chevron',13)}</button><button class="tree-node" data-action="select-node" data-well="${well.id}" data-type="well">${icon('well',16)}<span>${well.short}</span><small>${objectTypes.reduce((n,t)=>n+t.count,0)} 份</small></button></div>${expanded?`<div class="tree-children">${types.map(type=>`<button class="tree-leaf ${state.wellId===well.id&&state.selectedType===type.id?'selected':''}" data-action="select-node" data-well="${well.id}" data-type="${type.id}">${icon(type.icon,14)}<span>${type.name}</span><small>${type.count}</small></button>`).join('')}</div>`:''}</div>`;
  }).join('');
  return `<div class="tree-project">${icon('folder',16)}<strong>${currentProject().name}</strong><small>${projectWells().length} 井</small></div>${rows || '<div class="tree-empty">没有匹配的井或资料。</div>'}${count?'<div class="tree-note">选择对象可查看下方属性</div>':''}`;
}
function propertiesHtml() {
  const well=currentWell();const type=objectTypes.find(t=>t.id===state.selectedType);
  return `<div class="pane-heading"><h2>${icon('panel',16)}对象属性</h2>${badge(type?.type || '井','neutral')}</div><div class="property-name">${icon(type?.icon||'well',20)}<strong>${type ? type.name : well.name}</strong></div><dl class="property-list"><div><dt>所属项目</dt><dd>${currentProject().name}</dd></div><div><dt>井号</dt><dd>${well.short}</dd></div><div><dt>目标层位</dt><dd>${well.layer}</dd></div><div><dt>井段范围</dt><dd>${well.depth}</dd></div><div><dt>深度基准</dt><dd>MD · m</dd></div><div><dt>资料版本</dt><dd>${well.version}</dd></div><div><dt>来源</dt><dd>${well.source}</dd></div></dl><button class="text-button property-link" data-action="evidence" data-evidence="target">查看来源记录 ${icon('arrow',14)}</button>`;
}
function heading(eyebrow,title,description,actions='') {return `<div class="page-heading"><div><div class="breadcrumb">工作台 <span>/</span> ${escape(eyebrow)}</div><h1>${escape(title)}</h1><p>${escape(description)}</p></div><div class="heading-actions">${actions}</div></div>`;}
function pageHtml(page) {
  if(page==='home') return homeHtml();
  if(page==='retrieval') return retrievalHtml();
  if(page==='reasoning') return reasoningHtml();
  if(page==='graph') return heading('图谱管理','知识关联与来源','围绕当前井查看五类知识对象及其关联依据。',`<button class="button primary" data-route="retrieval">${icon('search',15)}进入混合检索</button>`)+`<section class="panel graph-full"><div class="panel-heading"><h2>${icon('graph',18)}当前井知识关联</h2>${badge('示例图谱','neutral')}</div>${graphHtml()}${graphLegend()}</section>`+assetTable();
  if(page==='data') return heading('数据接入','数据资产目录','按井浏览地层、测井、井轨迹、模型与历史指令资料。',`<button class="button primary" data-action="import">${icon('upload',15)}导入资料</button>`)+assetTable()+moduleRoadmap('data');
  if(page==='operations') return heading('运行管理','运行记录','查看本次工作台中的规则判定记录及其输入快照。')+historyHtml()+moduleRoadmap(page);
  const definition=moduleDefinitions[page];
  if(!definition) return heading('页面不存在','未找到该页面','请通过顶部菜单返回工作台。',`<button class="button primary" data-route="home">返回首页</button>`);
  return heading(definition.name,definition.name,definition.description||'查看模块功能与相关业务入口。',`<a class="button" href="./docs/页面搭建步骤.html" target="_blank" rel="noopener">${icon('book',15)}查看页面开发说明</a>`)+`<div class="notice">${icon('info',16)}该模块已建立页面入口，下方列出后续开发内容；当前可操作范围为首页、资料目录、图谱示意与规则判定。</div>`+moduleRoadmap(page);
}
function homeHtml() {
  const assets=getAssets();const count=projectWells().length;
  return heading('首页','项目工作台','连接专业资料与知识证据，让每一次辅助分析都有据可查。',`<a class="button" href="./docs/页面搭建步骤.html" target="_blank" rel="noopener">${icon('book',15)}开发说明</a><button class="button primary" data-action="import">${icon('upload',15)}导入资料</button>`)+`
  <div class="workspace-tabs" role="tablist" aria-label="首页内容">${[['overview','数据总览'],['assets','资料目录'],['relations','知识关联'],['history','运行记录']].map(([id,name])=>`<button role="tab" aria-selected="${state.homeTab===id}" class="${state.homeTab===id?'active':''}" data-action="home-tab" data-tab="${id}">${name}</button>`).join('')}<button class="refresh-button" data-action="refresh">${icon('refresh',14)}刷新</button></div>
  ${state.homeTab==='assets'?assetTable():state.homeTab==='relations'?`<section class="panel graph-full"><div class="panel-heading"><h2>当前井知识关联</h2>${badge('五类对象','blue')}</div>${graphHtml()}${graphLegend()}</section>`:state.homeTab==='history'?historyHtml():`
  <div class="metric-grid">${[
    ['folder','资料资产',assets.length,'按井组织的专业资料','data','blue'],
    ['graph','知识实体',count*(objectTypes.length+1),'井与五类知识对象','graph','indigo'],
    ['rule','待校核事项',initialTasks.filter(t=>currentProject().wells.includes(t.wellId)).length,'候选知识与结果核查','construction','amber'],
    ['clock','已保存判定',state.runs.filter(r=>r.projectId===state.projectId).length,'本地规则运行记录','operations','teal'],
  ].map(([glyph,label,value,detail,page,tone])=>`<button class="metric-card" data-route="${page}"><span class="metric-icon ${tone}">${icon(glyph,21)}</span><span class="metric-copy"><span>${label}</span><strong>${value}<small>项</small></strong><small>${detail}</small></span>${icon('chevron',14)}</button>`).join('')}</div>
  <div class="home-columns"><section class="panel knowledge-panel"><div class="panel-heading"><h2>${icon('graph',18)}知识关联概览</h2><button class="text-button" data-route="graph">查看图谱 ${icon('arrow',14)}</button></div><div class="panel-subtitle">${currentWell().short} · ${currentWell().layer} <span>点击节点查看对象属性</span></div>${graphHtml()}${graphLegend()}</section><section class="panel tasks-panel"><div class="panel-heading"><h2>${icon('rule',18)}我的待办</h2><span class="count-label">${initialTasks.filter(t=>currentProject().wells.includes(t.wellId)).length} 项</span></div><div class="task-list">${taskList()}</div><div class="task-bottom">${icon('info',14)}校核意见与结果版本一并留存</div><div class="panel-heading recent-heading"><h2>${icon('clock',16)}最近规则判定</h2><button class="text-button" data-route="operations">全部记录</button></div>${state.runs.length?state.runs.filter(r=>r.projectId===state.projectId).slice(0,2).map(run=>`<button class="recent-run" data-action="run-detail" data-run="${escape(run.id)}"><span>${escape(run.result.title)}</span><small>${escape(run.time)}</small>${icon('chevron',13)}</button>`).join('')||'<div class="compact-empty">当前项目暂无判定记录</div>':`<div class="compact-empty">暂无运行记录<button class="text-button" data-route="retrieval">运行第一次规则判定 ${icon('arrow',13)}</button></div>`}</section></div>
  <section class="panel scenario-panel"><div class="panel-heading"><h2>${icon('layers',18)}典型场景</h2><span class="subtle">从检索结果发起分析，保留事实、规则与证据</span></div><div class="scenario-grid"><button class="scenario-card" data-action="scenario" data-scenario="neighbor"><span class="scenario-icon">${icon('well',24)}</span><span><strong>邻井推荐</strong><small>筛选候选井，查看匹配依据与差异</small></span>${icon('arrow',18)}</button><button class="scenario-card" data-action="scenario" data-scenario="strata"><span class="scenario-icon teal">${icon('layers',24)}</span><span><strong>地层对比</strong><small>比较已知层位，核查厚度差与证据</small></span>${icon('arrow',18)}</button></div></section>
  ${assetTable(4)}`}`;
}
function taskList() {return initialTasks.filter(t=>currentProject().wells.includes(t.wellId)).map(task=>`<button class="task-row" data-route="${task.route}"><span class="task-bullet ${task.tone}">${icon(task.route==='retrieval'?'rule':'file',17)}</span><span class="task-copy"><strong>${task.name}</strong><small>${wells.find(w=>w.id===task.wellId)?.short} · ${task.type}</small></span>${badge(task.state,task.tone)}</button>`).join('')||'<div class="compact-empty">当前项目暂无待办</div>';}
function graphHtml() {
  const w=currentWell();
  const nodes=[
    ['well',320,142,`井 ${w.short}`,'目标井','blue'],
    ['stratum',130,68,w.layer,'地层 / 层位','teal'],
    ['log',500,66,'GR / AC','测井资料','purple'],
    ['trajectory',116,220,'井段轨迹','井轨迹','blue'],
    ['model',504,221,'区块模型','地质模型','amber'],
    ['instruction',322,271,'历史指令','依据记录','slate'],
  ];
  return `<div class="graph-canvas"><svg class="knowledge-graph" viewBox="0 0 640 330" role="group" aria-label="${escape(w.short)}五类知识对象关联图"><defs><pattern id="graph-dot" width="18" height="18" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r=".8" fill="#e0e7f0"/></pattern></defs><rect width="640" height="330" fill="url(#graph-dot)"/>${nodes.slice(1).map(([id,x,y],i)=>{const labels=['钻遇','包含','关联','适用','依据'];return `<path class="graph-edge" d="M320 142L${x} ${y}"/><text class="edge-label" x="${(320+x)/2}" y="${(142+y)/2-8}" text-anchor="middle">${labels[i]}</text>`;}).join('')}${nodes.map(([id,x,y,title,subtitle,tone])=>`<g class="graph-node ${tone} ${state.selectedType===id?'selected':''}" data-action="select-node" data-well="${w.id}" data-type="${id}" role="button" tabindex="0" aria-label="查看${subtitle}属性" transform="translate(${x},${y})"><rect x="-65" y="-24" width="130" height="48" rx="8"/><circle cx="-48" cy="-3" r="4"/><text class="node-title" x="-35" y="1">${escape(title)}</text><text class="node-subtitle" x="0" y="39" text-anchor="middle">${subtitle}</text></g>`).join('')}</svg></div>`;
}
function graphLegend(){return `<div class="graph-legend"><span><i class="legend-dot blue"></i>井／轨迹</span><span><i class="legend-dot teal"></i>地层</span><span><i class="legend-dot purple"></i>测井</span><span><i class="legend-dot amber"></i>模型</span><span><i class="legend-dot slate"></i>历史指令</span><small>示例关系 · 可回查来源</small></div>`;}
function assetTable(limit) {
  const rows=getAssets().filter(a=>limit?true:a.wellId===state.wellId);const shown=limit?rows.slice(0,limit):rows;
  return `<section class="panel asset-panel"><div class="panel-heading"><h2>${icon('folder',17)}${limit?'最近资料':'当前井资料'}</h2>${limit?'<button class="text-button" data-route="data">全部资料 '+icon('arrow',14)+'</button>':badge(`${shown.length} 份`,'neutral')}</div><div class="table-scroll"><table><thead><tr><th>资料名称</th><th>类型</th><th>所属井</th><th>资料版本</th><th>状态</th><th class="align-right">操作</th></tr></thead><tbody>${shown.map(row=>`<tr><td><span class="file-name">${icon('file',15)}${escape(row.name)}</span></td><td>${escape(row.type)}</td><td>${wells.find(w=>w.id===row.wellId)?.short||'—'}</td><td class="mono">${escape(row.version)}</td><td>${badge(row.status,row.tone)}</td><td class="align-right"><button class="text-button" data-action="asset-detail" data-asset="${escape(row.id)}">查看</button></td></tr>`).join('')}</tbody></table></div></section>`;
}
function moduleRoadmap(page){const def=moduleDefinitions[page];return `<section class="panel roadmap"><div class="panel-heading"><h2>${def.code} · 页面功能清单</h2>${badge('后续开发范围','neutral')}</div><div class="feature-grid">${def.features.map((name,i)=>`<div><span>${String(i+1).padStart(2,'0')}</span><strong>${name}</strong><small>待接入业务功能</small></div>`).join('')}</div></section>`;}

function retrievalHtml() {
  const sample=demoCases.find(c=>c.id===state.sampleId);const target=currentWell();const ref=referenceWell();
  return heading('混合检索','检索与规则判定','查到哪些资料、为什么选这条规则、各项条件如何判断，在同一面板中逐项核查。',`<button class="button" data-route="reasoning">${icon('rule',15)}规则库与运行记录</button>`)+`
  <div class="notice demo-note">${icon('info',16)}当前使用演示资料与规则。厚度差阈值 ${escape(state.rule.threshold)} m 为演示值，正式规则需经专家确认。</div>
  <section class="panel analysis-context"><div class="panel-heading"><h2><span class="section-index">01</span>选择分析对象</h2>${badge('规则判定','blue')}</div><div class="analysis-fields"><label>目标井<select id="analysis-well">${projectWells().map(w=>`<option value="${w.id}" ${w.id===state.wellId?'selected':''}>${w.name}</option>`).join('')}</select></label><label>参考井<input value="${ref.name}" readonly></label><label>分析场景<select id="scenario-select"><option value="strata" ${state.scenario==='strata'?'selected':''}>地层对比</option><option value="neighbor" ${state.scenario==='neighbor'?'selected':''}>邻井推荐</option></select></label><label>井段 / 层位<input value="${target.layer} · ${target.depth}" readonly></label></div><div class="sample-controls"><label for="sample-select">演示样例</label><select id="sample-select">${demoCases.map(c=>`<option value="${c.id}" ${c.id===state.sampleId?'selected':''}>${c.name}</option>`).join('')}</select><button class="button primary" id="run-rule" data-action="run-rule">${icon('play',15)}运行规则判定</button><span class="subtle">T3：检索 → 规则关联 → 确定性判断</span></div></section>
  <div class="analysis-grid"><section class="panel retrieved-panel"><div class="panel-heading"><h2><span class="section-index">02</span>检索到的资料</h2>${badge('A07','neutral')}</div><div class="source-card"><div class="source-icon">${icon('file',19)}</div><div><strong>${target.short} 分层记录</strong><small>${target.layer} · ${target.depth} · MD / m</small><p>用于确认目标层位、厚度与来源。</p><button class="text-button" data-action="evidence" data-evidence="target">查看原始记录 ${icon('link',13)}</button></div></div><div class="source-card"><div class="source-icon teal">${icon('file',19)}</div><div><strong>${ref.short} 参考分层记录</strong><small>${ref.layer} · ${ref.depth} · MD / m</small><p>用于核对参考层位、厚度及对应关系。</p><button class="text-button" data-action="evidence" data-evidence="reference">查看原始记录 ${icon('link',13)}</button></div></div><div class="evidence-footnote">${icon('link',14)}井 → 井段 → 地层 → 分层记录；资料版本 ${target.version}</div></section>
  <section class="panel selected-rule"><div class="panel-heading"><h2><span class="section-index">03</span>系统选择的规则</h2>${badge('A08','neutral')}</div>${!sample.aligned||state.scenario!=='strata'||!state.rule.enabled?`<div class="rule-empty">${icon('info',24)}<strong>无适用规则</strong><p>${!state.rule.enabled?'演示规则已停用。':state.scenario!=='strata'?'当前厚度差规则仅适用于地层对比；邻井推荐规则待专家提供。':'尚未确认两井层位对应，本规则不适用。'}</p></div>`:`<div class="rule-detail"><div class="rule-name"><strong>${escape(state.rule.name)}</strong>${badge(sample.conflict?'存在冲突':'适用',sample.conflict?'amber':'teal')}</div><div class="rule-code mono">${state.rule.id} · ${escape(state.rule.version)}</div><p>${escape(state.rule.description)}</p><dl><div><dt>选用理由</dt><dd>已选择地层对比；演示样例标记层位已确认对应。</dd></div><div><dt>判定条件</dt><dd>两井厚度差绝对值 &gt; ${escape(state.rule.threshold)} m</dd></div><div><dt>规则来源</dt><dd>${escape(state.rule.source)}</dd></div></dl>${sample.conflict?'<div class="inline-warning">样例模拟同一工况存在相反规则结论，需人工处理。</div>':''}</div>`}</section></div>
  <section class="panel judgement-panel"><div class="panel-heading"><h2><span class="section-index">04</span>逐项判定与最终结论</h2>${badge('A09','neutral')}</div><div class="measurement-row"><label>目标井厚度 <span>m</span><input id="target-thickness" type="number" min="0" step="0.1" value="${sample.target??''}" placeholder="缺失"></label><label>参考井厚度 <span>m</span><input id="reference-thickness" type="number" min="0" step="0.1" value="${sample.reference??''}" placeholder="缺失"></label><div class="measurement-basis"><span>本次实测输入</span><strong id="measurement-origin">演示样例 · ${sample.sameBasis?'同一基准':'基准未统一'}</strong><small>输入值和来源会保存在运行快照中</small></div></div><div id="judgement-result">${state.activeResult?resultHtml(state.activeResult):'<div class="judgement-empty">'+icon('rule',28)+'<strong>等待运行规则判定</strong><p>上方查看资料和适用规则，点击“运行规则判定”后查看计算过程、结论与证据。</p></div>'}</div></section>
  <section class="panel joint-panel"><div><h2>${icon('graph',18)}图谱与大模型联合分析 <span class="badge neutral">A10 / T4</span></h2><p>在规则判定后，将事实、规则结果和引用作为分析输入。</p></div><button class="button" data-action="joint-analysis" ${!state.activeResult||state.formDirty?'disabled':''}>${icon('play',15)}生成联合分析</button></section>`;
}
function resultHtml(run) {
  const r=run.result;const tone=r.status==='triggered'||r.status==='conflict'?'amber':r.status==='not_triggered'?'teal':r.status==='error'?'red':'slate';
  return `<div class="result-summary ${tone}"><span class="result-icon">${icon(r.status==='not_triggered'?'check':r.status==='triggered'?'warning':'info',24)}</span><div><strong>${escape(r.title)}</strong><p>${escape(r.reason)}</p></div>${badge('演示判定',tone)}</div>${r.steps.length?`<div class="table-scroll"><table class="judgement-table"><thead><tr><th>判定项</th><th>实际值</th><th>规则条件</th><th>逐项结果</th></tr></thead><tbody>${r.steps.map(step=>`<tr><td>${step.name}</td><td>${escape(step.actual)}</td><td>${escape(step.condition)}</td><td>${badge(step.passed?'满足':'不满足',step.passed?'teal':'neutral')}</td></tr>`).join('')}</tbody></table></div>`:''}<div class="result-evidence"><span>${icon('link',14)}证据：${escape(run.measurementSource)} · 输入快照已留存</span><button class="text-button" data-action="run-evidence" data-run="${escape(run.id)}">查看本次依据</button></div><div class="run-meta"><span class="mono">${escape(run.id)}</span><span>${escape(run.time)} · ${escape(r.rule.version)}</span><button class="text-button" data-action="export-run" data-run="${escape(run.id)}">${icon('download',13)}导出记录</button></div>`;
}
function reasoningHtml() {
  return heading('规则与推理','规则库与判定记录','维护规则适用范围与版本，在检索结果页执行规则判定。',`<button class="button primary" data-route="retrieval">${icon('play',15)}打开规则判定面板</button>`)+`
  <section class="panel rule-library"><div class="panel-heading"><h2>${icon('rule',18)}专家规则库</h2>${badge('演示规则 · 待专家确认','amber')}</div><div class="rule-library-body"><div><h3>${escape(state.rule.name)}</h3><p>${escape(state.rule.description)}</p><dl class="rule-attributes"><div><dt>规则编号</dt><dd class="mono">${state.rule.id}</dd></div><div><dt>适用场景</dt><dd>地层对比 / 已确认同层位</dd></div><div><dt>版本</dt><dd>${escape(state.rule.version)}</dd></div><div><dt>来源</dt><dd>${escape(state.rule.source)}</dd></div></dl></div><form id="rule-form" class="rule-settings"><label for="rule-threshold">厚度差阈值（m）</label><input id="rule-threshold" type="number" min="0.000001" step="any" value="${escape(state.rule.threshold)}" required><label class="checkbox-label"><input id="rule-enabled" type="checkbox" ${state.rule.enabled?'checked':''}>启用演示规则</label><button class="button primary" type="submit">保存演示规则</button><small>修改生成新演示版本，历史运行保留原规则快照。</small></form></div></section>
  ${historyHtml()}
  <section class="panel typical-well"><div class="panel-heading"><h2>${icon('well',18)}典型井与整改回归</h2>${badge('页面入口','neutral')}</div><div class="typical-body"><p>案例运行、专家意见、问题登记、整改版本、原失败及受影响用例回归、人工确认关闭。</p><a class="text-button" href="./docs/页面搭建步骤.html#section-10" target="_blank" rel="noopener">查看子页面开发步骤 ${icon('arrow',14)}</a><span class="subtle">该子页面的业务操作待后续开发。</span></div></section>`;
}
function historyHtml() {
  const runs=state.runs.filter(r=>r.projectId===state.projectId);
  return `<section class="panel history-panel"><div class="panel-heading"><h2>${icon('clock',17)}规则判定运行记录</h2>${badge(`${runs.length} 条`,'neutral')}</div>${runs.length?`<div class="table-scroll"><table><thead><tr><th>运行编号</th><th>分析对象</th><th>判定结论</th><th>规则版本</th><th>时间</th><th>操作</th></tr></thead><tbody>${runs.map(run=>`<tr><td class="mono">${escape(run.id)}</td><td>${escape(run.wellName)}</td><td>${badge(run.result.status==='triggered'?'厚度差待复核':run.result.status==='not_triggered'?'未触发':run.result.status==='no_rule'?'无规则':run.result.status==='conflict'?'规则冲突':'资料不足',run.result.status==='not_triggered'?'teal':'amber')}</td><td>${escape(run.result.rule.version)}</td><td class="nowrap">${escape(run.time)}</td><td><button class="text-button" data-action="run-detail" data-run="${escape(run.id)}">详情</button></td></tr>`).join('')}</tbody></table></div>`:`<div class="empty-state">${icon('clock',30)}<h3>暂无规则判定记录</h3><p>在检索结果页运行判定后，可在这里回看输入、规则与证据。</p><button class="button" data-route="retrieval">打开规则判定面板</button></div>`}</section>`;
}
function evidenceModal(which) {
  const well=which==='reference'?referenceWell():currentWell();
  modal('资料来源 · 分层记录',`<div class="source-dialog-title">${icon('file',23)}<div><h3>${well.source}</h3><p>${badge('虚构演示资料','neutral')} ${well.version}</p></div></div><dl class="evidence-attributes"><div><dt>井号</dt><dd>${well.short}</dd></div><div><dt>层位</dt><dd>${well.layer}</dd></div><div><dt>井段</dt><dd>${well.depth}</dd></div><div><dt>厚度</dt><dd>${well.thickness} m</dd></div><div><dt>定位</dt><dd>演示分层表 · 第1行</dd></div><div><dt>基准</dt><dd>MD / m</dd></div></dl><div class="source-quote">“${well.short}，${well.layer}，井段 ${well.depth}，厚度 ${well.thickness} m。”</div><p class="subtle">规则面板的演示样例或手工厚度值可能与此原始样例不同；实际判定所用数值及来源请查看本次输入快照。</p>`);
}
function runRule() {
  const sample=demoCases.find(c=>c.id===state.sampleId);
  const input={scenario:state.scenario,aligned:sample.aligned,sameBasis:sample.sameBasis,conflict:sample.conflict,targetThickness:$('#target-thickness').value,referenceThickness:$('#reference-thickness').value,evidenceIds:[`${state.wellId}-stratum`,`${referenceWell().id}-stratum`],wellId:state.wellId,referenceWellId:referenceWell().id,dataVersion:currentWell().version};
  const result=evaluateThicknessRule(input,state.rule);
  const now=new Date();const id='RUN-'+now.getTime().toString(36).toUpperCase()+'-'+Math.random().toString(36).slice(2,5).toUpperCase();
  const run={id,time:now.toLocaleString('zh-CN',{hour12:false}),projectId:state.projectId,wellId:state.wellId,wellName:currentWell().short,referenceWellName:referenceWell().short,measurementSource:state.formDirty?'手工输入（演示）':`演示样例：${sample.name}`,result};
  state.activeResult=run;state.runs.unshift(run);state.runs=state.runs.slice(0,30);state.formDirty=false;persist();
  $('#judgement-result').innerHTML=resultHtml(run);$('.joint-panel button').disabled=false;toast('判定完成，运行输入、规则版本与结果已保存。');
}
function invalidateResult() {
  state.formDirty=true;state.activeResult=null;
  $('#judgement-result').innerHTML='<div class="notice">'+icon('info',16)+'输入已修改，请重新运行规则判定。历史结果保留在运行记录中。</div>';
  $('#measurement-origin').textContent='手工输入（演示）';$('.joint-panel button').disabled=true;
}

document.addEventListener('click',event=>{
  const routeButton=event.target.closest('[data-route]');
  if(routeButton){go(routeButton.dataset.route);return;}
  const control=event.target.closest('[data-action]');if(!control)return;
  const {action,well,type,run:runId}=control.dataset;
  if(action==='close-modal') {$('dialog')?.close();return;}
  if(action==='toggle-well'){state.expanded.has(well)?state.expanded.delete(well):state.expanded.add(well);$('#tree-list').innerHTML=treeHtml();return;}
  if(action==='expand-tree'){projectWells().forEach(w=>state.expanded.add(w.id));$('#tree-list').innerHTML=treeHtml();return;}
  if(action==='select-node'){const changed=state.wellId!==well;state.wellId=well;state.selectedType=type;state.expanded.add(well);if(changed)state.activeResult=null;persist();render();return;}
  if(action==='home-tab'){state.homeTab=control.dataset.tab;render();return;}
  if(action==='refresh'){state.updatedAt=new Date();render();toast('已刷新当前工作范围。');return;}
  if(action==='scenario'){go('retrieval',control.dataset.scenario);return;}
  if(action==='run-rule'){runRule();return;}
  if(action==='evidence'){evidenceModal(control.dataset.evidence);return;}
  if(action==='run-detail'||action==='run-evidence'){
    const run=state.runs.find(r=>r.id===runId)||state.activeResult;if(!run)return;
    modal(action==='run-evidence'?'本次判定依据与输入快照':'规则判定记录',`<p>${escape(run.wellName)} / ${escape(run.referenceWellName)} · ${escape(run.time)}</p>${resultHtml(run)}<details class="snapshot"><summary>查看完整输入与版本快照</summary><pre>${escape(JSON.stringify(run,null,2))}</pre></details>`,{wide:true});return;
  }
  if(action==='export-run'){const run=state.runs.find(r=>r.id===runId)||state.activeResult;if(run)downloadJson(run,run.id+'.json');return;}
  if(action==='joint-analysis'){
    if(!state.activeResult||state.formDirty){toast('请先完成有效的规则判定。');return;}
    modal('生成联合分析',`<div class="notice">${icon('info',18)}尚未配置大模型分析服务，本次没有生成联合分析结果。</div><p>当前已整理好可供分析使用的资料与证据包，可导出交由后续服务接入。</p><ul><li>场景：${state.scenario==='strata'?'地层对比':'邻井推荐'}</li><li>对象：${currentWell().short} / ${referenceWell().short}</li><li>规则：${escape(state.activeResult.result.rule.name)}（${escape(state.activeResult.result.rule.version)}）</li><li>判定：${escape(state.activeResult.result.title)}</li><li>内容：资料标识、实测输入、逐项判断、结论及来源快照</li></ul><button class="button primary" data-action="export-run" data-run="${state.activeResult.id}">${icon('download',15)}导出分析输入包</button>`);return;
  }
  if(action==='asset-detail'){
    const asset=getAssets().find(a=>a.id===control.dataset.asset);if(!asset)return;
    modal('资料详情',`<h3>${escape(asset.name)}</h3><dl class="evidence-attributes"><div><dt>类型</dt><dd>${escape(asset.type)}</dd></div><div><dt>来源</dt><dd>${escape(asset.source)}</dd></div><div><dt>版本</dt><dd>${escape(asset.version)}</dd></div><div><dt>状态</dt><dd>${escape(asset.status)}</dd></div></dl><p class="subtle">${asset.status==='待解析'?'已登记资料元信息，尚未解析或构建知识。':'该记录为首页布局与关联展示使用的示例资料。'}</p>`);return;
  }
  if(action==='import'){
    modal('导入资料 · 登记清单',`<form id="import-form"><p class="subtle">将文件登记到当前井的待处理清单。当前演示不保存原文件内容，也不执行解析。</p><label class="form-field">归属井<input value="${currentWell().name}" readonly></label><label class="form-field">选择文件<input id="import-file" type="file" accept=".pdf,.docx,.las,.csv,.xlsx,.json" required></label><label class="form-field">资料类型<select id="import-type">${objectTypes.map(t=>`<option value="${t.type}">${t.type}</option>`).join('')}</select></label><div class="modal-actions"><button type="button" class="button" data-action="close-modal">取消</button><button class="button primary" type="submit">登记资料</button></div></form>`);return;
  }
  if(action==='notifications'){modal('我的待办',`<div class="task-list">${taskList()}</div><p class="subtle">当前展示示例校核任务。</p>`);return;}
  if(action==='profile'){modal('个人信息',`<div class="profile-card"><span class="avatar large">演</span><h3>演示用户</h3><p>地质工程师</p>${badge('本地演示账号','blue')}</div><dl class="evidence-attributes"><div><dt>工作范围</dt><dd>${currentProject().name}</dd></div><div><dt>角色</dt><dd>资料浏览、结果分析与校核演示</dd></div></dl><p class="subtle">正式账号、登录和权限校验将在用户模块接入。</p>`);return;}
  if(action==='help') modal('工作台使用说明','<ol><li>从左侧数据树选择井或知识对象，下方查看属性。</li><li>在首页查看资料、知识关联和待办，顶部菜单切换模块。</li><li>进入混合检索，选择演示样例并运行规则判定。</li><li>结果包含资料、规则、计算过程和引用，可保存与导出。</li><li>“规则与推理”中维护演示阈值并回看历史结果。</li></ol><p class="subtle">本版本为首页与规则判定交互原型；数据均为演示样例。</p>');
});
document.addEventListener('change',event=>{
  if(event.target.id==='project-select'){state.projectId=event.target.value;state.wellId=currentProject().wells[0];state.selectedType='well';state.expanded=new Set([state.wellId]);state.activeResult=null;state.treeFilter='';persist();render();}
  if(event.target.id==='analysis-well'){state.wellId=event.target.value;state.selectedType='well';state.expanded.add(state.wellId);state.activeResult=null;persist();render();}
  if(event.target.id==='sample-select'){state.sampleId=event.target.value;state.formDirty=false;state.activeResult=null;render();}
  if(event.target.id==='scenario-select'){state.scenario=event.target.value;state.activeResult=null;render();}
});
document.addEventListener('input',event=>{
  if(event.target.id==='tree-search'){state.treeFilter=event.target.value;$('#tree-list').innerHTML=treeHtml();}
  if(['target-thickness','reference-thickness'].includes(event.target.id))invalidateResult();
});
document.addEventListener('submit',event=>{
  if(event.target.id==='rule-form'){
    event.preventDefault();const threshold=Number($('#rule-threshold').value);if(!Number.isFinite(threshold)||threshold<=0){toast('请输入大于零的阈值。');return;}
    state.rule={...state.rule,threshold,enabled:$('#rule-enabled').checked,version:'demo-'+Date.now().toString(36)};state.activeResult=null;persist();render();toast('演示规则已保存，历史运行版本保持不变。');
  }
  if(event.target.id==='import-form'){
    event.preventDefault();const file=$('#import-file').files[0];if(!file)return;
    state.imported.unshift({id:'import-'+Date.now(),wellId:state.wellId,name:file.name,type:$('#import-type').value,source:'本地文件清单登记',version:'待解析',status:'待解析',tone:'amber'});persist();$('dialog').close();render();toast('已加入当前井的待处理资料清单。');
  }
});
document.addEventListener('keydown',event=>{if((event.key==='Enter'||event.key===' ')&&event.target.matches('.graph-node')){event.preventDefault();event.target.dispatchEvent(new MouseEvent('click',{bubbles:true}));}});
window.addEventListener('hashchange',()=>{$('dialog')?.close();render();});
render();
