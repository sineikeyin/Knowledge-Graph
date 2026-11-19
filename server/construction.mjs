import {activeUser} from '../src/access-model.js';
import {kcEnsure,kcDispatch,kcHasEvents,kcAdvance,kcDashboard,kcDetail,kcGraph,kcMutation} from '../src/construction-model.js';

export async function createConstruction({getDb,commit}){
  let stopped=false,working=false;
  await commit(db=>{kcEnsure(db);for(const task of db.construction.tasks)if(task.status==='running')task.status='queued';});
  async function drain(){
    if(stopped||working)return;working=true;
    try{
      if(kcHasEvents(getDb()))await commit(db=>kcDispatch(db));
      while(!stopped){
        const task=getDb().construction.tasks.find(t=>['queued','running'].includes(t.status));if(!task)break;
        await commit(db=>{const current=db.construction.tasks.find(t=>t.id===task.id);const user=db.users.find(u=>u.id===current.createdBy);if(!user?.enabled){current.status='failed';current.error='任务创建账号已停用，请恢复授权后重试。';const stage=current.stages.find(s=>s.status!=='done');stage.status='failed';stage.error=current.error;current.revision++;return;}kcAdvance(db,user,task.id);});
        await new Promise(resolve=>setImmediate(resolve));
      }
    }finally{working=false;}
  }
  const kick=()=>setImmediate(()=>drain().catch(error=>process.emitWarning(`知识构建任务失败：${error.message}`)));
  // Source handoffs can originate from ingestion; inspect only governed handoffs, never raw uploads.
  const timer=setInterval(()=>{if(!stopped&&!working){const db=getDb();if(kcHasEvents(db)||db.construction.tasks.some(t=>['queued','running'].includes(t.status)))kick();}},1000);timer.unref();kick();
  return {close(){stopped=true;clearInterval(timer);},async handle({req,url,user,body,requestId,send}){
    const pathname=url.pathname,projectId=url.searchParams.get('projectId');
    if(req.method==='GET'&&pathname==='/api/construction'){send(200,kcDashboard(getDb(),user,projectId));return true;}
    if(req.method==='GET'&&pathname==='/api/construction/task'){send(200,kcDetail(getDb(),user,projectId,url.searchParams.get('taskId')));return true;}
    if(req.method==='GET'&&pathname==='/api/construction/graph'){send(200,kcGraph(getDb(),user,projectId));return true;}
    const match=pathname.match(/^\/api\/construction\/(create|retry|review|issue|sample|evaluate|export-evaluation|trigger|event-retry|publish)$/);
    if(match&&req.method==='POST'){const result=await commit(db=>kcMutation(db,activeUser(db,user.id),match[1],body,{requestId}));send(200,result);kick();return true;}return false;
  }};
}
