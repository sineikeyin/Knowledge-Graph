export const offlineMode=location.protocol==='file:';
let csrfToken='';let offlineRequest;
export async function api(pathname,body) {
  try {
    let data;
    if(offlineMode){offlineRequest??=(await import('./offline-service.js')).createOfflineService();data=await offlineRequest(pathname,body);}
    else {const response=await fetch('/api'+pathname,{method:body===undefined?'GET':'POST',credentials:'same-origin',headers:body===undefined?{}:{'Content-Type':'application/json','X-CSRF-Token':csrfToken},body:body===undefined?undefined:JSON.stringify(body)});data=await response.json();if(!response.ok){const error=new Error(data.message);error.status=response.status;error.requestId=data.requestId;throw error;}}
    if(data.csrf)csrfToken=data.csrf;return data;
  }catch(error){if(error.status===401&&pathname!=='/auth/login'&&pathname!=='/auth/me')window.dispatchEvent(new CustomEvent('session-expired'));throw error;}
}
export async function uploadAsset(file,metadata,config){
  if(offlineMode)throw new Error('真实文件上传需启动本机服务；离线模式请使用样例数据。');
  const response=await fetch('/api/ingestion/upload?'+new URLSearchParams(metadata),{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/octet-stream','X-CSRF-Token':csrfToken,...(config?{'X-Import-Config':encodeURIComponent(JSON.stringify(config))}:{})},body:file});
  const data=await response.json();if(!response.ok){const error=new Error(data.message);error.status=response.status;if(response.status===401)window.dispatchEvent(new CustomEvent('session-expired'));throw error;}return data;
}
