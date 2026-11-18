import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
test('离线预览语法完整，离线登录、管理页数据及退出可用',async()=>{
  const html=await fs.readFile(new URL('../首页预览.html',import.meta.url),'utf8');
  const script=html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];assert.ok(script);new vm.Script(script);
  const beforeMain=script.slice(0,script.indexOf('// ===== src/main.js ====='));
  const memory=new Map();const storage={getItem:key=>memory.get(key)||null,setItem:(key,value)=>memory.set(key,value),removeItem:key=>memory.delete(key)};
  const ctx=vm.createContext({location:{protocol:'file:'},localStorage:storage,sessionStorage:storage,console,Date,URLSearchParams,window:{dispatchEvent(){}}});
  vm.runInContext(beforeMain,ctx);const login=await vm.runInContext("api('/auth/login',{account:'admin',password:'GeoDemo!2026'})",ctx);assert.equal(login.user.id,'u1');
  const admin=await vm.runInContext("api('/admin')",ctx);assert.equal(admin.users.length,6);assert.equal(admin.roles.length,6);
  await vm.runInContext("api('/auth/logout',{})",ctx);await assert.rejects(()=>vm.runInContext("api('/auth/me')",ctx),/失效/);
});
