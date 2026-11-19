import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {slCleanText,slCleanDatabase} from '../src/sample-labels.js';

// Prepare before changing any files. Only generated sample originals are
// rewritten. Uploaded non-sample bytes and the credentials container are left
// intact. Backups live outside the project to keep old labels out of the app.
export async function prepareSampleLabelCleanup({db,directory,dataFile,backupRoot}){
  const cleaned=JSON.parse(JSON.stringify(db)),filesRoot=path.resolve(directory,'ingestion','files'),updates=[],seen=new Set();
  for(const version of db.ingestion?.versions||[]){
    const asset=db.assets.find(a=>a.id===version.assetId);if(!(version.demo||asset?.demo)||!version.fileId||seen.has(version.fileId))continue;
    if(!/^[a-f0-9-]{36}$/.test(version.fileId))continue;seen.add(version.fileId);
    const filename=path.resolve(filesRoot,version.fileId+'.bin');if(!filename.startsWith(filesRoot+path.sep))throw new Error('样本文件路径超出运行目录。');
    let before;try{before=await fs.readFile(filename);}catch(error){if(error.code==='ENOENT')throw new Error('样本原件缺失，请先恢复原件后再启动。');throw error;}
    const oldHash=createHash('sha256').update(before).digest('hex');
    if((db.ingestion.versions.filter(v=>v.fileId===version.fileId)).some(v=>v.hash!==oldHash))throw new Error('样本原件与历史摘要不一致，清理已停止。');
    const raw=new TextDecoder('utf-8',{fatal:true}).decode(before),text=slCleanText(raw);if(text===raw)continue;
    const after=Buffer.from(text,'utf8');updates.push({fileId:version.fileId,filename,before,after,oldHash,hash:createHash('sha256').update(after).digest('hex'),size:after.length});
  }
  const summary=slCleanDatabase(cleaned,updates),changed=summary.changed||updates.length>0;
  let backupDirectory='',applied=[];
  const atomicWrite=async(filename,bytes)=>{const temp=filename+'.cleanup-'+randomUUID()+'.tmp';try{await fs.writeFile(temp,bytes,{flag:'wx'});await fs.rename(temp,filename);}catch(error){await fs.unlink(temp).catch(()=>{});throw error;}};
  return {db:cleaned,changed,summary:{...summary,changedFiles:updates.length},get backupDirectory(){return backupDirectory;},
    async apply(){
      if(!changed)return;
      const current=await fs.readFile(dataFile).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
      backupDirectory=path.join(backupRoot||path.join(os.tmpdir(),'knowledge-graph-backups'),'sample-labels-'+Date.now()+'-'+randomUUID());
      await fs.mkdir(path.join(backupDirectory,'files'),{recursive:true});
      if(current)await fs.writeFile(path.join(backupDirectory,'platform-before.json'),current,{flag:'wx'});
      for(const item of updates)await fs.writeFile(path.join(backupDirectory,'files',item.fileId+'.bin'),item.before,{flag:'wx'});
      await fs.writeFile(path.join(backupDirectory,'manifest.json'),JSON.stringify({createdAt:new Date().toISOString(),dataFile,summary:this.summary,files:updates.map(({fileId,oldHash,hash,size})=>({fileId,oldHash,hash,size}))},null,2));
      try{for(const item of updates){await atomicWrite(item.filename,item.after);applied.push(item);}}catch(error){await this.rollback();throw error;}
    },
    async rollback(){for(const item of [...applied].reverse())await atomicWrite(item.filename,item.before);applied=[];}
  };
}
