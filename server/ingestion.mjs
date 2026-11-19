import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {activeUser,fault,auditEvent} from '../src/access-model.js';
import {ingLimits,ingParse} from '../src/ingestion-core.js';
import {ingEnsure,ingScope,ingFindAsset,ingRecordUpload,ingSetParsed,ingDashboard,ingDetail,ingMutation} from '../src/ingestion-model.js';

export async function createIngestion({directory,getDb,commit}){
  const files=path.join(directory,'files');await fs.mkdir(files,{recursive:true});let working=false,stopped=false;
  await commit(db=>{const ig=ingEnsure(db);for(const job of ig.jobs)if(['解析中','待解析'].includes(job.status))ingSetParsed(db,job.id,null,'服务重启中断了任务，请点击重试。');});
  const referenced=new Set(getDb().ingestion.versions.map(version=>version.fileId));
  for(const filename of await fs.readdir(files))if(/^[0-9a-f-]{36}\.bin$/.test(filename)&&!referenced.has(filename.slice(0,-4))){const target=path.join(files,filename);const info=await fs.stat(target);if(Date.now()-info.mtimeMs>24*60*60*1000)await fs.unlink(target);}
  const drain=async()=>{
    if(working||stopped)return;working=true;
    try{
      while(!stopped){
        const job=getDb().ingestion.jobs.find(item=>item.status==='待解析');if(!job)break;
        const version=getDb().ingestion.versions.find(item=>item.id===job.versionId);if(!version)break;
        await commit(db=>{const current=db.ingestion.jobs.find(item=>item.id===job.id);if(current){current.status='解析中';current.startedAt=new Date().toISOString();}const target=db.ingestion.versions.find(item=>item.id===version.id);target.status='解析中';const asset=db.assets.find(item=>item.id===target.assetId);if(asset.currentVersionId===target.id)asset.status='解析中';});
        let parsed,error;
        try{const bytes=await fs.readFile(path.join(files,`${version.fileId}.bin`));const text=new TextDecoder(version.encoding||'utf-8',{fatal:true}).decode(bytes);parsed=ingParse(text,path.extname(version.fileName).slice(1).toLowerCase());}
        catch(cause){error=cause.message?.includes('encoded data')?'编码不匹配，请按 UTF-8 或 GB18030 编码重新上传。':cause.message;}
        await commit(db=>ingSetParsed(db,job.id,parsed,error));
      }
    }finally{working=false;}
  };
  const kick=()=>setImmediate(()=>drain().catch(error=>process.emitWarning(`解析任务保存失败：${error.message}`)));
  return {
    close(){stopped=true;},
    async handle({req,res,url,user,body,requestId,send}){
      const pathname=url.pathname;
      if(pathname==='/api/ingestion'&&req.method==='GET'){send(200,ingDashboard(getDb(),user,url.searchParams.get('projectId')));return true;}
      const detail=pathname.match(/^\/api\/ingestion\/assets\/([\w-]+)$/);
      if(detail&&req.method==='GET'){send(200,ingDetail(getDb(),user,detail[1]));return true;}
      if(pathname==='/api/ingestion/upload'&&req.method==='POST'){
        if(!req.headers['content-type']?.startsWith('application/octet-stream'))fault('上传需使用二进制文件请求。',415);
        const input=Object.fromEntries(url.searchParams);input.name=String(input.name||'').trim();
        if(!input.name||input.name.length>180||/[\x00-\x1f\\/]/.test(input.name))fault('文件名不合法或超过 180 字符。');
        input.encoding=input.encoding||'utf-8';if(!['utf-8','gb18030'].includes(input.encoding))fault('仅支持 UTF-8 或 GB18030 编码。');
        if(req.headers['x-import-config']){if(req.headers['x-import-config'].length>6000)fault('字段配置过大。');try{input.config=JSON.parse(decodeURIComponent(req.headers['x-import-config']));}catch{fault('字段配置格式错误。');}}
        ingScope(getDb(),user,input.projectId,input.wellId,'import');
        if(input.assetId)ingFindAsset(getDb(),user,input.assetId,'import',true);
        if(Number(req.headers['content-length'])>ingLimits.bytes)fault('单文件最多 5 MB。',413);
        const chunks=[];let size=0;
        for await(const chunk of req){size+=chunk.length;if(size>ingLimits.bytes)fault('单文件最多 5 MB。',413);chunks.push(chunk);}
        if(!size)fault('不能上传空文件。');
        const bytes=Buffer.concat(chunks);const hash=createHash('sha256').update(bytes).digest('hex');const fileId=randomUUID();const filename=path.join(files,`${fileId}.bin`);
        await fs.writeFile(filename,bytes,{flag:'wx'});
        let result;
        try{result=await commit(db=>ingRecordUpload(db,activeUser(db,user.id),{...input,size,hash,fileId},{requestId}));if(result.duplicate)await fs.unlink(filename);}
        catch(error){await fs.unlink(filename).catch(()=>{});throw error;}
        send(202,result);kick();return true;
      }
      const file=pathname.match(/^\/api\/ingestion\/files\/([\w-]+)$/);
      if(file&&req.method==='GET'){
        const db=getDb(),version=db.ingestion.versions.find(item=>item.id===file[1]);if(!version)fault('原件不存在。',404);
        const asset=ingFindAsset(db,user,version.assetId,'view',true);
        const content=await fs.readFile(path.join(files,`${version.fileId}.bin`));
        await commit(db=>{ingFindAsset(db,activeUser(db,user.id),asset.id,'view',true);auditEvent(db,user,'下载资料原件',asset.id,{versionId:version.id},{requestId,projectId:asset.projectId,wellId:asset.wellId});});
        res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="source.${path.extname(version.fileName).slice(1).replace(/[^a-z0-9]/gi,'')||'bin'}"; filename*=UTF-8''${encodeURIComponent(version.fileName).replace(/'/g,'%27')}`,'Content-Length':content.length});res.end(content);return true;
      }
      const mutation=pathname.match(/^\/api\/ingestion\/(alias|standardize|correct|validate|retry|handoff)$/);
      if(mutation&&req.method==='POST'){const result=await commit(db=>ingMutation(db,activeUser(db,user.id),mutation[1],body,{requestId}));send(200,result);if(mutation[1]==='retry')kick();return true;}
      return false;
    },
  };
}
