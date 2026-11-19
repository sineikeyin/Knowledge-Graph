// Initializes the same additive demo migration used at service startup. Run with the service stopped.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createApp} from '../server/app.mjs';
import fs from 'node:fs/promises';
const root=fileURLToPath(new URL('..',import.meta.url));
const dataFile=path.join(root,'.runtime','platform.json');
for(let port=5173;port<=5183;port++){
  let response;try{response=await fetch(`http://127.0.0.1:${port}/`,{signal:AbortSignal.timeout(400)});}catch{continue;}
  if((await response.text()).includes('智能地质导向知识图谱平台'))throw new Error(`检测到运行中的平台服务（端口 ${port}）。请先停止服务，或直接重启服务完成自动初始化。`);
}
await createApp({root,dataFile});
const {db}=JSON.parse(await fs.readFile(dataFile,'utf8'));
const summary={demoAssets:db.assets.filter(asset=>asset.demo).length,parseJobs:db.ingestion.jobs.filter(job=>job.demo).length,masterMappings:db.ingestion.aliases.filter(alias=>alias.demo).length,versions:db.ingestion.versions.filter(version=>version.demo).length,qualityRuns:db.ingestion.versions.filter(version=>version.demo).reduce((total,version)=>total+version.qualityRuns.length,0),handoffs:db.ingestion.handoffs.filter(handoff=>db.assets.some(asset=>asset.id===handoff.assetId&&asset.demo)).length};
console.log(JSON.stringify(summary,null,2));
