// LAS 2.x ASCII parser. Header locations refer to the unmodified uploaded file.
export function lasParse(text){
  const lines=String(text).replace(/^\uFEFF/,'').split(/\r?\n/),header=[],curves=[],samples=[];
  let section='',well='',nullValue=-999.25,wrap='NO',version='',depthType='',datum='';
  const fail=message=>{throw new Error(message);};
  for(let index=0;index<lines.length;index++){
    const line=lines[index].trim();if(line.length>4096)fail(`LAS 第 ${index+1} 行超过4096字符。`);if(!line||line.startsWith('#'))continue;
    if(line.startsWith('~')){section=line.slice(1).trim()[0]?.toUpperCase();continue;}
    if(section==='A'){samples.push({line:index+1,values:line.split(/\s+/)});continue;}
    if(!['V','W','C','P'].includes(section))continue;
    const match=line.match(/^([^\s.]+)\.([^\s:]*)\s*(.*?)\s*(?::(.*))?$/);if(!match)fail(`LAS 第 ${index+1} 行头段格式错误。`);
    const [,mnemonic,unit,value,description='']=match,key=mnemonic.toUpperCase();
    header.push({section,mnemonic:key,unit,value:value.trim(),description:description.trim(),line:index+1,text:lines[index]});
    if(header.length>1024)fail('LAS 头段最多1024个参数。');
    if(section==='C')curves.push({mnemonic:key,unit,description:description.trim(),line:index+1});
    if(section==='V'&&key==='VERS')version=value.trim();
    if(section==='V'&&key==='WRAP')wrap=value.trim().toUpperCase();
    if(section==='W'&&key==='WELL')well=value.trim();
    if(section==='W'&&key==='NULL'){nullValue=Number(value);if(!Number.isFinite(nullValue))fail('LAS NULL 值无效。');}
    if(section==='P'&&key==='DEPTTYPE')depthType=value.trim();
    if(section==='P'&&key==='DREF')datum=value.trim();
  }
  if(!/^2(?:\.|$)/.test(version))fail('当前支持 LAS 2.x ASCII 文件，请转换版本后上传。');
  if(wrap!=='NO')fail('当前不支持 LAS WRAP=YES，请展开为 WRAP=NO。');
  if(!well||curves.length<2||!['DEPT','DEPTH'].includes(curves[0].mnemonic)||!samples.length)fail('LAS 需包含 WELL、深度列、曲线定义及 ASCII 数据。');
  if(curves.length>128||samples.length*(curves.length-1)>5000)fail('LAS 展开后最多 5000 条曲线记录、128 列。');
  const headers=['well','depth','curve','value','valueUnit','unit','depthType','datum'],rows=[],locations=[];
  for(const sample of samples){
    if(sample.values.length!==curves.length||sample.values.some(v=>!Number.isFinite(Number(v))))fail(`LAS 第 ${sample.line} 行数据列数或数值不合法。`);
    for(let column=1;column<curves.length;column++){
      rows.push([well,sample.values[0],curves[column].mnemonic,Number(sample.values[column])===nullValue?'':sample.values[column],curves[column].unit,curves[0].unit,depthType,datum]);locations.push(sample.line);
    }
  }
  return {headers,rows,locations,lasHeader:header,curves,parserVersion:'las-ascii-v1',format:'las'};
}
