import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes,scryptSync,timingSafeEqual} from 'node:crypto';
import {makeDatabase,activeUser,identity,workspace,adminView,mutate,business,auditEvent,fault,clone} from '../src/access-model.js';
import {createIngestion} from './ingestion.mjs';
import {createConstruction} from './construction.mjs';
import {ontoEnsure,ontoDashboard,ontoPublished,ontoMutation,ontoImpact} from '../src/ontology-model.js';
import {gmEnsure,gmSeedDemo,gmDashboard,gmQuery,gmMutation} from '../src/graph-model.js';
import {prepareSampleLabelCleanup} from './sample-labels.mjs';

export function passwordHash(password,salt=randomBytes(16).toString('hex')) {return `${salt}:${scryptSync(password,salt,64).toString('hex')}`;}
export function passwordMatches(password,stored='') {const [salt,hash]=stored.split(':');if(!salt||!hash)return false;const actual=scryptSync(password,salt,64);const expected=Buffer.from(hash,'hex');return actual.length===expected.length&&timingSafeEqual(actual,expected);}
export async function createApp({root,dataFile,sessionTtl=30*60*1000,labelBackupRoot}={}) {
  root=path.resolve(root);
  let state;try {state=JSON.parse(await fs.readFile(dataFile,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;state={db:makeDatabase(),passwords:{}};for(const user of state.db.users)state.passwords[user.id]=passwordHash('GeoDemo!2026');}
  const labelCleanup=await prepareSampleLabelCleanup({db:state.db,directory:path.dirname(dataFile),dataFile,backupRoot:labelBackupRoot});state.db=labelCleanup.db;
  ontoEnsure(state.db);
  gmEnsure(state.db);for(const project of state.db.projects)gmSeedDemo(state.db,project.id);
  const sessions=new Map(),attempts=new Map();let commits=Promise.resolve();
  const persist=async()=>{await fs.mkdir(path.dirname(dataFile),{recursive:true});const tmp=dataFile+'.tmp';await fs.writeFile(tmp,JSON.stringify(state,null,2));await fs.rename(tmp,dataFile);};
  try{await labelCleanup.apply();if(labelCleanup.changed)state.db.sampleLabelCleanup={version:1,completedAt:new Date().toISOString(),...labelCleanup.summary};await persist();}catch(error){await labelCleanup.rollback();throw error;}
  const commit=operation=>{const next=commits.then(async()=>{const before=clone(state);try {const result=operation();await persist();return result;}catch(error){state=before;throw error;}});commits=next.catch(()=>{});return next;};
  const ingestion=await createIngestion({directory:path.join(path.dirname(dataFile),'ingestion'),getDb:()=>state.db,commit:operation=>commit(()=>operation(state.db))});
  const construction=await createConstruction({getDb:()=>state.db,commit:operation=>commit(()=>operation(state.db))});
  const handler=async(req,res)=>{
    const requestId='REQ-'+randomBytes(9).toString('hex');
    let auditUser=null;
    res.setHeader('X-Request-Id',requestId);res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','same-origin');
    const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
    try {
      if(!/^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(req.headers.host||''))fault('仅接受本机地址。',403);
      const url=new URL(req.url,'http://localhost');const pathname=decodeURIComponent(url.pathname);
      if(pathname==='/首页预览.html'){res.writeHead(302,{Location:'/'});res.end();return;}
      if(!pathname.startsWith('/api/')) {
        if(!['GET','HEAD'].includes(req.method))fault('Method not allowed',405);
        const relative=pathname==='/'?'index.html':pathname.slice(1);
        const publicFiles=['index.html','src/main.js','src/data.js','src/icons.js','src/rules.js','src/styles.css','src/api.js','src/users.js','src/ingestion.js','src/ingestion-core.js','src/ontology.js','src/ontology-core.js','src/las-core.js','src/construction.js','src/construction-core.js','src/graph.js','src/graph-core.js'];
        if(!publicFiles.includes(relative)&&!/^assets\/[a-zA-Z0-9_.-]+\.svg$/.test(relative)&&relative!=='docs/页面搭建步骤.html')fault('File unavailable',404);
        const file=path.resolve(root,relative);if(!file.startsWith(root+path.sep))fault('Forbidden',403);
        const content=await fs.readFile(file);const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
        res.writeHead(200,{'Content-Type':types[path.extname(file)]||'text/plain'});res.end(req.method==='HEAD'?undefined:content);return;
      }
      if(!['GET','POST'].includes(req.method))fault('请求方法不支持。',405);
      const origin=req.headers.origin;if(origin&&origin!==`http://${req.headers.host}`&&origin!==`https://${req.headers.host}`)fault('请求来源不允许。',403);
      if(req.headers['sec-fetch-site']==='cross-site')fault('跨站请求不允许。',403);
      let body={};if(req.method==='POST'&&pathname!=='/api/ingestion/upload') {
        if(!req.headers['content-type']?.startsWith('application/json'))fault('仅接受JSON请求。',415);
        let bytes=0;const chunks=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>(['/api/ontology/save','/api/construction/sample'].includes(pathname)?1024*1024:65536))fault('请求过大。',413);chunks.push(chunk);}
        try {body=JSON.parse(Buffer.concat(chunks).toString()||'{}');}catch{fault('JSON格式错误。');}if(!body||Array.isArray(body)||typeof body!=='object')fault('请求格式错误。');
      }
      await commits;
      const token=req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('geokg_session='))?.slice(14);
      if(pathname==='/api/auth/login'&&req.method==='POST') {
        const key=req.socket.remoteAddress||'local';const recent=(attempts.get(key)||[]).filter(t=>Date.now()-t<60000);if(recent.length>=10)fault('尝试次数过多，请一分钟后重试。',429);recent.push(Date.now());attempts.set(key,recent);
        const user=state.db.users.find(u=>u.account===String(body.account));const valid=passwordMatches(String(body.password||''),user?state.passwords[user.id]:passwordHash('invalid-password'));
        if(!user||!valid){await commit(()=>auditEvent(state.db,null,'登录失败','登录',{}, {requestId,result:'失败'}));fault('账号或密码不正确。',401);}
        if(!user.enabled)fault('账号已停用，请联系管理员。',403);
        const sessionToken=randomBytes(32).toString('hex');const session={userId:user.id,csrf:randomBytes(24).toString('hex'),expires:Date.now()+sessionTtl};
        await commit(()=>{user.lastLogin=new Date().toISOString();auditEvent(state.db,user,'登录','会话',{}, {requestId});});
        if(token)sessions.delete(token);sessions.set(sessionToken,session);attempts.delete(key);
        res.setHeader('Set-Cookie',`geokg_session=${sessionToken}; HttpOnly; SameSite=Strict; Path=/${req.socket.encrypted?'; Secure':''}`);send(200,{user:identity(state.db,user),csrf:session.csrf,expires:session.expires});return;
      }
      const session=sessions.get(token);if(!session||session.expires<=Date.now()){sessions.delete(token);fault('登录已失效，请重新登录。',401);}
      const user=activeUser(state.db,session.userId);auditUser=user;if(req.method==='POST'&&req.headers['x-csrf-token']!==session.csrf)fault('请求校验失败，请刷新页面。',403);
      if(pathname.startsWith('/api/ingestion')&&await ingestion.handle({req,res,url,user,body,requestId,send}))return;
      if(pathname.startsWith('/api/construction')&&await construction.handle({req,res,url,user,body,requestId,send}))return;
      if(pathname==='/api/graph'&&req.method==='GET'){send(200,gmDashboard(state.db,user,url.searchParams.get('projectId'),url.searchParams.get('dataset')||'published'));return;}
      const graphQuery=pathname.match(/^\/api\/graph\/(paths|spatial|similar|history)$/);
      if(graphQuery&&req.method==='POST'){send(200,gmQuery(state.db,user,graphQuery[1],body));return;}
      const graphMutation=pathname.match(/^\/api\/graph\/(algorithm|spatial-save|snapshot|restore)$/);
      if(graphMutation&&req.method==='POST'){send(200,await commit(()=>gmMutation(state.db,user,graphMutation[1],body,{requestId})));return;}
      if(pathname==='/api/auth/me'&&req.method==='GET'){send(200,{user:identity(state.db,user),csrf:session.csrf,expires:session.expires});return;}
      if(pathname==='/api/auth/logout'&&req.method==='POST'){await commit(()=>auditEvent(state.db,user,'退出登录','会话',{}, {requestId}));sessions.delete(token);res.setHeader('Set-Cookie','geokg_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');send(200,{ok:true});return;}
      if(pathname==='/api/workspace'&&req.method==='GET'){send(200,workspace(state.db,user));return;}
      if(pathname==='/api/ontology'&&req.method==='GET'){send(200,ontoDashboard(state.db,user,url.searchParams.get('projectId')));return;}
      if(pathname==='/api/ontology/published'&&req.method==='GET'){send(200,ontoPublished(state.db,user,url.searchParams.get('projectId')));return;}
      if(pathname==='/api/ontology/impact'&&req.method==='GET'){
        const dashboard=ontoDashboard(state.db,user,url.searchParams.get('projectId'));const version=dashboard.versions.find(v=>v.id===url.searchParams.get('versionId'));if(!version)fault('本体版本不存在。',404);send(200,ontoImpact(state.db,version,user));return;
      }
      const ontologyMatch=pathname.match(/^\/api\/ontology\/(create|save|submit|approve|reject|publish|bind)$/);
      if(ontologyMatch&&req.method==='POST'){send(200,await commit(()=>ontoMutation(state.db,user,ontologyMatch[1],body,{requestId})));return;}
      if(pathname==='/api/admin'&&req.method==='GET'){send(200,adminView(state.db,user));return;}
      const adminMatch=pathname.match(/^\/api\/(users|organizations|roles|members|grants)$/);
      if(adminMatch&&req.method==='POST') {
        const entity=adminMatch[1];let newHash;
        if(entity==='users'&&(!body.id||body.password)){if(typeof body.password!=='string'||body.password.length<10||body.password.length>128)fault('密码需为10～128位。');newHash=passwordHash(body.password);}
        const result=await commit(()=>{const clean={...body};delete clean.password;const result=mutate(state.db,user,entity,clean,{requestId});if(newHash)state.passwords[result.id]=newHash;return result;});
        if(entity==='users')for(const [key,value]of sessions)if(value.userId===result.id&&(!state.db.users.find(u=>u.id===result.id)?.enabled||newHash))sessions.delete(key);
        send(200,result);return;
      }
      const businessMatch=pathname.match(/^\/api\/business\/(import|run|rule-edit|export)$/);
      if(businessMatch&&req.method==='POST'){const result=await commit(()=>business(state.db,user,businessMatch[1],body,{requestId}));send(200,result);return;}
      fault('接口不存在。',404);
    }catch(error){const status=error.status||(error.code==='ENOENT'?404:500);if(status===403&&req.url?.startsWith('/api/')){try{await commit(()=>auditEvent(state.db,auditUser,'拒绝访问',req.url,{},{requestId,result:'拒绝'}));}catch{}}
      send(status,{message:status===500?'服务保存或处理失败，请重试。':error.message,requestId});}
  };
  const server=http.createServer((req,res)=>{handler(req,res).catch(()=>{if(!res.headersSent)res.writeHead(500);res.end();});});
  server.on('close',()=>{ingestion.close();construction.close();});
  server.requestTimeout=60000;server.headersTimeout=10000;return server;
}
