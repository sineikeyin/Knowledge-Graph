import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {makeDatabase} from '../src/access-model.js';
import {ingParse} from '../src/ingestion-core.js';
import {ingEnsure,ingRecordUpload,ingSetParsed,ingMutation,ingDashboard,ingDetail,ingStandards,ingMappingRevision} from '../src/ingestion-model.js';
import {ingDemoFixtures,ingSeedDemo,ingDemoSeedVersion} from '../src/ingestion-demo.js';
import {createApp} from '../server/app.mjs';

test('预置记录涵盖通过、警告、阻断、失败、映射、校验与固定版本交接，重复初始化不增殖',()=>{
  const db=makeDatabase(),user=db.users[0];assert.equal(ingSeedDemo(db).changed,true);const ig=db.ingestion;
  assert.equal(db.assets.filter(asset=>asset.demo).length,17);assert.equal(ig.jobs.filter(job=>job.demo).length,17);assert.equal(ig.aliases.filter(alias=>alias.demo).length,20);assert.equal(ig.versions.filter(version=>version.demo).length,22);assert.equal(ig.versions.reduce((count,version)=>count+version.qualityRuns.length,0),20);assert.equal(ig.handoffs.length,5);
  const dashboard=ingDashboard(db,user,'p1');assert.equal(dashboard.jobs.length,10);assert.equal(dashboard.aliases.length,12);assert.ok(dashboard.assets.some(asset=>asset.demo&&asset.quality==='通过'));assert.ok(dashboard.assets.some(asset=>asset.demo&&asset.quality==='警告'));assert.ok(dashboard.assets.some(asset=>asset.demo&&asset.quality==='阻断'));assert.ok(dashboard.jobs.some(job=>job.status==='失败'&&job.error));
  for(const asset of db.assets.filter(asset=>asset.demo)){assert.doesNotMatch(asset.name,/^(?:\[示例\]|【示例】)/);assert.match(asset.source,/虚构/);const version=ig.versions.find(item=>item.id===asset.currentVersionId);if(asset.quality==='通过')assert.equal(version.qualityRuns.at(-1).issues.length,0);if(asset.quality==='阻断')assert.ok(version.qualityRuns.at(-1).issues.some(issue=>issue.severity==='block'));}
  assert.equal(ig.demoSeed.version,ingDemoSeedVersion);const before=JSON.stringify(db);assert.equal(ingSeedDemo(db).changed,false);assert.equal(JSON.stringify(db),before);
});

test('已有预置记录去掉名称前缀，保留原件摘要、版本、质量与交接；用户原始文件名不变',()=>{
  const db=makeDatabase();ingSeedDemo(db);
  for(const asset of db.assets.filter(asset=>asset.demo))asset.name='[示例] '+asset.name;
  for(const version of db.ingestion.versions)version.fileName='【示例】 '+version.fileName;
  delete db.ingestion.demoSeed.namingVersion;
  const before=JSON.parse(JSON.stringify(db.ingestion));
  db.assets.push({id:'user-original',projectId:'p1',wellId:'w1',objectType:'stratum',name:'[示例] 用户原始文件名.csv',managed:true});
  assert.equal(ingSeedDemo(db).changed,true);assert.equal(db.assets.find(asset=>asset.id==='user-original').name,'[示例] 用户原始文件名.csv');
  assert.ok(db.assets.filter(asset=>asset.demo).every(asset=>!asset.name.startsWith('[示例]')));
  for(const version of db.ingestion.versions){const old=before.versions.find(item=>item.id===version.id);assert.doesNotMatch(version.fileName,/^(?:\[示例\]|【示例】)/);for(const field of ['hash','fileId','parentId','rows','qualityRuns','mappingRevision'])assert.deepEqual(version[field],old[field]);}
  assert.deepEqual(db.ingestion.handoffs,before.handoffs);assert.deepEqual(db.ingestion.jobs,before.jobs);assert.equal(ingSeedDemo(db).changed,false);
});

test('增量示例初始化保留真实资料和校验；示例映射与真实映射互不影响',()=>{
  const db=makeDatabase(),user=db.users[0];ingEnsure(db);
  ingMutation(db,user,'alias',{projectId:'p1',wellId:'w1',kind:'well',rawName:'真实井别名',standardName:'JH-01'});
  const imported=ingRecordUpload(db,user,{projectId:'p1',wellId:'w1',objectType:'stratum',name:'用户资料.csv',size:100,hash:'real-hash',fileId:'real-file',encoding:'utf-8'});
  ingSetParsed(db,imported.jobId,ingParse('井名,层位,顶深,底深,深度单位,深度类型,参考基准\n真实井别名,长 8₁,100,108,m,MD,KB\n','csv'));
  ingMutation(db,user,'validate',{assetId:imported.assetId,versionId:imported.versionId});const before=JSON.stringify(ingDetail(db,user,imported.assetId));
  ingSeedDemo(db);assert.equal(JSON.stringify(ingDetail(db,user,imported.assetId)),before);const real=db.assets.find(asset=>asset.id===imported.assetId);assert.equal(ingStandards(db,real).aliases.length,1);assert.equal(real.quality,'通过');
  const demo=db.assets.find(asset=>asset.demoKey==='p1-w1-stratum'),demoAlias=db.ingestion.aliases.find(alias=>alias.demo&&alias.wellId==='w1'&&alias.kind==='layer');const realRevision=ingMappingRevision(db,real);
  ingMutation(db,user,'alias',{id:demoAlias.id,projectId:'p1',wellId:'w1',kind:'layer',rawName:demoAlias.rawName,standardName:'长 8₂',expectedRevision:demoAlias.revision});assert.equal(ingMappingRevision(db,real),realRevision);assert.equal(real.quality,'通过');assert.equal(demo.status,'待重新标准化');assert.equal(db.ingestion.aliases.find(alias=>alias.id===demoAlias.id).demo,true);
  assert.ok(!ingStandards(db,demo).aliases.some(alias=>alias.rawName==='真实井别名'));
});

test('示例记录只进入未改动的内置示例项目，访问仍遵循原有授权',()=>{
  const db=makeDatabase();db.projects[0].name='用户真实项目';const fixtures=ingDemoFixtures(db);assert.ok(fixtures.every(fixture=>fixture.projectId==='p2'));ingSeedDemo(db);assert.ok(!db.assets.some(asset=>asset.demo&&asset.projectId==='p1'));
  const fresh=makeDatabase();ingSeedDemo(fresh);const reader=fresh.users.find(user=>user.account==='reader');const dashboard=ingDashboard(fresh,reader,'p1');assert.equal(dashboard.jobs.length,0);assert.equal(dashboard.aliases.length,0);assert.equal(dashboard.handoffs.length,0);assert.ok(dashboard.assets.filter(asset=>asset.demo).every(asset=>!asset.contentAllowed));
});

test('本机启动自动补齐已有空库，原件与摘要一致，重启保留记录且不重复',async()=>{
  const root=fileURLToPath(new URL('..',import.meta.url)),dir=await fs.mkdtemp(path.join(root,'tests','.demo-'));const dataFile=path.join(dir,'db.json');let server;
  try{
    server=await createApp({root,dataFile});const first=JSON.parse(await fs.readFile(dataFile,'utf8')).db;const files=await fs.readdir(path.join(dir,'ingestion','files'));assert.equal(files.length,17);
    for(const version of first.ingestion.versions){const bytes=await fs.readFile(path.join(dir,'ingestion','files',version.fileId+'.bin'));assert.equal(createHash('sha256').update(bytes).digest('hex'),version.hash);assert.equal(bytes.length,version.size);}
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
    const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({account:'admin',password:'GeoDemo!2026'})});const cookie=login.headers.get('set-cookie').split(';')[0];const response=await fetch(base+'/api/ingestion?projectId=p1',{headers:{Cookie:cookie}});const dashboard=await response.json();assert.equal(dashboard.jobs.length,10);assert.equal(dashboard.aliases.length,12);assert.equal(dashboard.handoffs.length,3);
    const asset=dashboard.assets.find(item=>item.demo&&item.quality==='通过');const detail=await (await fetch(base+'/api/ingestion/assets/'+asset.id,{headers:{Cookie:cookie}})).json();assert.equal(detail.versions.length,2);assert.equal((await fetch(base+'/api/ingestion/files/'+detail.versions[0].id,{headers:{Cookie:cookie}})).status,200);
    await new Promise(resolve=>server.close(resolve));server=await createApp({root,dataFile});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const second=JSON.parse(await fs.readFile(dataFile,'utf8')).db;assert.deepEqual(second.ingestion,first.ingestion);assert.equal(second.assets.length,first.assets.length);assert.equal((await fs.readdir(path.join(dir,'ingestion','files'))).length,17);
  }finally{if(server?.listening)await new Promise(resolve=>server.close(resolve));assert.ok(path.resolve(dir).startsWith(path.resolve(root,'tests')+path.sep));await fs.rm(dir,{recursive:true,force:true});}
});
