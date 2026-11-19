import path from 'node:path';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createApp} from '../server/app.mjs';
import {slHasLegacy} from '../src/sample-labels.js';

const root=fileURLToPath(new URL('..',import.meta.url));
const dataFile=path.join(root,'.runtime','platform.json');
const backupOption=process.argv.indexOf('--backup-root'),labelBackupRoot=backupOption>=0?path.resolve(process.argv[backupOption+1]||''):undefined;
if(backupOption>=0&&(!process.argv[backupOption+1]||labelBackupRoot===path.resolve(root)||labelBackupRoot.startsWith(path.resolve(root)+path.sep)))throw new Error('备份目录必须位于项目目录之外。');
// Never race the in-memory writer of an existing platform service.
for(let port=5173;port<=5183;port++){
  let response;try{response=await fetch(`http://127.0.0.1:${port}/`,{signal:AbortSignal.timeout(400)});}catch{continue;}
  if((await response.text()).includes('智能地质导向知识图谱平台'))throw new Error(`检测到运行中的平台服务（端口 ${port}），请先停止后再运行清理，或重启新版服务自动完成清理。`);
}
await fs.access(dataFile);const server=await createApp({root,dataFile,labelBackupRoot});server.close();
const {db}=JSON.parse(await fs.readFile(dataFile,'utf8'));if(slHasLegacy(JSON.stringify(db)))throw new Error('数据库仍包含旧样本标签。');
console.log(JSON.stringify({status:'completed',assets:db.assets.length,publishedKnowledge:db.construction?.facts.filter(f=>f.active).length||0,labelCleanup:db.sampleLabelCleanup||null},null,2));
