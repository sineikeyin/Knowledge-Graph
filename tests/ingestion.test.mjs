import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {makeDatabase} from '../src/access-model.js';
import {ingParse,ingGuess,ingNormalize,ingValidate} from '../src/ingestion-core.js';
import {ingEnsure,ingRecordUpload,ingSetParsed,ingMutation,ingDetail,ingDashboard,ingStandards} from '../src/ingestion-model.js';
import {createApp} from '../server/app.mjs';
const csv='井名,层位,顶深,底深,深度单位,深度类型,参考基准\r\nJH-01,长 8₁,100,108,m,MD,KB\r\n';
function fixture(text=csv){const db=makeDatabase(),user=db.users[0];ingEnsure(db);const imported=ingRecordUpload(db,user,{projectId:'p1',wellId:'w1',objectType:'stratum',name:'分层.csv',hash:'test-hash',fileId:'test',size:text.length,encoding:'utf-8'});ingSetParsed(db,imported.jobId,ingParse(text,'csv'));const body={assetId:imported.assetId,versionId:imported.versionId};return {db,user,body,asset:db.assets.find(item=>item.id===body.assetId)};}
test('CSV 支持 BOM、引号内逗号和换行，保存物理行号；拒绝畸形表头和嵌套 JSON',()=>{
  const parsed=ingParse('\uFEFFa,b\r\n"x,y","line1\nline2"\r\nz,q\r\n','csv');assert.deepEqual(parsed.rows,[['x,y','line1\nline2'],['z','q']]);assert.deepEqual(parsed.locations,[2,4]);
  for(const text of ['a,a\n1,2','a,b\n1','a,b\n"unfinished,2'])assert.throws(()=>ingParse(text,'csv'));
  assert.deepEqual(ingParse('{"records":[{"井名":"JH-01","顶深":12}]}','json').headers,['井名','顶深']);assert.throws(()=>ingParse('[{"a":{"nested":1}}]','json'),/不能嵌套/);
});
test('深度单位换算保留原值，缺失基准、无效井与未知层位产生阻断',()=>{
  const {db,asset}=fixture();const scope=ingStandards(db,asset);const parsed=ingParse('井名,层位,顶深,底深,深度单位,深度类型,参考基准\nJH-01,长 8₁,100,110,ft,TVD,海平面\n','csv');const rows=ingNormalize(parsed,'stratum',{fields:ingGuess(parsed.headers,'stratum')},scope);assert.equal(rows[0].record.top,30.48);assert.equal(rows[0].record.rawUnit,'ft');assert.equal(rows[0].record.depthType,'TVD');assert.equal(rows[0].raw[2],'100');assert.equal(ingValidate(rows,'stratum',scope).status,'通过');
  rows[0].record.datum='未知';rows[0].record.wellId='';rows[0].record.layer='未知层';const result=ingValidate(rows,'stratum',scope);assert.equal(result.status,'阻断');assert.ok(result.issues.some(issue=>issue.rule==='basis'));assert.ok(result.issues.some(issue=>issue.field==='well'));assert.ok(result.issues.some(issue=>issue.field==='layer'));
});
test('重叠、重复区间被定位；无规则适用时显示不适用',()=>{
  const {db,asset}=fixture();const scope=ingStandards(db,asset),parsed=ingParse(csv+'JH-01,长 8₁,104,110,m,MD,KB\nJH-01,长 8₁,104,110,m,MD,KB\n','csv');const rows=ingNormalize(parsed,'stratum',{fields:ingGuess(parsed.headers,'stratum')},scope);const result=ingValidate(rows,'stratum',scope);assert.equal(result.status,'阻断');assert.ok(result.issues.some(issue=>issue.location===3&&issue.message.includes('重叠')));assert.ok(result.issues.some(issue=>issue.message.includes('重复')));assert.equal(result.checks.find(check=>check.id==='time').status,'不适用');assert.equal(result.checks.find(check=>check.id==='curve').status,'不适用');
});
test('非法可选厚度不能被自动推导掩盖，曲线警告提交需要人工确认',()=>{
  const {db,user,asset}=fixture();const invalid=ingParse('井名,层位,顶深,底深,厚度,深度单位,深度类型,参考基准\nJH-01,长 8₁,100,108,abc,m,MD,KB\n','csv');const rows=ingNormalize(invalid,'stratum',{fields:ingGuess(invalid.headers,'stratum')},ingStandards(db,asset));assert.equal(rows[0].record.thickness,null);assert.equal(ingValidate(rows,'stratum',ingStandards(db,asset)).status,'阻断');
  const imported=ingRecordUpload(db,user,{projectId:'p1',wellId:'w1',objectType:'log',name:'曲线.csv',hash:'log',fileId:'log',size:100});ingSetParsed(db,imported.jobId,ingParse('井名,井深,曲线名,曲线值,曲线单位,深度单位,深度类型,参考基准\nJH-01,100,GR,80,API,m,MD,KB\nJH-01,101,GR,200,API,m,MD,KB\n','csv'));const body={assetId:imported.assetId,versionId:imported.versionId};assert.equal(ingMutation(db,user,'validate',{...body,options:{max:100,maxJump:50}}).status,'警告');assert.throws(()=>ingMutation(db,user,'handoff',body),/确认问题/);assert.equal(ingMutation(db,user,'handoff',{...body,confirmWarnings:true}).warningsConfirmed,true);
});
test('标准数据修改生成新版本，旧数据与质量结果保留；阻断版本不能构建知识',()=>{
  const {db,user,body}=fixture();assert.throws(()=>ingMutation(db,user,'handoff',body),/尚未通过/);const first=ingMutation(db,user,'validate',body);assert.equal(first.status,'通过');const handoff=ingMutation(db,user,'handoff',body);assert.equal(ingMutation(db,user,'handoff',body).id,handoff.id);
  const next=ingMutation(db,user,'correct',{...body,row:1,field:'bottom',value:'90'});assert.notEqual(next.versionId,body.versionId);const detail=ingDetail(db,user,body.assetId);assert.equal(detail.versions[0].rows[0].record.bottom,108);assert.equal(detail.versions[0].qualityRuns[0].status,'通过');assert.equal(detail.versions[1].qualityRuns.length,0);assert.equal(detail.versions[1].hash,detail.versions[0].hash);assert.equal(detail.versions[1].parentId,body.versionId);
  assert.throws(()=>ingMutation(db,user,'validate',body),/版本已变化/);const bad=ingMutation(db,user,'validate',{...body,versionId:next.versionId});assert.equal(bad.status,'阻断');assert.throws(()=>ingMutation(db,user,'handoff',{...body,versionId:next.versionId}),/尚未通过/);assert.equal(detail.handoffs[0].versionId,body.versionId);
});
test('别名冲突检查与映射失效：新映射必须重新标准化和校验',()=>{
  const {db,user,body,asset}=fixture(csv.replace('长 8₁,100','长8一,100'));assert.equal(ingMutation(db,user,'validate',body).status,'阻断');const alias=ingMutation(db,user,'alias',{projectId:'p1',wellId:'w1',kind:'layer',rawName:'长8一',standardName:'长 8₁'});
  assert.throws(()=>ingMutation(db,user,'alias',{projectId:'p1',wellId:'w1',kind:'layer',rawName:'长8一',standardName:'长 8₂'}),/其他映射/);assert.throws(()=>ingMutation(db,user,'validate',body),/重新标准化/);
  const current=db.ingestion.versions[0];const next=ingMutation(db,user,'standardize',{...body,fields:current.config.fields,defaults:{}});assert.equal(ingMutation(db,user,'validate',{...body,versionId:next.versionId}).status,'通过');assert.equal(db.ingestion.versions.at(-1).rows[0].record.layer,'长 8₁');
  ingMutation(db,user,'alias',{projectId:'p1',wellId:'w1',kind:'layer',rawName:'长8一',standardName:'长 8₂',expectedRevision:alias.revision});assert.equal(ingDashboard(db,user,'p1').assets.find(item=>item.id===asset.id).mappingStale,true);assert.throws(()=>ingMutation(db,user,'handoff',{...body,versionId:next.versionId}),/重新标准化/);
});
test('资料详情、任务、问题和交接遵循字段授权，伪造归属与越权导入被拒绝',()=>{
  const {db,user,body}=fixture();ingMutation(db,user,'validate',body);ingMutation(db,user,'handoff',body);const reader=db.users.find(item=>item.account==='reader');const view=ingDashboard(db,reader,'p1');assert.equal(view.jobs.length,0);assert.equal(view.handoffs.length,0);assert.equal(ingDetail(db,reader,body.assetId).versions.length,0);assert.throws(()=>ingMutation(db,reader,'correct',{...body,row:1,field:'top',value:'1'}),/无权/);
  assert.throws(()=>ingRecordUpload(db,user,{projectId:'p1',wellId:'w4',objectType:'stratum'}),/归属不匹配/);const engineer=db.users.find(item=>item.account==='engineer');assert.throws(()=>ingRecordUpload(db,engineer,{projectId:'p1',wellId:'w3',objectType:'stratum'}),/无权/);assert.throws(()=>ingMutation(db,engineer,'handoff',body),/无权/);
  db.grants.push({id:'restrict-asset',userId:engineer.id,projectId:'p1',resourceType:'document',resourceId:body.assetId,actions:['view'],hiddenFields:['source']});assert.equal(ingDetail(db,engineer,body.assetId).versions.length,0);
});
test('HTTP 真实文件上传、超 64KB 文件、CSRF、去重、映射与持久化重启',async()=>{
  const root=fileURLToPath(new URL('..',import.meta.url)),dir=await fs.mkdtemp(path.join(root,'tests','.ingestion-')),dataFile=path.join(dir,'db.json');let server,base;
  const start=async()=>{server=await createApp({root,dataFile});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${server.address().port}`;};
  async function json(endpoint,auth={},body){const response=await fetch(base+'/api'+endpoint,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),...(auth.cookie?{Cookie:auth.cookie}:{}),...(auth.csrf?{'X-CSRF-Token':auth.csrf}:{})},body:body?JSON.stringify(body):undefined});return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};}
  const login=async account=>{const result=await json('/auth/login',{}, {account,password:'GeoDemo!2026'});return {cookie:result.cookie,csrf:result.data.csrf};};
  async function upload(auth,content,name='真实上传.csv',config){const response=await fetch(base+'/api/ingestion/upload?'+new URLSearchParams({projectId:'p1',wellId:'w1',objectType:'stratum',name}),{method:'POST',headers:{'Content-Type':'application/octet-stream',Cookie:auth.cookie,...(auth.csrf?{'X-CSRF-Token':auth.csrf}:{}),...(config?{'X-Import-Config':encodeURIComponent(JSON.stringify(config))}:{})},body:content});return {status:response.status,data:await response.json()};}
  const wait=async(auth,id)=>{for(let i=0;i<100;i++){const result=await json('/ingestion/assets/'+id,auth);if(['待校验','解析失败','处理完成'].includes(result.data.asset.status))return result.data;await new Promise(resolve=>setTimeout(resolve,20));}throw Error('Parse timeout');};
  try{
    await start();const auth=await login('admin'),reader=await login('reader');assert.equal((await upload({cookie:auth.cookie},csv)).status,403);assert.equal((await upload(reader,csv)).status,403);
    const big=csv+Array.from({length:2300},(_,i)=>`JH-01,长 8₁,${200+i*10},${208+i*10},m,MD,KB\n`).join('');assert.ok(Buffer.byteLength(big)>65536);const added=await upload(auth,big);assert.equal(added.status,202);const detail=await wait(auth,added.data.assetId);assert.equal(detail.versions[0].rows.length,2301);assert.equal(detail.versions[0].fileId,undefined);
    const file=await fetch(base+'/api/ingestion/files/'+added.data.versionId,{headers:{Cookie:auth.cookie}});assert.equal(file.status,200);assert.equal(await file.text(),big);assert.equal((await fetch(base+'/api/ingestion/files/'+added.data.versionId,{headers:{Cookie:reader.cookie}})).status,403);
    const duplicate=await upload(auth,big);assert.equal(duplicate.data.assetId,added.data.assetId);assert.equal(duplicate.data.duplicate,true);
    assert.equal((await json('/ingestion/validate',auth,{assetId:added.data.assetId,versionId:added.data.versionId})).data.status,'通过');const handoff=await json('/ingestion/handoff',auth,{assetId:added.data.assetId,versionId:added.data.versionId});assert.equal(handoff.status,200);
    const custom='a,b,c,d\nJH-01,长 8₁,100,108\n';const config={fields:{well:'a',layer:'b',top:'c',bottom:'d'},defaults:{unit:'m',depthType:'MD',datum:'KB'}};const configured=await upload(auth,custom,'自定义字段.csv',config);const configuredDetail=await wait(auth,configured.data.assetId);assert.equal(configuredDetail.versions[0].rows[0].record.datum,'KB');
    const bad=await upload(auth,'not parsed','unsupported.pdf');assert.equal((await wait(auth,bad.data.assetId)).asset.status,'解析失败');assert.equal((await json('/ingestion/retry',auth,{assetId:bad.data.assetId,versionId:bad.data.versionId})).status,200);await wait(auth,bad.data.assetId);
    assert.equal((await fetch(base+'/.runtime/ingestion/files/test.bin')).status,404);
    await new Promise(resolve=>server.close(resolve));await start();const newAuth=await login('admin');const persisted=await json('/ingestion/assets/'+added.data.assetId,newAuth);assert.equal(persisted.data.handoffs[0].id,handoff.data.id);assert.equal(persisted.data.versions[0].qualityRuns[0].status,'通过');const persistedFile=await fetch(base+'/api/ingestion/files/'+added.data.versionId,{headers:{Cookie:newAuth.cookie}});assert.equal(await persistedFile.text(),big);
  }finally{if(server?.listening)await new Promise(resolve=>server.close(resolve));assert.ok(path.resolve(dir).startsWith(path.resolve(root,'tests')+path.sep));await fs.rm(dir,{recursive:true,force:true});}
});
