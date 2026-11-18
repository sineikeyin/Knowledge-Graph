import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.json':'application/json; charset=utf-8','.md':'text/plain; charset=utf-8'};
const server = http.createServer(async (request, response) => {
  if (!['GET','HEAD'].includes(request.method)) {response.writeHead(405);response.end('Method not allowed');return;}
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + path.sep)) {response.writeHead(403);response.end('Forbidden');return;}
    const content = await fs.readFile(file);
    response.writeHead(200, {'Content-Type':types[path.extname(file)] || 'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    response.end(request.method === 'HEAD' ? undefined : content);
  } catch (error) {response.writeHead(error.code === 'ENOENT' || error.code === 'EISDIR' ? 404 : 400);response.end('File unavailable');}
});
let port = Number(process.env.PORT || 5173);
server.on('error', error => {
  if (error.code === 'EADDRINUSE' && port < 5183) server.listen(++port, '127.0.0.1');
  else {console.error(error.message);process.exitCode=1;}
});
server.listen(port,'127.0.0.1',()=>console.log(`Local: http://127.0.0.1:${port}\n仅本机可访问。按 Ctrl+C 停止；修改文件后刷新浏览器。`));
