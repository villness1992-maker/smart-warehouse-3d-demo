import seed from './seed.js';

const DB_NAME='warehouse-pages-demo-v1';
function initialState(){
 const state=structuredClone(seed),delta=Date.now()-Date.parse(seed.serverTime);
 for(const rows of [state.stock,state.movements,state.tasks])for(const row of rows)for(const key of ['updated_at','occurred_at','created_at','claimed_at','completed_at'])if(row[key])row[key]=new Date(Date.parse(row[key])+delta).toISOString();
 state.serverTime=new Date().toISOString();return state;
}
function openDb(){return new Promise((resolve,reject)=>{
 const request=indexedDB.open(DB_NAME,1);
 request.onupgradeneeded=()=>request.result.createObjectStore('warehouse');
 request.onsuccess=()=>resolve(request.result);
 request.onerror=()=>reject(new Error('本机数据库无法打开，请允许此网站保存数据后重试。'));
 request.onblocked=()=>reject(new Error('请关闭同网站的其他旧标签页后重试。'));
})}
export async function transact(change){
 const db=await openDb();
 return new Promise((resolve,reject)=>{
  const tx=db.transaction('warehouse','readwrite'),store=tx.objectStore('warehouse');let result,failure;
  const read=store.get('state');
  read.onsuccess=()=>{try{const state=read.result||initialState();result=change(state);store.put(state,'state')}catch(error){failure=error;tx.abort()}};
  tx.oncomplete=()=>{db.close();resolve(result)};
  tx.onerror=tx.onabort=()=>{db.close();reject(failure||new Error('保存本机数据失败，请检查浏览器存储权限。'))};
 })
}
const check=(ok,message)=>{if(!ok)throw new Error(message)};
const total=(s,id)=>s.stock.filter(x=>x.bin_id===id).reduce((n,x)=>n+x.quantity,0);
function changeStock(s,bin,product,delta,now){
 let item=s.stock.find(x=>x.bin_id===bin&&x.product_id===product);
 if(!item){const p=s.products.find(x=>x.id===product);item={id:crypto.randomUUID(),bin_id:bin,product_id:product,product_name:p.name,sku:p.sku,unit:p.unit,quantity:0,updated_at:now};s.stock.push(item)}
 check(item.quantity+delta>=0,'该商品库存不足');item.quantity+=delta;item.updated_at=now;
}
function movement(s,kind,bin,product,quantity,actor,task,note,now){
 const p=s.products.find(x=>x.id===product),w=s.workers.find(x=>x.id===actor);
 s.movements.unshift({id:crypto.randomUUID(),kind,bin_id:bin,product_id:product,product_name:p.name,quantity,task_id:task||null,actor_id:actor,actor_name:w?.name||'系统',note,occurred_at:now});
}
export function applyAction(s,b){
 const now=new Date().toISOString();
 if(b.type==='createTask'){
  const qty=Number(b.quantity),source=s.bins.find(x=>x.id===b.sourceBinId),target=s.bins.find(x=>x.id===b.targetBinId),p=s.products.find(x=>x.id===b.productId),w=s.workers.find(x=>x.id===b.assigneeId&&x.role==='clerk');
  check(['move','replenish'].includes(b.kind)&&Number.isInteger(qty)&&qty>0&&qty<=120,'请检查任务类型和数量');
  check(source&&p&&w,'库位、商品或理货员不存在');
  if(b.kind==='move'){
   check(target&&target.id!==source.id,'请选择不同的目标库位');check((s.stock.find(x=>x.bin_id===source.id&&x.product_id===p.id)?.quantity||0)>=qty,'源库位该商品库存不足');check(total(s,target.id)+qty<=target.capacity,'目标库位容量不足');
  }else check(total(s,source.id)+qty<=source.capacity,'补货后超过库位容量');
  const id=crypto.randomUUID();s.tasks.unshift({id,kind:b.kind,source_bin_id:source.id,target_bin_id:b.kind==='move'?target.id:null,product_id:p.id,product_name:p.name,quantity:qty,assignee_id:w.id,assignee_name:w.name,status:'pending',note:String(b.note||''),created_at:now,claimed_at:null,completed_at:null});return {ok:true,id};
 }
 if(b.type==='claimTask'||b.type==='completeTask'){
  const t=s.tasks.find(x=>x.id===b.taskId);check(t&&t.assignee_id===b.actorId,'请使用被指派的理货员身份');
  if(b.type==='claimTask'){check(t.status==='pending','任务已被领取或已完成');t.status='claimed';t.claimed_at=now;return {ok:true}}
  check(t.status==='claimed','请先领取任务，已完成任务不能重复提交');
  const receiving=t.kind==='move'?t.target_bin_id:t.source_bin_id,destination=s.bins.find(x=>x.id===receiving);check(destination,'任务库位不存在');
  check(total(s,receiving)+t.quantity<=destination.capacity,'完成后会超过目标库位容量');
  if(t.kind==='move'){
   check((s.stock.find(x=>x.bin_id===t.source_bin_id&&x.product_id===t.product_id)?.quantity||0)>=t.quantity,'源库位库存不足，请主管调整任务');
   changeStock(s,t.source_bin_id,t.product_id,-t.quantity,now);movement(s,'move_out',t.source_bin_id,t.product_id,t.quantity,b.actorId,t.id,'移库出',now);
  }
  changeStock(s,receiving,t.product_id,t.quantity,now);movement(s,t.kind==='move'?'move_in':'in',receiving,t.product_id,t.quantity,b.actorId,t.id,t.kind==='move'?'移库入':'任务补货',now);t.status='done';t.completed_at=now;return {ok:true};
 }
 if(b.type==='adjust'){
  const qty=Number(b.quantity),bin=s.bins.find(x=>x.id===b.binId),p=s.products.find(x=>x.id===b.productId);
  check(bin&&p&&['in','out'].includes(b.kind)&&Number.isInteger(qty)&&qty>0&&qty<=120,'请填写有效的出入库信息');
  if(b.kind==='in')check(total(s,bin.id)+qty<=bin.capacity,'入库后超过库位容量');
  changeStock(s,bin.id,p.id,b.kind==='in'?qty:-qty,now);movement(s,b.kind,bin.id,p.id,qty,'mgr',null,String(b.note||'手工出入库'),now);return {ok:true};
 }
 throw new Error('未知操作');
}
export async function demoRequest(url,options={}){
 try{
  if(url==='/api/reset'){await transact(s=>{Object.assign(s,initialState())});return Response.json({ok:true})}
  if(url==='/api/state'){const s=await transact(s=>{s.serverTime=new Date().toISOString();return s});return Response.json(s)}
  if(url==='/api/actions'){const body=JSON.parse(options.body||'{}');return Response.json(await transact(s=>applyAction(s,body)))}
  return Response.json({error:'未知接口'},{status:404});
 }catch(error){return Response.json({error:error.message||'本机数据库操作失败'},{status:409})}
}
