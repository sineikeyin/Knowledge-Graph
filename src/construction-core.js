import {ontoCheckRecord} from './ontology-core.js';

export const kcStages=[['parse','解析'],['sentence','分句 / 记录切分'],['ner','实体识别'],['relation','关系抽取'],['normalize','术语归一'],['quality','Schema 质检'],['store','候选入库']];
export const kcEngine='structured-geoscience-v1';
const kcGenericTaskNames=new Set(['地质资料知识抽取','知识抽取任务','抽取任务','知识更新任务','增量事件重试']);
export function kcDefaultTaskName(sources,purpose='抽取'){
  const wells=[...new Set(sources.map(s=>s.wellCode||s.rows?.[0]?.well||s.wellId).filter(Boolean))];
  const types=[...new Set(sources.map(s=>({stratum:'地层',log:'测井',trajectory:'轨迹',model:'模型',instruction:'历史指令'}[s.objectType]||'资料')))];
  const scope=wells.length>2?`${wells.slice(0,2).join('、')}等${wells.length}口井`:wells.join('、');
  return `${scope||'所选资料'} · ${types.join('、')||'资料'}知识${purpose}`.slice(0,100);
}
export function kcTaskDisplayName(task){return !task.name||kcGenericTaskNames.has(task.name)?kcDefaultTaskName(task.sources||[]):task.name;}
export const kcStable=value=>JSON.stringify(value&&typeof value==='object'?Array.isArray(value)?value.map(v=>JSON.parse(kcStable(v))):Object.fromEntries(Object.keys(value).sort().map(k=>[k,JSON.parse(kcStable(value[k]))])):value??null);
export const kcName=(type,v)=>type==='well'?v.code:type==='stratum'?v.layer:type==='lithology'?v.name:type==='interval'?`${v.well} ${v.top}–${v.bottom}`:type==='log'?`${v.curve} @ ${v.depth}`:type==='trajectory'?`${v.well} @ ${v.depth}`:v.name||v.command||type;
export function kcEvidence(source,rowIndex,field=''){
  const parsed=source.parsed,cells=parsed.rows[rowIndex]||[],row=source.rows[rowIndex];
  const raw=parsed.headers.map((name,i)=>`${name}: ${cells[i]??''}`).join(' | '),needle=String(row?.[field]??'');
  // Normalized aliases may differ from the source. Highlight the source cell instead.
  const column=source.config?.fields?.[field],rawValue=column?String(cells[parsed.headers.indexOf(column)]??''):needle;
  const start=rawValue?raw.indexOf(rawValue):-1;
  return {assetId:source.assetId,versionId:source.versionId,originalVersionId:source.originalVersionId,processingReason:source.reason,fileName:source.fileName,format:parsed.format,row:rowIndex+1,line:parsed.locations[rowIndex],field,column:column||field,raw,span:start>=0?{start,end:start+rawValue.length}:null,well:row?.well||'',layer:row?.layer||'',unit:row?.unit||'',depthType:row?.depthType||'',datum:row?.datum||''};
}
export function kcEntities(task){
  const result=[],types=task.schema.types;
  function add(source,index,typeId,value,field,confidence){
    const type=types.find(t=>t.id===typeId);if(!type)return;
    const filtered=Object.fromEntries(type.fields.filter(f=>value[f.key]!==undefined&&value[f.key]!=='').map(f=>[f.key,value[f.key]]));
    const key=`${source.versionId}:${index}:${typeId}`;
    result.push({id:`${task.id}:E:${result.length+1}`,key,kind:'entity',typeId,typeName:type.name,name:String(kcName(typeId,filtered)),value:filtered,confidence,evidence:kcEvidence(source,index,field),state:'pending',revision:1,history:[],errors:[]});
  }
  for(const source of task.sources)for(let index=0;index<source.rows.length;index++){
    const originalRow=source.rows[index],row={...originalRow,well:source.wellCode||originalRow.well};
    if(row.well)add(source,index,'well',{code:row.well,name:row.well,block:row.block},'well',0.98);
    if(source.objectType==='stratum'){
      add(source,index,'interval',row,'top',0.96);add(source,index,'stratum',row,'layer',0.95);
      if(row.lithology)add(source,index,'lithology',{name:row.lithology},'lithology',0.86);
    }else if(['log','trajectory','model','instruction'].includes(source.objectType))add(source,index,source.objectType,row,source.objectType==='log'?'curve':'depth',0.94);
  }
  return result;
}
export function kcRelations(task){
  const result=[],groups=new Map();
  for(const e of task.candidates.filter(c=>c.kind==='entity')){const key=`${e.evidence.versionId}:${e.evidence.row}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(e);}
  // Only relations explicitly allowed by the pinned ontology and backed by the same record.
  const supported=new Set(['belongs','intersects','has_lithology','issued_for','applies']);
  for(const group of groups.values())for(const type of task.schema.relations.filter(r=>supported.has(r.id))){
    const subject=group.find(e=>e.typeId===type.from),object=group.find(e=>e.typeId===type.to);if(!subject||!object)continue;
    result.push({id:`${task.id}:R:${result.length+1}`,kind:'relation',typeId:type.id,typeName:type.name,name:`${subject.name} — ${type.name} — ${object.name}`,value:{subjectId:subject.id,objectId:object.id},confidence:0.9,evidence:{...subject.evidence,field:`${type.from}/${type.to}`},state:'pending',revision:1,history:[],errors:[]});
  }
  return result;
}
export function kcNormalize(task){
  for(const c of task.candidates.filter(c=>c.kind==='entity')){
    const before=JSON.parse(JSON.stringify(c.value));
    for(const key of Object.keys(c.value))if(typeof c.value[key]==='string')c.value[key]=c.value[key].trim();
    for(const term of task.schema.terms.filter(t=>t.typeId===c.typeId))for(const key of ['name','lithology','curve'])if([term.standard,...term.aliases].some(alias=>String(alias).toLowerCase()===String(c.value[key]??'').toLowerCase()))c.value[key]=term.standard;
    c.normalization={before,after:JSON.parse(JSON.stringify(c.value)),schemaVersionId:task.ontologyVersionId};c.name=String(kcName(c.typeId,c.value));
  }
}
export function kcCheck(task,candidate){
  if(candidate.kind==='entity'){const type=task.schema.types.find(t=>t.id===candidate.typeId);return type?ontoCheckRecord(type,candidate.value):['本体中没有此实体类型'];}
  const relation=task.schema.relations.find(r=>r.id===candidate.typeId),subject=task.candidates.find(c=>c.id===candidate.value.subjectId&&c.kind==='entity'),object=task.candidates.find(c=>c.id===candidate.value.objectId&&c.kind==='entity');
  const errors=[];if(!relation||!subject||!object||relation.from!==subject.typeId||relation.to!==object.typeId)errors.push('关系类型或端点不符合本体约束');
  if(subject?.state==='rejected'||object?.state==='rejected')errors.push('关系端点已驳回');return errors;
}
export function kcMetric(expected,actual){
  const signature=item=>kcStable({kind:item.kind,typeId:item.typeId,value:item.value});
  const pool=actual.map((value,index)=>({value,index,used:false})),details=[];let tp=0,fn=0,fp=0;
  for(const item of expected){const hit=pool.find(p=>!p.used&&signature(p.value)===signature(item));if(hit){hit.used=true;tp++;details.push({error:'正确',expected:item,actual:hit.value});}else{fn++;details.push({error:'漏抽 / 属性不一致',expected:item,actual:null});}}
  for(const item of pool.filter(p=>!p.used)){fp++;details.push({error:'多抽 / 属性不一致',expected:null,actual:item.value});}
  const precision=tp+fp?tp/(tp+fp):0,recall=tp+fn?tp/(tp+fn):0;
  // Extraction has no finite TN universe. Accuracy is explicitly the set Jaccard accuracy.
  return {tp,fp,fn,accuracy:tp+fp+fn?tp/(tp+fp+fn):0,precision,recall,f1:precision+recall?2*precision*recall/(precision+recall):0,definition:'严格属性匹配、多重集计数；准确率 = TP/(TP+FP+FN)，不含真负例',details};
}
export function kcEvaluationItems(task){
  const entities=task.extractionSnapshot||task.candidates;
  return entities.map(c=>({kind:c.kind,typeId:c.typeId,value:c.kind==='entity'?c.value:{subject:entities.find(e=>e.id===c.value.subjectId)?.value,object:entities.find(e=>e.id===c.value.objectId)?.value}}));
}
