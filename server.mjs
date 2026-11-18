import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createApp} from './server/app.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const server=await createApp({root,dataFile:path.join(root,'.runtime','platform.json')});
let port=Number(process.env.PORT||5173);
server.on('error',error=>{if(error.code==='EADDRINUSE'&&port<5183)server.listen(++port,'127.0.0.1');else{console.error(error.message);process.exitCode=1;}});
server.listen(port,'127.0.0.1',()=>console.log(`Local: http://127.0.0.1:${port}\n本机登录与权限服务已启动；仅监听127.0.0.1。按Ctrl+C停止。`));
