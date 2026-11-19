// Pure, bounded graph calculations shared by HTTP and the offline preview.
export const gmTypes={well:'井',interval:'井段',stratum:'地层',log:'测井',trajectory:'井轨迹',model:'地质模型',instruction:'历史导向指令',lithology:'岩性',fault:'断层'};
export const gmAlgorithms={components:'连通分量',centrality:'度中心度',community:'社区发现（标签传播）',similarity:'节点相似度（Jaccard）'};
export const gmLimits={nodes:3000,edges:12000,visits:30000,paths:20};
export function gmAssert(ok,message){if(!ok){const error=new Error(message);error.status=400;throw error;}}
export function gmNumber(value,label,min,max){gmAssert(['number','string'].includes(typeof value)&&String(value).trim()!==''&&Number.isFinite(Number(value))&&Number(value)>=min&&Number(value)<=max,`${label}须在 ${min}～${max} 之间。`);return Number(value);}
export function gmAdjacency(nodes,edges,{directed=false,relation='all'}={}){
  gmAssert(nodes.length<=gmLimits.nodes&&edges.length<=gmLimits.edges,'图规模超出本机计算上限，请缩小范围。');
  const map=new Map(nodes.map(n=>[n.id,[]]));
  for(const edge of edges){if(relation!=='all'&&edge.typeId!==relation||!map.has(edge.subjectId)||!map.has(edge.objectId))continue;map.get(edge.subjectId).push({id:edge.objectId,edge:edge.id});if(!directed&&edge.objectId!==edge.subjectId)map.get(edge.objectId).push({id:edge.subjectId,edge:edge.id});}
  return map;
}
export function gmPaths(nodes,edges,input){
  const maxHops=gmNumber(input.maxHops??3,'最大跳数',3,6);gmAssert(Number.isInteger(maxHops),'跳数必须是整数。');
  const map=gmAdjacency(nodes,edges,input);gmAssert(map.has(input.start)&&map.has(input.end),'起点或终点不存在或不可访问。');gmAssert(input.start!==input.end,'请选择不同起终点。');
  const queue=[{nodes:[input.start],edges:[]}],paths=[];let cursor=0,visits=0,truncated=false;
  while(cursor<queue.length){const path=queue[cursor++];if(path.edges.length>=maxHops)continue;
    for(const next of map.get(path.nodes.at(-1))){if(++visits>gmLimits.visits){truncated=true;break;}if(path.nodes.includes(next.id))continue;
      const value={nodes:[...path.nodes,next.id],edges:[...path.edges,next.edge]};
      if(next.id===input.end){paths.push(value);if(paths.length>=gmLimits.paths){truncated=true;break;}}
      else if(value.edges.length<maxHops)queue.push(value);
    }if(truncated)break;
  }
  return {paths,visited:visits,truncated,maxHops,directed:input.directed===true,scope:'1 至最大跳数的简单路径，按跳数优先；结果有界'};
}
export function gmAlgorithm(nodes,edges,input){
  gmAssert(Object.hasOwn(gmAlgorithms,input.algorithm),'请选择支持的图算法。');
  const map=gmAdjacency(nodes,edges,{...input,directed:false}),neighbors=new Map([...map].map(([id,list])=>[id,new Set(list.map(x=>x.id).filter(x=>x!==id))]));
  if(input.algorithm==='centrality')return {rows:nodes.map(n=>({id:n.id,degree:neighbors.get(n.id).size,score:nodes.length>1?neighbors.get(n.id).size/(nodes.length-1):0})).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id)),method:'无向去重度 / (节点数 − 1)'};
  if(input.algorithm==='similarity'){
    gmAssert(map.has(input.nodeId),'请选择可访问的目标节点。');const a=neighbors.get(input.nodeId);
    return {rows:nodes.filter(n=>n.id!==input.nodeId).map(n=>{const b=neighbors.get(n.id),intersection=[...a].filter(id=>b.has(id)),union=new Set([...a,...b]);return {id:n.id,score:union.size?intersection.length/union.size:0,shared:intersection};}).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id)),method:'邻接节点集合交集 / 并集；空并集为 0'};
  }
  if(input.algorithm==='components'){
    const seen=new Set(),groups=[];
    for(const node of nodes){if(seen.has(node.id))continue;const group=[node.id];seen.add(node.id);for(let i=0;i<group.length;i++)for(const next of neighbors.get(group[i]))if(!seen.has(next)){seen.add(next);group.push(next);}groups.push(group);}
    return {groups,rows:groups.map((ids,i)=>({group:i+1,count:ids.length,nodes:ids})),method:'无向图广度优先连通分量，包含孤立点'};
  }
  const iterations=gmNumber(input.iterations??20,'迭代次数',1,50);gmAssert(Number.isInteger(iterations),'迭代次数必须是整数。');
  const sorted=nodes.map(n=>n.id).sort(),labels=new Map(sorted.map(id=>[id,id]));let used=0;
  // Deterministic asynchronous label propagation; ties prefer the existing label.
  for(;used<iterations;used++){let changed=false;for(const id of sorted){const counts=new Map();for(const next of neighbors.get(id)){const label=labels.get(next);counts.set(label,(counts.get(label)||0)+1);}if(!counts.size)continue;
      const maximum=Math.max(...counts.values()),tied=[...counts].filter(([,n])=>n===maximum).map(([key])=>key).sort(),label=tied.includes(labels.get(id))?labels.get(id):tied[0];if(label!==labels.get(id)){labels.set(id,label);changed=true;}}
    if(!changed){used++;break;}
  }
  const groups=new Map();for(const [id,label]of labels){if(!groups.has(label))groups.set(label,[]);groups.get(label).push(id);}
  return {rows:[...groups].map(([label,ids],i)=>({group:i+1,label,count:ids.length,nodes:ids})),iterations:used,method:'确定性异步标签传播，保留并列原标签；用于结构探索'};
}
export function gmCoordinate(input){
  gmAssert(input&&['local','EPSG:4326'].includes(input.crs),'坐标系需为 local 或 EPSG:4326。');
  const x=gmNumber(input.x,'X / 经度',input.crs==='EPSG:4326'?-180:-1e8,input.crs==='EPSG:4326'?180:1e8),y=gmNumber(input.y,'Y / 纬度',input.crs==='EPSG:4326'?-90:-1e8,input.crs==='EPSG:4326'?90:1e8);
  const frame=String(input.frame||'').trim();gmAssert(frame.length>0&&frame.length<=80,'请明确坐标基准 / 局部坐标框架（最多 80 字）。');return {x,y,crs:input.crs,frame};
}
export function gmDistance(a,b){
  gmAssert(a.crs===b.crs&&a.frame===b.frame,'坐标系或坐标基准不一致，不能直接计算距离。');
  if(a.crs==='local')return Math.hypot(a.x-b.x,a.y-b.y);
  const rad=v=>v*Math.PI/180,dlat=rad(b.y-a.y),dlon=rad(b.x-a.x),h=Math.sin(dlat/2)**2+Math.cos(rad(a.y))*Math.cos(rad(b.y))*Math.sin(dlon/2)**2;
  return 6371008.8*2*Math.asin(Math.sqrt(Math.min(1,Math.max(0,h))));
}
export function gmSpatial(records,input){
  const target=records.find(r=>r.id===input.targetId);gmAssert(target,'请选择带坐标的目标井 / 轨迹点。');gmAssert(target.kind!=='fault','目标须为井或轨迹点。');
  const radius=gmNumber(input.radius??5000,'空间半径（m）',0,1e7),excluded=[],bounds=input.bounds;
  if(bounds){for(const key of ['minX','maxX','minY','maxY'])gmNumber(bounds[key],key,-1e8,1e8);gmAssert(Number(bounds.minX)<=Number(bounds.maxX)&&Number(bounds.minY)<=Number(bounds.maxY),'空间范围上下限无效。');}
  const compatible=records.filter(row=>{if(row.crs!==target.crs||row.frame!==target.frame){excluded.push({id:row.id,reason:'坐标基准不一致'});return false;}return true;});
  let candidates=compatible,index={kind:'经纬度候选扫描',recordCount:compatible.length};
  if(target.crs==='local'){
    // Build a query-local uniform grid. Fault polylines use bounding-box candidates.
    const cellSize=Math.max(radius,1),grid=new Map(),faults=[];
    for(const row of compatible){if(row.kind==='fault'){const points=row.points||[];if(points.length&&Math.max(...points.map(p=>p.x))>=target.x-radius&&Math.min(...points.map(p=>p.x))<=target.x+radius&&Math.max(...points.map(p=>p.y))>=target.y-radius&&Math.min(...points.map(p=>p.y))<=target.y+radius)faults.push(row);continue;}const key=`${Math.floor(row.x/cellSize)},${Math.floor(row.y/cellSize)}`,bucket=grid.get(key)||[];bucket.push(row);grid.set(key,bucket);}
    const x=Math.floor(target.x/cellSize),y=Math.floor(target.y/cellSize);candidates=[...faults];for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)candidates.push(...(grid.get(`${x+dx},${y+dy}`)||[]));
    index={kind:'查询时构建米制均匀网格 + 断层包围盒',cellSize,occupiedCells:grid.size,recordCount:compatible.length,candidateCount:candidates.length};
  }
  const rows=[];
  for(const row of candidates){if(row.id===target.id)continue;
    if(row.kind==='fault'&&row.crs!=='local'){excluded.push({id:row.id,reason:'地理坐标断层线需先投影至统一米制坐标'});continue;}
    if(bounds){const xs=[row.x,...(row.points||[]).map(p=>p.x)],ys=[row.y,...(row.points||[]).map(p=>p.y)];if(Math.max(...xs)<bounds.minX||Math.min(...xs)>bounds.maxX||Math.max(...ys)<bounds.minY||Math.min(...ys)>bounds.maxY)continue;}
    let distance;
    if(row.kind==='fault'){
      const points=row.points||[{x:row.x,y:row.y}];distance=Infinity;
      for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],dx=b.x-a.x,dy=b.y-a.y,t=dx||dy?Math.max(0,Math.min(1,((target.x-a.x)*dx+(target.y-a.y)*dy)/(dx*dx+dy*dy))):0;distance=Math.min(distance,Math.hypot(target.x-a.x-t*dx,target.y-a.y-t*dy));}
    }else distance=gmDistance(target,row);
    if(distance<=radius)rows.push({...row,distance,relation:row.kind==='fault'?'至断层线的最短水平距离':row.wellId===target.wellId?'同井轨迹 / 井口':'邻井 / 轨迹点'});
  }
  return {target,rows:rows.sort((a,b)=>a.distance-b.distance),excluded,radius,unit:'m',index,method:target.crs==='local'?'同一米制平面框架；点距或点到折线距离':'WGS84 球面近似水平距离；不含高程'};
}
export function gmSimilar(nodes,wellId,weights={layer:0.4,curve:0.35,engineering:0.25}){
  gmAssert(weights&&typeof weights==='object'&&!Array.isArray(weights)&&Object.keys(weights).every(k=>['layer','curve','engineering'].includes(k)),'匹配因素权重无效。');
  for(const key of ['layer','curve','engineering'])gmNumber(weights[key],`${key}权重`,0,1);gmAssert(Object.values(weights).reduce((a,b)=>a+Number(b),0)>0,'至少启用一个匹配因素。');
  const wells=[...new Set(nodes.map(n=>n.wellId))],target=nodes.filter(n=>n.wellId===wellId);gmAssert(target.length,'目标井没有可访问的知识实体。');
  const factors=(a,b)=>{
    const layer=x=>new Set(x.filter(n=>n.typeId==='stratum').map(n=>n.value.layer).filter(Boolean));
    const aa=layer(a),bb=layer(b),union=new Set([...aa,...bb]),layerScore=aa.size&&bb.size?[...aa].filter(x=>bb.has(x)).length/union.size:null;
    // Compare curve means only when curve name, unit and depth basis agree.
    const curves=x=>{const out=new Map();for(const n of x.filter(n=>n.typeId==='log')){const v=n.value,e=n.evidence||{};if(!v.curve||!v.valueUnit||!e.depthType||!e.datum||!Number.isFinite(v.value))continue;const key=[v.curve,v.valueUnit,e.depthType,e.datum].join('|');const r=out.get(key)||[];r.push(v.value);out.set(key,r);}return out;};
    const ca=curves(a),cb=curves(b),means=r=>r.reduce((n,v)=>n+v,0)/r.length,matched=[...ca.keys()].filter(k=>cb.has(k)),curveValues=matched.map(k=>{const x=means(ca.get(k)),y=means(cb.get(k));return 1-Math.min(1,Math.abs(x-y)/Math.max(Math.abs(x),Math.abs(y),1));});
    const engineering=x=>x.filter(n=>n.typeId==='trajectory').map(n=>n.value.inclination).filter(Number.isFinite),ea=engineering(a),eb=engineering(b);
    return [{key:'layer',label:'层位集合',score:layerScore,detail:`${[...aa].join('、')||'缺失'} / ${[...bb].join('、')||'缺失'}`},{key:'curve',label:'同名同单位曲线均值',score:curveValues.length?means(curveValues):null,detail:matched.length?matched.map(k=>`${k}：${means(ca.get(k)).toFixed(3)} / ${means(cb.get(k)).toFixed(3)}`).join('；'):'缺少同基准曲线，未参与评分'},{key:'engineering',label:'轨迹井斜均值',score:ea.length&&eb.length?1-Math.min(1,Math.abs(means(ea)-means(eb))/180):null,detail:ea.length&&eb.length?`${means(ea).toFixed(2)}° / ${means(eb).toFixed(2)}°`:'缺少轨迹井斜，未参与评分'}];
  };
  return wells.filter(id=>id!==wellId).map(id=>{const candidate=nodes.filter(n=>n.wellId===id),list=factors(target,candidate),usable=list.filter(f=>f.score!==null&&Number(weights[f.key])>0),total=usable.reduce((n,f)=>n+Number(weights[f.key]),0);return {wellId:id,score:total?usable.reduce((n,f)=>n+f.score*Number(weights[f.key]),0)/total:null,coverage:usable.length/3,factors:list,evidenceIds:candidate.map(n=>n.id)};}).sort((a,b)=>(b.score??-1)-(a.score??-1)||a.wellId.localeCompare(b.wellId));
}
export function gmDiff(before,after){
  const stable=v=>JSON.stringify(v&&typeof v==='object'?Array.isArray(v)?v.map(x=>JSON.parse(stable(x))):Object.fromEntries(Object.keys(v).sort().map(k=>[k,JSON.parse(stable(v[k]))])):v??null);
  const key=f=>`${f.assetId}|${f.kind}|${f.typeId}|${f.evidence?.row??''}`;
  const a=new Map(before.map(f=>[key(f),f])),b=new Map(after.map(f=>[key(f),f])),rows=[];
  for(const [id,f]of b){const old=a.get(id);if(!old)rows.push({change:'added',before:null,after:f});else if(stable({value:old.value,evidence:old.evidence})!==stable({value:f.value,evidence:f.evidence}))rows.push({change:'changed',before:old,after:f});}
  for(const [id,f]of a)if(!b.has(id))rows.push({change:'removed',before:f,after:null});return rows;
}
