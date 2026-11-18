// 生成可双击打开的本地预览；开发时仍编辑 src 下的独立文件。
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
let html=await fs.readFile(path.join(root,'index.html'),'utf8');
const css=await fs.readFile(path.join(root,'src/styles.css'),'utf8');
const parts=[];
for(const name of ['icons.js','data.js','rules.js','main.js']) {
  const source=await fs.readFile(path.join(root,'src',name),'utf8');
  parts.push(`// ===== src/${name} =====\n`+source.replace(/^import .+;\r?\n/gm,'').replace(/^export /gm,''));
}
html=html.replace('<link rel="stylesheet" href="./src/styles.css">',()=>'<style>\n'+css+'\n</style>');
html=html.replace('<script type="module" src="./src/main.js"></script>',()=>'<script type="module">\n'+parts.join('\n\n')+'\n</script>');
await fs.writeFile(path.join(root,'首页预览.html'),html,'utf8');
console.log('已生成 首页预览.html，可直接双击查看。');
