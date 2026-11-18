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
