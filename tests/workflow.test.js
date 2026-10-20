import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {demoRequest} from '../src/demo-db.js';

const state=async()=>await (await demoRequest('/api/state')).json();
const action=async b=>{const r=await demoRequest('/api/actions',{method:'POST',body:JSON.stringify(b)});return {status:r.status,body:await r.json()}};
test('补货闭环、持久化、重复完成与库存事务',async()=>{
 await demoRequest('/api/reset',{method:'POST'});
 let s=await state();assert.equal(s.products.length,40);assert.equal(s.bins.length,200);assert.equal(s.stock.length,292);
 const statuses=new Set(s.bins.map(b=>{const n=s.stock.filter(x=>x.bin_id===b.id).reduce((n,x)=>n+x.quantity,0);return n===0?'empty':n<=b.min_qty?'low':n>b.max_qty?'over':'normal'}));assert.equal(statuses.size,4);
 const bin='A2-03-05',stock=s.stock.find(x=>x.bin_id===bin),before=stock.quantity;assert.equal(before,9);
 const created=await action({type:'createTask',kind:'replenish',sourceBinId:bin,productId:stock.product_id,quantity:24,assigneeId:'wang'});assert.equal(created.status,200);const id=created.body.id;
 assert.equal((await action({type:'claimTask',taskId:id,actorId:'li'})).status,409);
 assert.equal((await action({type:'claimTask',taskId:id,actorId:'wang'})).status,200);
 const results=await Promise.all([action({type:'completeTask',taskId:id,actorId:'wang'}),action({type:'completeTask',taskId:id,actorId:'wang'})]);assert.deepEqual(results.map(x=>x.status).sort(),[200,409]);
 s=await state();assert.equal(s.stock.find(x=>x.bin_id===bin).quantity,before+24);assert.equal(s.movements.filter(x=>x.task_id===id).length,1);assert.equal(s.tasks.find(x=>x.id===id).status,'done');
 const secondRead=await state();assert.equal(secondRead.stock.find(x=>x.bin_id===bin).quantity,33);
 const count=s.movements.length;assert.equal((await action({type:'adjust',kind:'out',binId:bin,productId:stock.product_id,quantity:120})).status,409);s=await state();assert.equal(s.movements.length,count);assert.equal(s.stock.find(x=>x.bin_id===bin).quantity,33);
 assert.equal((await action({type:'adjust',kind:'in',binId:bin,productId:stock.product_id,quantity:120})).status,409);
});
test('移库生成两条流水并保持总数量',async()=>{
 await demoRequest('/api/reset',{method:'POST'});let s=await state();const t=s.tasks.find(x=>x.id==='T-DEMO-02');const quantity=s.stock.filter(x=>x.product_id===t.product_id).reduce((n,x)=>n+x.quantity,0);
 assert.equal((await action({type:'completeTask',taskId:t.id,actorId:'chen'})).status,200);s=await state();assert.equal(s.stock.filter(x=>x.product_id===t.product_id).reduce((n,x)=>n+x.quantity,0),quantity);assert.equal(s.movements.filter(x=>x.task_id===t.id).length,2);
});
