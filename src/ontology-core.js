// Schema definitions and deterministic checks shared by the server and offline preview.
export const ontoDataTypes=['string','number','integer','boolean','datetime'];
export const ontoTransforms=['identity','trim','number','datetime'];
export const ontoField=(key,name,datatype='string',required=false,extra={})=>({key,name,datatype,required,unit:'',...extra});
export function ontoTemplate(id='geosteering'){
  const depth=()=>[ontoField('top','起始井深','number',true,{unit:'m',min:0}),ontoField('bottom','终止井深','number',true,{unit:'m',min:0}),ontoField('datum','参考基准','string',true,{enum:['KB','MSL','GL']}),ontoField('depthType','深度类型','string',true,{enum:['MD','TVD']})];
  const types=[
    {id:'well',name:'井',description:'具有唯一井号的井对象',fields:[ontoField('code','井号','string',true),ontoField('name','井名称'),ontoField('block','所属区块')],constraints:[]},
    {id:'interval',name:'井段',description:'按明确井深及基准界定的井段',fields:[ontoField('well','井号','string',true),...depth()],constraints:[{lower:'top',upper:'bottom'}]},
    {id:'stratum',name:'地层',description:'地层分层记录；层位与岩性分别维护',fields:[ontoField('well','井名','string',true),ontoField('layer','层位','string',true),...depth(),ontoField('thickness','厚度','number',false,{unit:'m',min:0}),ontoField('lithology','岩性')],constraints:[{lower:'top',upper:'bottom'}]},
    {id:'log',name:'测井记录',description:'曲线测量值及其深度',fields:[ontoField('well','井名','string',true),ontoField('depth','井深','number',true,{unit:'m',min:0}),ontoField('curve','曲线名','string',true),ontoField('value','曲线值','number',true),ontoField('valueUnit','曲线单位','string',true)],constraints:[]},
    {id:'trajectory',name:'井轨迹点',description:'具有井深、井斜及方位的轨迹记录',fields:[ontoField('well','井号','string',true),ontoField('depth','井深','number',true,{unit:'m',min:0}),ontoField('inclination','井斜角','number',true,{unit:'°',min:0,max:180}),ontoField('azimuth','方位角','number',true,{unit:'°',min:0,max:360})],constraints:[]},
    {id:'model',name:'地质模型',description:'带版本及适用区块的地质模型',fields:[ontoField('name','模型名称','string',true),ontoField('version','模型版本','string',true),ontoField('block','适用区块','string',true),ontoField('source','资料来源')],constraints:[]},
    {id:'instruction',name:'历史导向指令',description:'导向指令、目标井段及依据',fields:[ontoField('well','井号','string',true),ontoField('interval','目标井段','string',true),ontoField('time','指令时间','datetime',true),ontoField('command','指令内容','string',true),ontoField('basis','依据','string',true)],constraints:[]},
    {id:'lithology',name:'岩性',description:'岩石类型术语，与地层层位区分',fields:[ontoField('name','岩性名称','string',true)],constraints:[]},
  ].map((type,i)=>({...type,x:70+(i%3)*235,y:65+Math.floor(i/3)*135}));
  const relations=[['belongs','隶属于','interval','well','many:one'],['intersects','钻遇','interval','stratum','many:many'],['has_lithology','具有岩性','stratum','lithology','many:many'],['measures','记录于','log','interval','many:one'],['traces','描述','trajectory','interval','many:one'],['applies','适用于','model','well','many:many'],['targets','指向','instruction','interval','many:one'],['issued_for','所属井','instruction','well','many:one']].map(([id,name,from,to,cardinality])=>({id,name,from,to,cardinality}));
  const schema={types,relations,terms:[{id:'term_gr',standard:'自然伽马',aliases:['GR'],typeId:'log',language:'zh-CN',scope:'测井曲线'},{id:'term_sand',standard:'砂岩',aliases:['sandstone'],typeId:'lithology',language:'zh-CN',scope:'岩性'}],mappings:[{id:'map_strata',name:'标准分层字段映射',sourceType:'stratum',typeId:'stratum',fields:[['well','well','trim'],['layer','layer','trim'],['top','top','number'],['bottom','bottom','number'],['datum','datum','trim'],['depthType','depthType','trim'],['thickness','thickness','number'],['lithology','lithology','trim']].map(([source,target,transform])=>({source,target,transform}))}],actions:[{id:'register_instruction',name:'登记历史导向指令',typeId:'instruction',description:'登记并检查历史样本，不下发现场控制命令',inputs:['well','interval','time','command','basis'],links:[{field:'well',typeId:'well'},{field:'interval',typeId:'interval'}]}]};
  if(id==='strata'){const ids=['well','interval','stratum','lithology'];schema.types=types.filter(t=>ids.includes(t.id));schema.relations=relations.filter(r=>ids.includes(r.from)&&ids.includes(r.to));schema.terms=schema.terms.filter(t=>ids.includes(t.typeId));schema.actions=[];}
  return schema;
}
export const ontoTemplates=[{id:'geosteering',name:'地质导向完整模板',description:'井、井段、地层、测井、轨迹、模型、历史指令与岩性。'},{id:'strata',name:'分层对比基础模板',description:'井、井段、地层与岩性，适合先建立分层知识结构。'}];
export function ontoShape(input){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Schema 必须是对象。');
  const output={};for(const [key,max]of Object.entries({types:80,relations:160,terms:300,mappings:60,actions:60})){if(!Array.isArray(input[key])||input[key].length>max)throw new Error(`${key} 必须为数组，最多 ${max} 项。`);output[key]=JSON.parse(JSON.stringify(input[key]));}
  if(JSON.stringify(output).length>180000)throw new Error('Schema 内容过大。');
  const isObject=v=>v&&typeof v==='object'&&!Array.isArray(v);
  for(const list of Object.values(output))if(list.some(item=>!isObject(item)))throw new Error('Schema 条目必须为对象。');
  for(const type of output.types){if(!Array.isArray(type.fields)||type.fields.length>60||!Array.isArray(type.constraints)||type.constraints.length>60)throw new Error('每种类型最多 60 个字段和约束。');}
  for(const type of output.types)if(type.fields.some(f=>!isObject(f))||type.constraints.some(c=>!isObject(c)))throw new Error('字段与约束必须为对象。');
  for(const mapping of output.mappings)if(!Array.isArray(mapping.fields)||mapping.fields.length>100)throw new Error('映射字段最多 100 项。');
  for(const mapping of output.mappings)if(mapping.fields.some(f=>!isObject(f)))throw new Error('映射字段必须为对象。');
  for(const action of output.actions)if(!Array.isArray(action.inputs)||!Array.isArray(action.links)||action.inputs.length>60||action.links.length>60)throw new Error('动作输入及关联最多 60 项。');
  for(const action of output.actions)if(action.inputs.some(k=>typeof k!=='string')||action.links.some(l=>!isObject(l)))throw new Error('动作字段或关联格式无效。');
  for(const term of output.terms)if(typeof term.standard!=='string'||typeof term.language!=='string'||typeof term.scope!=='string'||!Array.isArray(term.aliases)||term.aliases.some(a=>typeof a!=='string'))throw new Error('术语名称、语言、范围及别名需为文本。');
  for(const list of Object.values(output))for(const item of list)for(const key of ['name','id','from','to','typeId','sourceType','description'])if(item[key]!==undefined&&typeof item[key]!=='string')throw new Error('标识和描述必须为文本。');
  for(const type of output.types)for(const field of type.fields)for(const key of ['key','name','unit','datatype'])if(field[key]!==undefined&&typeof field[key]!=='string')throw new Error('字段标识、名称、单位和类型需为文本。');
  for(const mapping of output.mappings)for(const field of mapping.fields)for(const key of ['source','target','transform'])if(typeof field[key]!=='string')throw new Error('源字段、目标属性和转换规则需为文本。');
  return output;
}
export function ontoValidate(schema){
  const errors=[],warnings=[];const add=(path,message)=>errors.push({path,message});
  const validKey=value=>typeof value==='string'&&/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(value);
  function unique(list,path,key='id'){const seen=new Set();for(const item of list){if(!item||!validKey(item[key])){add(path,'标识需为字母开头的 1～40 位字母、数字或下划线。');continue;}if(seen.has(item[key]))add(path,`标识 ${item[key]} 重复。`);seen.add(item[key]);if(!String(item.name??item.standard??'').trim()&&key==='id')add(`${path}.${item[key]}`,'名称不能为空。');}}
  unique(schema.types,'类型');if(!schema.types.length)add('类型','至少定义一种对象类型。');
  const typeBy=id=>schema.types.find(t=>t.id===id);const fieldBy=(id,key)=>typeBy(id)?.fields.find(f=>f.key===key);
  for(const type of schema.types){unique(type.fields,`类型.${type.id}.字段`,'key');for(const f of type.fields){const p=`${type.id}.${f.key}`;if(!String(f.name||'').trim())add(p,'字段名称不能为空。');if(!ontoDataTypes.includes(f.datatype))add(p,'不支持的字段数据类型。');if(typeof f.required!=='boolean')add(p,'必填标志必须为布尔值。');if(f.enum!==undefined&&(!Array.isArray(f.enum)||f.enum.some(v=>typeof v!=='string')))add(p,'枚举应为文本列表。');for(const k of ['min','max'])if(f[k]!==undefined&&(!Number.isFinite(f[k])||!['number','integer'].includes(f.datatype)))add(p,'上下限只适用于数值字段且必须为有限数值。');if(f.min!==undefined&&f.max!==undefined&&f.min>f.max)add(p,'最小值不能大于最大值。');}
    for(const c of type.constraints){const a=fieldBy(type.id,c.lower),b=fieldBy(type.id,c.upper);if(!a||!b||![a,b].every(f=>['number','integer'].includes(f.datatype)))add(type.id,'区间约束需要两个有效数值字段。');else if(a.unit!==b.unit)add(type.id,'区间约束字段必须使用相同单位。');}
    if(!Number.isFinite(type.x)||!Number.isFinite(type.y)||type.x<0||type.x>740||type.y<0||type.y>620)add(type.id,'画布坐标超出范围。');
  }
  unique(schema.relations,'关系');for(const r of schema.relations){if(!typeBy(r.from)||!typeBy(r.to))add(r.id,'关系起点或终点类型不存在。');if(!['one:one','one:many','many:one','many:many'].includes(r.cardinality))add(r.id,'关系基数无效。');}
  const lexicon=new Map();for(const term of schema.terms){if(!typeBy(term.typeId))add(term.id,'术语所属类型不存在。');if(!term.standard?.trim()||!term.language?.trim()||!term.scope?.trim()||!Array.isArray(term.aliases))add(term.id,'术语、别名列表、语言和适用范围必填。');for(const word of [term.standard,...(Array.isArray(term.aliases)?term.aliases:[])]){const key=`${term.typeId}:${term.language}:${term.scope}:${String(word).trim().toLowerCase()}`;if(lexicon.has(key)&&lexicon.get(key)!==term.standard)add(term.id,`术语“${word}”存在冲突归属。`);lexicon.set(key,term.standard);}}
  for(const key of ['terms','mappings','actions'])unique(schema[key],key);
  for(const m of schema.mappings){if(!typeBy(m.typeId))add(m.id,'映射目标类型不存在。');if(!['stratum','log','trajectory','instruction','custom'].includes(m.sourceType))add(m.id,'来源类型无效。');const targets=new Set();for(const f of m.fields){if(!f.source?.trim()||!fieldBy(m.typeId,f.target))add(m.id,'源字段不能为空，目标属性必须存在。');if(!ontoTransforms.includes(f.transform))add(m.id,'转换规则无效。');if(targets.has(f.target))add(m.id,`属性 ${f.target} 被重复映射。`);targets.add(f.target);}for(const f of typeBy(m.typeId)?.fields||[])if(f.required&&!targets.has(f.key))add(m.id,`缺少必填属性 ${f.name} 的映射。`);}
  for(const a of schema.actions){if(!typeBy(a.typeId))add(a.id,'动作写入类型不存在。');if(new Set(a.inputs).size!==a.inputs.length)add(a.id,'动作输入字段不能重复。');for(const key of a.inputs)if(!fieldBy(a.typeId,key))add(a.id,`输入字段 ${key} 不存在。`);for(const f of typeBy(a.typeId)?.fields||[])if(f.required&&!a.inputs.includes(f.key))add(a.id,`动作缺少必填输入 ${f.name}。`);for(const link of a.links)if(!a.inputs.includes(link.field)||!typeBy(link.typeId))add(a.id,'动作关联字段或目标类型无效。');}
  if(!schema.relations.length)warnings.push({path:'关系',message:'尚未配置对象关系。'});
  return {valid:!errors.length,errors,warnings};
}
export function ontoCheckRecord(type,record){
  const errors=[];for(const f of type.fields){const v=record[f.key];if(v===undefined||v===null||v===''){if(f.required)errors.push(`${f.name}为必填项`);continue;}
    if(f.datatype==='string'&&typeof v!=='string')errors.push(`${f.name}需为文本`);
    if(['number','integer'].includes(f.datatype)){if(typeof v!=='number'||!Number.isFinite(v)||(f.datatype==='integer'&&!Number.isInteger(v)))errors.push(`${f.name}需为${f.datatype==='integer'?'整数':'数值'}`);else if((f.min!==undefined&&v<f.min)||(f.max!==undefined&&v>f.max))errors.push(`${f.name}超出允许范围`);}
    if(f.datatype==='boolean'&&typeof v!=='boolean')errors.push(`${f.name}需为布尔值`);
    if(f.datatype==='datetime'&&(typeof v!=='string'||!/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(v)||!Number.isFinite(Date.parse(v))))errors.push(`${f.name}需为含时区的有效时间`);
    if(f.enum?.length&&!f.enum.includes(String(v)))errors.push(`${f.name}不在枚举范围内`);
  }
  for(const c of type.constraints)if(typeof record[c.lower]==='number'&&typeof record[c.upper]==='number'&&record[c.lower]>record[c.upper])errors.push(`${c.upper}不能小于${c.lower}`);
  return errors;
}
export function ontoMapPreview(schema,mapping,rows){
  const type=schema.types.find(t=>t.id===mapping.typeId);if(!type)return [{row:1,output:{},errors:['目标类型不存在']}];
  return rows.slice(0,20).map((row,index)=>{const output={},errors=[];for(const f of mapping.fields){const raw=row[f.source];let value=raw;if(raw===undefined||raw===null||raw===''){value='';}else if(f.transform==='trim')value=String(raw).trim();else if(f.transform==='number'){value=String(raw).trim()===''?'':Number(raw);if(!Number.isFinite(value)){errors.push(`${f.source}无法转换为数值`);value=null;}}else if(f.transform==='datetime'){value=String(raw);if(!Number.isFinite(Date.parse(value)))errors.push(`${f.source}时间无效`);}output[f.target]=value;}errors.push(...ontoCheckRecord(type,output));return {row:index+1,output,errors};});
}
export function ontoActionPreview(schema,action,input,references){
  const type=schema.types.find(t=>t.id===action.typeId);if(!type)return {valid:false,errors:['写入类型不存在'],output:{}};
  const output=Object.fromEntries(action.inputs.map(key=>[key,input[key]]));const errors=ontoCheckRecord(type,output);for(const link of action.links)if(!references[link.typeId]?.includes(String(input[link.field]??'')))errors.push(`${link.field}没有匹配到${schema.types.find(t=>t.id===link.typeId)?.name||link.typeId}对象`);
  return {valid:!errors.length,errors,output};
}
export function ontoDiff(previous,next){
  const changes=[];for(const group of ['types','relations','terms','mappings','actions']){const before=new Map((previous?.[group]||[]).map(i=>[i.id,i]));for(const item of next[group]){const old=before.get(item.id);if(!old)changes.push({group,id:item.id,kind:'新增',before:null,after:item});else if(JSON.stringify(old)!==JSON.stringify(item))changes.push({group,id:item.id,kind:'修改',before:old,after:item});before.delete(item.id);}for(const [id,old]of before)changes.push({group,id,kind:'删除',before:old,after:null});}
  return changes;
}
