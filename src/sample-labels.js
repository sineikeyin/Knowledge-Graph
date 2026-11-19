// Compatibility cleanup for old sample labels. The legacy label is represented
// by code points so it cannot accidentally reappear in product text or fixtures.
const slLegacyLabel=String.fromCodePoint(0x6f14,0x793a);
const slMarker=new RegExp(`[\\[【（(]${slLegacyLabel}[\\]】）)]\\s*`,'g');
const slWord=new RegExp(slLegacyLabel,'g');
export function slCleanText(value){
  return String(value).replace(/&#(?:x6f14|28436);/gi,slLegacyLabel[0]).replace(/&#(?:x793a|31034);/gi,slLegacyLabel[1]).replace(slMarker,'').replace(slWord,'示例');
}
export function slHasLegacy(value){return String(value).includes(slLegacyLabel)||/&#(?:x6f14|28436);\s*&#(?:x793a|31034);/i.test(String(value));}
export function slCleanDatabase(db,fileUpdates=[]){
  let changedStrings=0,changedHashes=0;
  const hashes=new Map(fileUpdates.map(item=>[item.oldHash,item])),files=new Map(fileUpdates.map(item=>[item.fileId,item]));
  const walk=value=>{
    if(typeof value==='string'){if(hashes.has(value)){changedHashes++;return hashes.get(value).hash;}const cleaned=slCleanText(value);if(cleaned!==value)changedStrings++;return cleaned;}
    if(!value||typeof value!=='object')return value;
    if(Array.isArray(value)){for(let i=0;i<value.length;i++)value[i]=walk(value[i]);return value;}
    // Offsets refer to the original evidence text, so adjust both endpoints when
    // deleting a prefix before a highlighted source cell.
    const raw=typeof value.raw==='string'?value.raw:null,span=value.span;
    if(raw&&span&&Number.isInteger(span.start)&&Number.isInteger(span.end))value.span={...span,start:slCleanText(raw.slice(0,span.start)).length,end:slCleanText(raw.slice(0,span.end)).length};
    const hashUpdate=hashes.get(value.hash),fileUpdate=files.get(value.fileId);
    for(const key of Object.keys(value)){
      const newKey=slCleanText(key),next=walk(value[key]);
      if(newKey!==key){if(Object.hasOwn(value,newKey))throw new Error('样本标签清理后出现重名字段，已停止处理。');delete value[key];Object.defineProperty(value,newKey,{value:next,enumerable:true,writable:true,configurable:true});changedStrings++;}
      else value[key]=next;
    }
    if(hashUpdate){value.hash=hashUpdate.hash;if('size' in value)value.size=hashUpdate.size;}
    else if(fileUpdate){value.hash=fileUpdate.hash;if('size' in value)value.size=fileUpdate.size;changedHashes++;}
    return value;
  };
  walk(db);return {changed:changedStrings>0||changedHashes>0,changedStrings,changedHashes};
}
