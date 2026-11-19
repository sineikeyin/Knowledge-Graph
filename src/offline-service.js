import {makeDatabase,activeUser,identity,workspace,adminView,mutate,business,auditEvent,fault,clone} from './access-model.js';
import {ingEnsure,ingRecordUpload,ingSetParsed,ingDashboard,ingDetail,ingMutation,ingId} from './ingestion-model.js';
import {ingParse} from './ingestion-core.js';
import {ingSeedDemo} from './ingestion-demo.js';
import {ontoEnsure,ontoDashboard,ontoPublished,ontoMutation,ontoImpact} from './ontology-model.js';
import {kcEnsure,kcDashboard,kcDetail,kcGraph,kcMutation,kcDispatch,kcAdvance} from './construction-model.js';
import {gmEnsure,gmSeedDemo,gmDashboard,gmQuery,gmMutation} from './graph-model.js';
import {slCleanDatabase} from './sample-labels.js';
export function createOfflineService() {
  let db;try{db=JSON.parse(localStorage.getItem('geokg-offline-users-v1'));}catch{}if(!db?.users)db=makeDatabase();
  slCleanDatabase(db);
  let session;try{session=JSON.parse(sessionStorage.getItem('geokg-offline-session-v1'));}catch{}
  ingEnsure(db);ontoEnsure(db);kcEnsure(db);
  const save=()=>{localStorage.setItem('geokg-offline-users-v1',JSON.stringify(db));if(session)sessionStorage.setItem('geokg-offline-session-v1',JSON.stringify(session));else sessionStorage.removeItem('geokg-offline-session-v1');};
  if(ingSeedDemo(db).changed)save();
  gmEnsure(db);for(const project of db.projects)gmSeedDemo(db,project.id);save();
  return async(pathname,body)=>{
    if(pathname==='/auth/login') {const user=db.users.find(u=>u.account===body.account);if(!user||body.password!=='GeoDemo!2026')fault('账号或密码不正确。',401);if(!user.enabled)fault('账号已停用，请联系管理员。',403);session={userId:user.id,expires:Date.now()+30*60*1000};user.lastLogin=new Date().toISOString();auditEvent(db,user,'登录（离线示例）','会话');save();return {user:identity(db,user),expires:session.expires};}
    if(!session||session.expires<=Date.now())fault('登录已失效，请重新登录。',401);const user=activeUser(db,session.userId);
    if(pathname==='/auth/me')return {user:identity(db,user),expires:session.expires};
    if(pathname==='/auth/logout'){auditEvent(db,user,'退出登录（离线示例）','会话');session=null;save();return {ok:true};}
    if(pathname==='/workspace')return workspace(db,user);
    if(pathname==='/graph'||pathname.startsWith('/graph?')||pathname.startsWith('/graph/')){
      const [endpoint,query='']=pathname.split('?'),params=new URLSearchParams(query),action=endpoint.split('/').pop(),before=clone(db);
      try{const result=endpoint==='/graph'?gmDashboard(db,user,params.get('projectId'),params.get('dataset')||'published'):['paths','spatial','similar','history'].includes(action)?gmQuery(db,user,action,body):gmMutation(db,user,action,body);save();return result;}catch(error){db=before;throw error;}
    }
    if(pathname.startsWith('/construction')){
      const [endpoint,query='']=pathname.split('?'),params=new URLSearchParams(query),projectId=params.get('projectId');
      const before=clone(db);
      try{
        kcDispatch(db);
        for(const task of db.construction.tasks.filter(t=>['queued','running'].includes(t.status))){const actor=db.users.find(u=>u.id===task.createdBy);if(actor?.enabled)for(let i=0;i<7&&['queued','running'].includes(task.status);i++)kcAdvance(db,actor,task.id);}
        let result;
        if(endpoint==='/construction')result=kcDashboard(db,user,projectId);
        else if(endpoint==='/construction/task')result=kcDetail(db,user,projectId,params.get('taskId'));
        else if(endpoint==='/construction/graph')result=kcGraph(db,user,projectId);
        else result=kcMutation(db,user,endpoint.split('/').pop(),body);
        save();return result;
      }catch(error){db=before;throw error;}
    }
    if(pathname.startsWith('/ontology')){
      const [endpoint,query='']=pathname.split('?');const params=new URLSearchParams(query),projectId=params.get('projectId');
      if(endpoint==='/ontology')return ontoDashboard(db,user,projectId);
      if(endpoint==='/ontology/published')return ontoPublished(db,user,projectId);
      if(endpoint==='/ontology/impact'){const dashboard=ontoDashboard(db,user,projectId);const version=dashboard.versions.find(v=>v.id===params.get('versionId'));if(!version)fault('本体版本不存在。',404);return ontoImpact(db,version,user);}
      const before=clone(db);try{const result=ontoMutation(db,user,endpoint.split('/').pop(),body);save();return result;}catch(error){db=before;throw error;}
    }
    if(pathname.startsWith('/ingestion')){
      const [endpoint,query='']=pathname.split('?');const params=new URLSearchParams(query);
      if(endpoint==='/ingestion')return ingDashboard(db,user,params.get('projectId'));
      if(endpoint.startsWith('/ingestion/assets/'))return ingDetail(db,user,endpoint.split('/').pop());
      if(endpoint==='/ingestion/sample'){
        const well=db.wells.find(item=>item.id===body.wellId);if(!well)fault('井不存在。');
        const text=`井名,层位,顶深,底深,深度单位,深度类型,参考基准\n${well.short},${well.layer},100,108,m,MD,KB\n`;
        const result=ingRecordUpload(db,user,{projectId:body.projectId,wellId:well.id,objectType:'stratum',name:`${well.short}_虚构示例分层.csv`,hash:`offline-demo-${well.id}`,fileId:ingId(db,'DEMO'),size:text.length*2,encoding:'utf-8'});
        if(!result.duplicate)ingSetParsed(db,result.jobId,ingParse(text,'csv'));
        save();return result;
      }
      if(['alias','standardize','correct','validate','retry','handoff'].includes(endpoint.split('/').pop())){
        if(endpoint.endsWith('/retry'))fault('离线样例解析已完成；真实解析重试请使用本机服务。');
        const result=ingMutation(db,user,endpoint.split('/').pop(),body);save();return result;
      }
      fault('离线模式不支持该数据接口。',404);
    }
    if(pathname==='/admin')return adminView(db,user);
    if(pathname.startsWith('/business/')){const result=business(db,user,pathname.split('/').pop(),body);save();return result;}
    const entity=pathname.slice(1);const clean={...body};delete clean.password;const result=mutate(db,user,entity,clean);save();return result;
  };
}
