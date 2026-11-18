import {makeDatabase,activeUser,identity,workspace,adminView,mutate,business,auditEvent,fault} from './access-model.js';
export function createOfflineService() {
  let db;try{db=JSON.parse(localStorage.getItem('geokg-offline-users-v1'));}catch{}if(!db?.users)db=makeDatabase();
  let session;try{session=JSON.parse(sessionStorage.getItem('geokg-offline-session-v1'));}catch{}
  const save=()=>{localStorage.setItem('geokg-offline-users-v1',JSON.stringify(db));if(session)sessionStorage.setItem('geokg-offline-session-v1',JSON.stringify(session));else sessionStorage.removeItem('geokg-offline-session-v1');};
  return async(pathname,body)=>{
    if(pathname==='/auth/login') {const user=db.users.find(u=>u.account===body.account);if(!user||body.password!=='GeoDemo!2026')fault('账号或密码不正确。',401);if(!user.enabled)fault('账号已停用，请联系管理员。',403);session={userId:user.id,expires:Date.now()+30*60*1000};user.lastLogin=new Date().toISOString();auditEvent(db,user,'登录（离线演示）','会话');save();return {user:identity(db,user),expires:session.expires};}
    if(!session||session.expires<=Date.now())fault('登录已失效，请重新登录。',401);const user=activeUser(db,session.userId);
    if(pathname==='/auth/me')return {user:identity(db,user),expires:session.expires};
    if(pathname==='/auth/logout'){auditEvent(db,user,'退出登录（离线演示）','会话');session=null;save();return {ok:true};}
    if(pathname==='/workspace')return workspace(db,user);
    if(pathname==='/admin')return adminView(db,user);
    if(pathname.startsWith('/business/')){const result=business(db,user,pathname.split('/').pop(),body);save();return result;}
    const entity=pathname.slice(1);const clean={...body};delete clean.password;const result=mutate(db,user,entity,clean);save();return result;
  };
}
