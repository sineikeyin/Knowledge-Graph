import {lasParse} from './las-core.js';
// Pure parsers and deterministic governance rules; shared by the local service and offline demo.
export const ingLimits = {bytes:5*1024*1024,rows:5000,columns:128,cell:4096};
export const ingAcceptedFormats = ['csv','json','las'];
export function ingFileFormat(name){const extension=String(name||'').match(/^.+\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();return ingAcceptedFormats.includes(extension)?extension:'';}
export const ingFieldSets = {
  stratum:[['well','井名',true],['layer','层位',true],['top','顶深',true],['bottom','底深',true],['thickness','厚度',false],['unit','深度单位',true],['depthType','深度类型',true],['datum','参考基准',true],['lithology','岩性',false],['block','区块',false]],
  log:[['well','井名',true],['depth','井深',true],['curve','曲线名',true],['value','曲线值',true],['valueUnit','曲线单位',true],['unit','深度单位',true],['depthType','深度类型',true],['datum','参考基准',true],['time','事件时间',false]],
  trajectory:[['well','井名',true],['depth','井深',true],['inclination','井斜角',true],['azimuth','方位角',true],['unit','深度单位',true],['depthType','深度类型',true],['datum','参考基准',true]],
};
export const ingRuleCatalog = [
  ['required','必填与数值格式','阻断','按资料类型检查必要字段和数值'],
  ['master','主数据归一','阻断','井归属、层位及别名匹配'],
  ['basis','单位与深度基准','阻断','m/ft 统一；MD/TVD 和参考基准明确'],
  ['interval','区间与重复','阻断','顶底深、重复记录及分层重叠'],
  ['time','事件时间','阻断','时间含明确时区；保留原始时间'],
  ['continuity','井深连续性','警告','配置允许的最大采样间距，未配置则不适用'],
  ['curve','曲线范围与突变','警告','可配置范围与相邻值差；阈值需业务确认'],
];
export function ingError(message,status=400){const error=new Error(message);error.status=status;throw error;}
export function ingKey(value){return String(value??'').trim().toLowerCase().replace(/[\s_\-]/g,'');}
export function ingParse(text,extension){
  text=String(text).replace(/^\uFEFF/,'');
  if(extension==='las')return lasParse(text);
  let headers,rows,locations;
  if(extension==='json'){
    let value;try{value=JSON.parse(text);}catch{ingError('JSON 格式错误，请检查引号、逗号与括号。');}
    const list=Array.isArray(value)?value:value?.records;
    if(!Array.isArray(list)||!list.length||list.length>ingLimits.rows)ingError('JSON 需为非空对象数组，或包含 records 数组；最多 5000 行。');
    if(list.some(row=>!row||Array.isArray(row)||typeof row!=='object'))ingError('JSON 每条记录必须是对象。');
    headers=[...new Set(list.flatMap(row=>Object.keys(row)))];
    rows=list.map(row=>headers.map(key=>{const cell=row[key];if(cell!==null&&typeof cell==='object')ingError('JSON 仅支持一层字段，不能嵌套对象或数组。');return cell==null?'':String(cell);}));
    locations=list.map((_,index)=>index+1);
  }else if(extension==='csv'){
    const records=[];let row=[],cell='',quoted=false,afterQuote=false,line=1,start=1;
    const endCell=()=>{row.push(cell);cell='';afterQuote=false;if(row.length>ingLimits.columns)ingError('CSV 超过 128 列限制。');};
    const endRow=()=>{endCell();if(row.some(value=>value.trim()))records.push({row,line:start});row=[];start=line+1;if(records.length>ingLimits.rows+1)ingError('CSV 最多 5000 条数据。');};
    for(let i=0;i<text.length;i++){
      const c=text[i];
      if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;afterQuote=true;}}else{cell+=c;if(c==='\n')line++;}}
      else if(c==='"'){if(cell||afterQuote)ingError(`CSV 第 ${line} 行引号位置错误。`);quoted=true;}
      else if(c===',')endCell();
      else if(c==='\r'||c==='\n'){if(c==='\r'&&text[i+1]==='\n')i++;endRow();line++;}
      else {if(afterQuote&&!/\s/.test(c))ingError(`CSV 第 ${line} 行引号后存在多余内容。`);if(!afterQuote)cell+=c;}
      if(cell.length>ingLimits.cell)ingError('单元格超过 4096 字符限制。');
    }
    if(quoted)ingError('CSV 引号未闭合。');if(cell||row.length||afterQuote)endRow();
    if(records.length<2)ingError('CSV 需要表头和至少一条数据。');
    headers=records.shift().row.map(value=>value.trim());
    if(records.some(record=>record.row.length!==headers.length))ingError('CSV 数据列数与表头不一致，请检查逗号和引号。');
    rows=records.map(record=>record.row);locations=records.map(record=>record.line);
  }else ingError('目前仅支持 CSV 或 JSON 文件。');
  if(!headers.length||headers.length>ingLimits.columns||headers.some(header=>!header.trim()||header.length>100)||new Set(headers.map(ingKey)).size!==headers.length)ingError('表头不能为空或重复，最多 128 列，每个名称不超过 100 字。');
  if(rows.some(row=>row.some(cell=>cell.length>ingLimits.cell)))ingError('单元格超过 4096 字符限制。');
  return {headers,rows,locations,parserVersion:'structured-v1',format:extension};
}
export function ingGuess(headers,objectType){
  const aliases={well:['井号','井名','well','wellname'],layer:['层位','地层','layer','formation'],top:['顶深','top','topdepth'],bottom:['底深','bottom','bottomdepth'],thickness:['厚度','thickness'],unit:['深度单位','单位','unit','depthunit'],depthType:['深度类型','depthtype'],datum:['参考基准','基准','datum'],lithology:['岩性','lithology'],block:['区块','区块名','block'],depth:['井深','depth','md'],curve:['曲线','曲线名','curve'],value:['曲线值','数值','value'],valueUnit:['曲线单位','valueunit'],time:['事件时间','时间','time','timestamp'],inclination:['井斜角','井斜','inclination','inc'],azimuth:['方位角','方位','azimuth','azi']};
  return Object.fromEntries((ingFieldSets[objectType]||[]).map(([key])=>[key,headers.find(header=>(aliases[key]||[key]).some(alias=>ingKey(alias)===ingKey(header)))||'']));
}
export function ingNormalize(parsed,objectType,config,scope){
  const fields=ingFieldSets[objectType]||[];const mapping=config.fields||ingGuess(parsed.headers,objectType),defaults=config.defaults||{};
  const resolve=(kind,value)=>{const key=ingKey(value);const alias=scope.aliases.find(item=>item.kind===kind&&ingKey(item.rawName)===key);return alias?.standardName||String(value??'').trim();};
  return parsed.rows.map((cells,index)=>{
    const record={};for(const [key]of fields){const header=mapping[key];if(header&&!parsed.headers.includes(header))ingError(`映射字段不存在：${header}`);record[key]=String(header?cells[parsed.headers.indexOf(header)]??'':defaults[key]??'').trim();}
    const wellRaw=record.well;const resolvedWell=resolve('well',wellRaw);
    record.wellId=wellRaw&&[scope.well.id,scope.well.short,scope.well.name].some(name=>ingKey(name)===ingKey(resolvedWell))?scope.well.id:'';
    if(record.layer)record.layer=resolve('layer',record.layer);
    if(record.lithology)record.lithology=resolve('lithology',record.lithology);
    if(record.block)record.block=resolve('block',record.block);
    record.rawUnit=record.unit;record.depthType=String(record.depthType||'').toUpperCase();
    const factor={m:1,米:1,ft:0.3048,英尺:0.3048}[String(record.unit||'').toLowerCase()];
    const invalidFields=[],missingThickness=record.thickness===''||/^(null|-999\.25)$/i.test(record.thickness||'');
    for(const key of ['top','bottom','thickness','depth','value','inclination','azimuth'])if(key in record){const raw=record[key],missing=raw===''||/^(null|-999\.25)$/i.test(raw);record[key]=missing?null:/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw)?Number(raw):NaN;if(!Number.isFinite(record[key])){if(!missing)invalidFields.push(key);record[key]=null;}if(factor&&['top','bottom','thickness','depth'].includes(key)&&record[key]!==null)record[key]=Number((record[key]*factor).toFixed(6));}
    if(factor)record.unit='m';
    record.thicknessMethod='原始值';
    if(objectType==='stratum'&&missingThickness&&record.thickness===null&&record.top!==null&&record.bottom!==null){record.thickness=Number((record.bottom-record.top).toFixed(6));record.thicknessMethod='同深度类型与参考基准的底深减顶深';}
    return {row:index+1,location:parsed.locations[index],record,raw:cells,invalidFields};
  });
}
export function ingValidate(rows,objectType,scope,options={}){
  const issues=[];const add=(rule,row,field,message,severity='block')=>issues.push({rule,row:row.row,location:row.location,field,message,severity,value:row.record[field]??''});
  const fields=ingFieldSets[objectType];
  if(!fields)return {status:'阻断',issues:[{rule:'template',row:0,location:0,field:'',message:'此资料类型尚无治理模板，请先使用地层、测井或井轨迹模板。',severity:'block',value:''}],checks:[]};
  const seen=new Set(),previousByCurve=new Map(),curveUnits=new Map();
  for(const row of rows){
    const r=row.record;
    for(const field of row.invalidFields||[])add('required',row,field,'原始值不是合法的有限十进制数值。');
    for(const [key,label,required]of fields)if(required&&(r[key]===null||r[key]===undefined||r[key]===''))add('required',row,key,`${label}为空或格式不合法。`);
    if(!r.wellId)add('master',row,'well','井名未匹配到本次导入的归属井，请配置别名或检查归属。');
    if(objectType==='stratum'&&r.layer&&!scope.layers.some(layer=>ingKey(layer)===ingKey(r.layer)))add('master',row,'layer','层位未归一，请在主数据映射中确认标准层位。');
    if(r.block&&scope.block&&ingKey(r.block)!==ingKey(scope.block))add('master',row,'block','区块名称与归属项目不匹配，请确认区块别名。');
    if(r.unit!=='m')add('basis',row,'unit','仅支持 m/米 或 ft/英尺；需明确原始深度单位。');
    if(!['MD','TVD'].includes(r.depthType))add('basis',row,'depthType','深度类型必须明确为 MD 或 TVD。');
    if(!r.datum||/^(未知|unknown|待确认)$/i.test(r.datum))add('basis',row,'datum','参考基准未明确。');
    if(objectType==='stratum'){
      if(r.top!==null&&r.bottom!==null&&r.bottom<=r.top)add('interval',row,'bottom','底深必须大于顶深。');
      if(r.thickness!==null&&r.thickness<=0)add('interval',row,'thickness','厚度必须大于零。');
      if(r.top!==null&&r.bottom!==null&&r.thickness!==null&&Math.abs(r.bottom-r.top-r.thickness)>0.01)add('interval',row,'thickness','厚度与顶底深之差不一致，请核对深度类型及厚度含义。');
    }
    for(const key of ['top','bottom','depth'])if(r[key]!==null&&r[key]!==undefined&&r[key]<0)add('required',row,key,'本版模板仅接受非负井深。');
    if(objectType==='trajectory'){if(r.inclination!==null&&(r.inclination<0||r.inclination>180))add('required',row,'inclination','井斜角应在 0～180°。');if(r.azimuth!==null&&(r.azimuth<0||r.azimuth>=360))add('required',row,'azimuth','方位角应在 0～360°，不含 360°。');}
    const identity=objectType==='stratum'?[r.wellId,r.layer,r.top,r.bottom,r.depthType,r.datum]:[r.wellId,r.depth,r.curve||'',r.time||'',r.depthType,r.datum];const key=JSON.stringify(identity);
    if(seen.has(key))add('interval',row,objectType==='stratum'?'top':'depth','发现重复区间或采样记录。');seen.add(key);
    if(r.time&&(!/(Z|[+-]\d\d:\d\d)$/i.test(r.time)||Number.isNaN(Date.parse(r.time))))add('time',row,'time','事件时间需为含时区的 ISO 时间，例如 2026-11-19T10:00:00+08:00。');
    if(objectType==='log'&&r.value!==null){if(options.min!==null&&options.min!==undefined&&r.value<options.min)add('curve',row,'value','低于配置的曲线最小值。','warning');if(options.max!==null&&options.max!==undefined&&r.value>options.max)add('curve',row,'value','超过配置的曲线最大值。','warning');}
    if(objectType==='log'&&r.curve&&r.valueUnit){const unit=curveUnits.get(r.curve);if(unit&&unit!==r.valueUnit)add('basis',row,'valueUnit','同一曲线存在不同单位，请先统一曲线单位。');curveUnits.set(r.curve,r.valueUnit);}
    const curveKey=JSON.stringify([r.wellId,r.curve||'',r.valueUnit||'',r.datum,r.depthType]),previous=previousByCurve.get(curveKey);
    if(previous&&r.depth!==null&&r.depth!==undefined){const gap=r.depth-previous.record.depth;if(gap<0)add('continuity',row,'depth','井深记录顺序倒退，请核对采集顺序。','warning');if(options.maxGap>0&&gap>options.maxGap)add('continuity',row,'depth','井深间距超过配置上限。','warning');if(objectType==='log'&&options.maxJump>0&&r.value!==null&&previous.record.value!==null&&Math.abs(r.value-previous.record.value)>options.maxJump)add('curve',row,'value','相邻曲线值变化超过配置阈值。','warning');}if(r.depth!==null&&r.depth!==undefined)previousByCurve.set(curveKey,row);
  }
  if(objectType==='stratum'){
    const sorted=rows.filter(row=>row.record.top!==null&&row.record.bottom!==null).slice().sort((a,b)=>a.record.top-b.record.top);const ends=new Map();
    for(const row of sorted){const r=row.record,key=JSON.stringify([r.wellId,r.depthType,r.datum]);const end=ends.get(key);if(end!==undefined&&r.top<end)add('interval',row,'top','分层区间与其他记录重叠。');ends.set(key,Math.max(end??-Infinity,r.bottom));}
  }
  const checks=ingRuleCatalog.map(([id,name])=>({id,name,status:issues.some(issue=>issue.rule===id)?'有问题':id==='time'&&!rows.some(row=>row.record.time)||id==='continuity'&&(objectType==='stratum'||!(options.maxGap>0))||id==='curve'&&(objectType!=='log'||![options.min,options.max,options.maxJump].some(value=>value!==null&&value!==undefined))?'不适用':'通过'}));
  return {status:issues.some(issue=>issue.severity==='block')?'阻断':issues.length?'警告':'通过',issues,checks};
}
