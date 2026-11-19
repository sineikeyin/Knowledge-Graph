import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {makeDatabase} from '../src/access-model.js';
import {kcEnsure} from '../src/construction-model.js';
import {gmEnsure} from '../src/graph-model.js';
import {ingDemoFixtures,ingDemoSeedVersion,ingSeedDemo} from '../src/ingestion-demo.js';
import {slCleanText,slCleanDatabase,slHasLegacy} from '../src/sample-labels.js';
import {prepareSampleLabelCleanup} from '../server/sample-labels.mjs';
import {createApp} from '../server/app.mjs';

const labelTestRoot=fileURLToPath(new URL('..',import.meta.url)),legacyLabel=String.fromCodePoint(0x6f14,0x793a),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const addOldPrefixes=text=>text.replace(/(?:JH-\d+|SL-\d+)旧井名|长 8[₁₂]旧层名|扶余油层旧层名|砂岩旧称|示例区块 [AB]旧区块名|待确认层位/g,value=>`[${legacyLabel}] ${value}`);
async function labelFixture(){
  const dir=await fs.mkdtemp(path.join(labelTestRoot,'tests','.labels-')),dataFile=path.join(dir,'platform.json'),files=path.join(dir,'ingestion','files');await fs.mkdir(files,{recursive:true});
  const db=makeDatabase(),fixtures=ingDemoFixtures(db),manifest={};kcEnsure(db);gmEnsure(db);
  for(const fixture of fixtures){const digest=hash(`${ingDemoSeedVersion}:${fixture.key}`),fileId=`${digest.slice(0,8)}-${digest.slice(8,12)}-${digest.slice(12,16)}-${digest.slice(16,20)}-${digest.slice(20,32)}`,bytes=Buffer.from(fixture.text);manifest[fixture.key]={fileId,hash:hash(bytes),size:bytes.length};await fs.writeFile(path.join(files,fileId+'.bin'),bytes);}
  ingSeedDemo(db,manifest,fixtures);
  const rewrite=value=>{if(typeof value==='string')return addOldPrefixes(value);if(Array.isArray(value))return value.map(rewrite);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,rewrite(item)]));return value;};
  const state={db:rewrite(db),passwords:{u1:'unchanged-private-password-hash'}};
  for(const fixture of fixtures){const fileId=manifest[fixture.key].fileId,bytes=Buffer.from(addOldPrefixes(fixture.text));await fs.writeFile(path.join(files,fileId+'.bin'),bytes);for(const v of state.db.ingestion.versions.filter(v=>v.fileId===fileId)){v.hash=hash(bytes);v.size=bytes.length;}}
  const source=state.db.ingestion.versions.find(v=>v.assetId===state.db.assets.find(a=>a.demoKey==='p1-w1-stratum').id),raw=`井名: [${legacyLabel}] JH-01旧井名 | 顶深: 100`,start=raw.indexOf('JH-01旧井名'),evidence={assetId:source.assetId,versionId:source.id,raw,span:{start,end:start+9}};
  state.db.construction.tasks.push({id:'LABEL-TASK',projectId:'p1',status:'published',createdBy:'u1',sources:[{assetId:source.assetId,versionId:source.id,hash:source.hash,parsed:source.parsed,rows:source.rows}],candidates:[{evidence}],revision:1});
  const fact={id:'LABEL-FACT',projectId:'p1',kind:'entity',typeId:'well',typeName:'井',name:'JH-01',value:{code:'JH-01'},assetId:source.assetId,evidence,active:true,publicationId:'LABEL-PUB'};
  state.db.construction.facts.push(fact);state.db.construction.publications.push({id:'LABEL-PUB',taskId:'LABEL-TASK',projectId:'p1',publishedAt:'2026-11-19T12:10:00Z',publishedBy:'平台管理员',factIds:[fact.id]});state.db.graph.snapshots.push({id:'LABEL-SNAPSHOT',projectId:'p1',facts:[fact]});
  state.db.audit.push({id:'LABEL-AUDIT',details:{source:`系统${legacyLabel}资料`,hash:source.hash},time:'2026-11-19T12:00:00Z'});
  const uploaded=Buffer.from('用户真实原件，保持字节不变。\n'),userId='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';await fs.writeFile(path.join(files,userId+'.bin'),uploaded);
  state.db.assets.push({id:'USER-ASSET',projectId:'p1',wellId:'w1',objectType:'stratum',name:'用户资料.csv',managed:true});state.db.ingestion.versions.push({id:'USER-VERSION',assetId:'USER-ASSET',fileId:userId,fileName:'用户资料.csv',hash:hash(uploaded),size:uploaded.length,qualityRuns:[],number:1});
  await fs.writeFile(dataFile,JSON.stringify(state));
  return {dir,dataFile,files,state,userId,uploaded,source,async cleanup(){assert.ok(path.resolve(dir).startsWith(path.resolve(labelTestRoot,'tests')+path.sep));await fs.rm(dir,{recursive:true,force:true});}};
}

test('样本旧标签清理覆盖不同括号、普通文案、HTML编码、索引键及证据高亮位置',()=>{
  for(const marker of [`[${legacyLabel}] `,`【${legacyLabel}】`,`（${legacyLabel}）`])assert.equal(slCleanText(marker+'JH-01'),'JH-01');assert.equal(slCleanText('系统'+legacyLabel+'资料'),'系统示例资料');assert.equal(slCleanText('&#x6f14;'+'&#x793a;'),'示例');
  const raw=`井名: [${legacyLabel}] JH-01旧井名`,start=raw.indexOf('JH-01'),value={evidence:{raw,span:{start,end:raw.length}},index:{[legacyLabel]:['fact-id']},sequence:71};
  assert.ok(slCleanDatabase(value).changed);assert.equal(value.evidence.raw.slice(value.evidence.span.start,value.evidence.span.end),'JH-01旧井名');assert.deepEqual(value.index,{'示例':['fact-id']});assert.equal(value.sequence,71);const saved=JSON.stringify(value);assert.equal(slCleanDatabase(value).changed,false);assert.equal(JSON.stringify(value),saved);
  assert.throws(()=>slCleanDatabase({[legacyLabel]:1,'示例':2}),/重名字段/);
});
test('样本迁移同步原件、字节大小、版本及任务摘要，保留ID、用户原件和完整外部备份',async()=>{
  const f=await labelFixture();try{
    const plan=await prepareSampleLabelCleanup({db:f.state.db,directory:f.dir,dataFile:f.dataFile,backupRoot:path.join(f.dir,'backups')});assert.ok(plan.changed);assert.ok(plan.summary.changedFiles>0);assert.ok(!slHasLegacy(JSON.stringify(plan.db)));assert.ok(slHasLegacy(JSON.stringify(f.state.db)));assert.deepEqual(plan.db.assets.map(a=>a.id),f.state.db.assets.map(a=>a.id));assert.deepEqual(plan.db.ingestion.versions.map(v=>[v.id,v.parentId,v.fileId]),f.state.db.ingestion.versions.map(v=>[v.id,v.parentId,v.fileId]));assert.equal(plan.db.construction.publications[0].id,'LABEL-PUB');
    await plan.apply();assert.ok(slHasLegacy(await fs.readFile(path.join(plan.backupDirectory,'platform-before.json'),'utf8')));assert.deepEqual(await fs.readFile(path.join(f.files,f.userId+'.bin')),f.uploaded);
    for(const v of plan.db.ingestion.versions){const bytes=await fs.readFile(path.join(f.files,v.fileId+'.bin'));assert.equal(v.hash,hash(bytes));assert.equal(v.size,bytes.length);if(v.demo)assert.ok(!slHasLegacy(bytes.toString('utf8')));}
    const taskSource=plan.db.construction.tasks[0].sources[0],version=plan.db.ingestion.versions.find(v=>v.id===taskSource.versionId);assert.equal(taskSource.hash,version.hash);assert.equal(plan.db.audit.at(-1).details.hash,version.hash);assert.ok(!slHasLegacy(plan.db.graph.snapshots[0].facts[0].evidence.raw));
  }finally{await f.cleanup();}
});
test('启动自动清理旧样本且重复启动不增殖，发布记录、凭据和版本链保持完整',async()=>{
  const f=await labelFixture();let server;try{
    server=await createApp({root:labelTestRoot,dataFile:f.dataFile,labelBackupRoot:path.join(f.dir,'backups')});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));await new Promise(resolve=>server.close(resolve));
    const first=JSON.parse(await fs.readFile(f.dataFile,'utf8'));assert.ok(!slHasLegacy(JSON.stringify(first.db)));assert.deepEqual(first.passwords,f.state.passwords);assert.equal(first.db.assets.length,f.state.db.assets.length);assert.equal(first.db.construction.publications.length,1);assert.equal(first.db.construction.facts[0].id,'LABEL-FACT');assert.ok(first.db.sampleLabelCleanup.changedFiles>0);
    server=await createApp({root:labelTestRoot,dataFile:f.dataFile,labelBackupRoot:path.join(f.dir,'backups')});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));await new Promise(resolve=>server.close(resolve));const second=JSON.parse(await fs.readFile(f.dataFile,'utf8'));assert.deepEqual(second,first);assert.equal((await fs.readdir(path.join(f.dir,'backups'))).length,1);
  }finally{if(server?.listening)await new Promise(resolve=>server.close(resolve));await f.cleanup();}
});
test('迁移可回退原件，原件摘要不一致时提前拒绝且不覆盖数据',async()=>{
  const f=await labelFixture();try{
    const before=await fs.readFile(path.join(f.files,f.source.fileId+'.bin')),plan=await prepareSampleLabelCleanup({db:f.state.db,directory:f.dir,dataFile:f.dataFile,backupRoot:path.join(f.dir,'backups')});await plan.apply();assert.notDeepEqual(await fs.readFile(path.join(f.files,f.source.fileId+'.bin')),before);await plan.rollback();assert.deepEqual(await fs.readFile(path.join(f.files,f.source.fileId+'.bin')),before);
    await fs.writeFile(path.join(f.files,f.source.fileId+'.bin'),'invalid content');await assert.rejects(()=>prepareSampleLabelCleanup({db:f.state.db,directory:f.dir,dataFile:f.dataFile}),/摘要不一致/);assert.deepEqual(JSON.parse(await fs.readFile(f.dataFile,'utf8')),f.state);
  }finally{await f.cleanup();}
});
test('旧离线缓存自动清理任务、来源和快照，所有项目文本及新样本不包含旧标签',async()=>{
  const f=await labelFixture();try{
    const html=await fs.readFile(new URL('../首页预览.html',import.meta.url),'utf8'),script=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1],source=script.slice(0,script.indexOf('// ===== src/main.js =====')),memory=new Map([['geokg-offline-users-v1',JSON.stringify(f.state.db)]]),storage={getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)};
    const sandbox=vm.createContext({location:{protocol:'file:'},localStorage:storage,sessionStorage:storage,console,Date,URLSearchParams,window:{dispatchEvent(){}}});vm.runInContext(source,sandbox);await vm.runInContext("api('/auth/login',{account:'admin',password:'GeoDemo!2026'})",sandbox);const cached=JSON.parse(memory.get('geokg-offline-users-v1'));assert.ok(!slHasLegacy(JSON.stringify(cached)));assert.equal(cached.construction.publications[0].id,'LABEL-PUB');assert.equal(cached.construction.tasks[0].id,'LABEL-TASK');
    for(const fixture of ingDemoFixtures(makeDatabase()))assert.ok(!slHasLegacy(fixture.text));
    async function scan(dir){for(const entry of await fs.readdir(dir,{withFileTypes:true})){if(['.git','.runtime','node_modules'].includes(entry.name)||entry.name.startsWith('.labels-'))continue;const filename=path.join(dir,entry.name);assert.ok(!slHasLegacy(entry.name),filename);if(entry.isDirectory())await scan(filename);else if(/\.(?:js|mjs|json|md|html|css|csv|tsv|txt|las)$/i.test(entry.name))assert.ok(!slHasLegacy(await fs.readFile(filename,'utf8')),filename);}}
    await scan(labelTestRoot);
  }finally{await f.cleanup();}
});
