import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createApp} from '../server/app.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
test('真实HTTP登录、CSRF、字段过滤、凭据保护、持久化及会话撤销',async()=>{
  const dir=await fs.mkdtemp(path.join(root,'tests','.http-'));const dataFile=path.join(dir,'db.json');let server;
  try{
    server=await createApp({root,dataFile});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let base=`http://127.0.0.1:${server.address().port}`;
    async function call(url,{cookie,csrf,body,origin}={}){const response=await fetch(base+url,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{}),...(csrf?{'X-CSRF-Token':csrf}:{}),...(origin?{Origin:origin}:{})},body:body?JSON.stringify(body):undefined});const data=await response.json();return {status:response.status,data,cookie:response.headers.get('set-cookie')?.split(';')[0],headers:response.headers};}
    assert.equal((await call('/api/workspace')).status,401);
    const login=await call('/api/auth/login',{body:{account:'admin',password:'GeoDemo!2026'}});assert.equal(login.status,200);assert.match(login.headers.get('set-cookie'),/HttpOnly/);const auth={cookie:login.cookie,csrf:login.data.csrf};assert.ok(!JSON.stringify(login.data).includes('password'));
    assert.equal((await call('/api/users',{cookie:auth.cookie,body:{}})).status,403);
    assert.equal((await call('/api/roles',{...auth,body:{},origin:'https://evil.example'})).status,403);
    for(const url of ['/.runtime/platform.json','/src/sample-data.js','/server/app.mjs'])assert.equal((await call(url)).status,404);
    const reader=await call('/api/auth/login',{body:{account:'reader',password:'GeoDemo!2026'}});const readerAuth={cookie:reader.cookie,csrf:reader.data.csrf};const visible=await call('/api/workspace',readerAuth);assert.equal(visible.data.wells.length,1);assert.equal(visible.data.wells[0].depth,undefined);
    assert.equal((await call('/api/business/import',{...readerAuth,body:{projectId:'p1',wellId:'w1',name:'denied',type:'地层'}})).status,403);
    const newUser=await call('/api/users',{...auth,body:{account:'testuser',name:'验证用户',orgId:'org2',roleId:'reader',enabled:true,password:'TestPassword!2026'}});assert.equal(newUser.status,200);
    const newLogin=await call('/api/auth/login',{body:{account:'testuser',password:'TestPassword!2026'}});assert.equal(newLogin.status,200);
    const disabled=await call('/api/users',{...auth,body:{id:newUser.data.id,account:'testuser',name:'验证用户',orgId:'org2',roleId:'reader',enabled:false}});assert.equal(disabled.status,200);assert.equal((await call('/api/auth/me',{cookie:newLogin.cookie})).status,401);
    const disk=await fs.readFile(dataFile,'utf8');assert.ok(!disk.includes('GeoDemo!2026'));assert.ok(!disk.includes('TestPassword!2026'));
    await new Promise(resolve=>server.close(resolve));server=await createApp({root,dataFile});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${server.address().port}`;assert.equal((await call('/api/auth/me',auth)).status,401);assert.equal((await call('/api/auth/login',{body:{account:'testuser',password:'TestPassword!2026'}})).status,403);
  }finally {if(server?.listening)await new Promise(resolve=>server.close(resolve));const resolved=path.resolve(dir);assert.ok(resolved.startsWith(path.resolve(root,'tests')+path.sep));await fs.rm(resolved,{recursive:true,force:true});}
});
test('到期会话不能继续访问接口',async()=>{const dir=await fs.mkdtemp(path.join(root,'tests','.expire-'));let server;try{server=await createApp({root,dataFile:path.join(dir,'db.json'),sessionTtl:1});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;const response=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({account:'admin',password:'GeoDemo!2026'})});const cookie=response.headers.get('set-cookie').split(';')[0];await new Promise(resolve=>setTimeout(resolve,5));assert.equal((await fetch(base+'/api/auth/me',{headers:{Cookie:cookie}})).status,401);}finally{if(server?.listening)await new Promise(resolve=>server.close(resolve));const resolved=path.resolve(dir);assert.ok(resolved.startsWith(path.resolve(root,'tests')+path.sep));await fs.rm(resolved,{recursive:true,force:true});}});
