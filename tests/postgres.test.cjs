'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const {Pool}=require('pg');
const {createServer}=require('../src/app');
const url=process.env.TEST_DATABASE_URL;
test('PostgreSQL: сохранение после перезапуска и синхронность двух экземпляров', {skip:!url}, async t=>{
  const setup=new Pool({connectionString:url});await setup.query('DROP TABLE IF EXISTS clinic_state');await setup.end();
  const token='test-admin-token-long-enough-123456',secret='test_webhook_secret_1234567890',sent=[];
  const env={DATABASE_URL:url,ADMIN_TOKEN:token,TELEGRAM_BOT_TOKEN:'fake',TELEGRAM_WEBHOOK_SECRET:secret,GEMINI_API_KEY:'fake',AI_AUTO_REPLY:'false'};
  const mock=async(u,o)=>{if(u.includes('sendMessage')){sent.push(JSON.parse(o.body));return {ok:true,json:async()=>({ok:true,result:{message_id:100+sent.length}})};}throw Error('no AI');};
  const a=createServer({env,fetch:mock}),b=createServer({env,fetch:mock});
  await Promise.all([a.ready,b.ready]);await Promise.all([new Promise(r=>a.listen(0,'127.0.0.1',r)),new Promise(r=>b.listen(0,'127.0.0.1',r))]);
  const rootA='http://127.0.0.1:'+a.address().port,rootB='http://127.0.0.1:'+b.address().port;
  t.after(()=>{a.close();b.close()});
  const headers={Authorization:'Bearer '+token,'content-type':'application/json'};
  async function incoming(root,n,text,chat=123){return fetch(root+'/api/telegram/webhook',{method:'POST',headers:{'content-type':'application/json','x-telegram-bot-api-secret-token':secret},body:JSON.stringify({update_id:n,message:{message_id:n,chat:{id:chat,type:'private'},from:{first_name:'Тест'},text}})});}
  await Promise.all(Array.from({length:30},(_,i)=>incoming(i%2?rootA:rootB,100+i,'Сообщение '+i)));await Promise.all([incoming(rootA,999,'Не дублировать'),incoming(rootB,999,'Не дублировать')]);
  async function chat(root){return (await (await fetch(root+'/api/telegram/conversations/123',{headers})).json());}
  let c=await chat(rootA);assert.equal(c.messages.length,31);assert.deepEqual(c,await chat(rootB));
  const payload={name:'Тест',phone:'000',admin:'Сотрудник',doctor:'',expectedVersion:0};
  const saves=await Promise.all([rootA,rootB].map(root=>fetch(root+'/api/telegram/conversations/123/patient',{method:'POST',headers,body:JSON.stringify(payload)})));assert.deepEqual(saves.map(r=>r.status).sort(),[200,409]);
  const id='1234567890abcdef1234567890abcdef';const sends=await Promise.all([rootA,rootB].map(root=>fetch(root+'/api/telegram/conversations/123/send',{method:'POST',headers,body:JSON.stringify({text:'Ответ',requestId:id})})));assert.deepEqual(sends.map(r=>r.status).sort(),[200,409]);assert.equal(sent.length,1);
  await new Promise(r=>a.close(r));await new Promise(r=>b.close(r));
  const restarted=createServer({env,fetch:mock});await restarted.ready;await new Promise(r=>restarted.listen(0,'127.0.0.1',r));t.after(()=>restarted.close());
  const root='http://127.0.0.1:'+restarted.address().port;c=await chat(root);assert.equal(c.messages.length,32);assert.equal(c.messages.at(-1).text,'Ответ');assert.equal(c.patient.name,'Тест');assert.equal(c.mode,'assigned');
  const health=await (await fetch(root+'/health')).json();assert.equal(health.storage,'postgres');
});
test('PostgreSQL: отказ БД не подтверждает webhook и не отправляет сообщение', {skip:!url}, async t=>{
  const pool=new Pool({connectionString:url});await pool.query('DROP TABLE IF EXISTS clinic_state');
  let outgoing=0;const env={DATABASE_URL:url,ADMIN_TOKEN:'admin-token-123456789012345678',TELEGRAM_WEBHOOK_SECRET:'secret_test_1234567890123456',TELEGRAM_BOT_TOKEN:'fake',AI_AUTO_REPLY:'true',GEMINI_API_KEY:'fake'};
  const app=createServer({env,fetch:async()=>{outgoing++;throw Error('unexpected')}});await app.ready;await new Promise(r=>app.listen(0,'127.0.0.1',r));
  t.after(()=>{app.close();pool.end()});await pool.query('DROP TABLE clinic_state');
  const root='http://127.0.0.1:'+app.address().port;
  const res=await fetch(root+'/api/telegram/webhook',{method:'POST',headers:{'content-type':'application/json','x-telegram-bot-api-secret-token':env.TELEGRAM_WEBHOOK_SECRET},body:JSON.stringify({update_id:1,message:{message_id:1,chat:{id:1,type:'private'},text:'Нужен человек'}})});
  assert.equal(res.status,502);await new Promise(r=>setTimeout(r,100));assert.equal(outgoing,0);
});
test('PostgreSQL: принятие сотрудником во время генерации на другом экземпляре', {skip:!url}, async t=>{
  const pool=new Pool({connectionString:url});await pool.query('DROP TABLE IF EXISTS clinic_state');await pool.end();
  let resolveAI,started;const active=new Promise(r=>started=r), blocked=new Promise(r=>resolveAI=r);let telegramCount=0;
  const env={DATABASE_URL:url,ADMIN_TOKEN:'admin-token-123456789012345678',TELEGRAM_WEBHOOK_SECRET:'secret_test_1234567890123456',TELEGRAM_BOT_TOKEN:'fake',AI_AUTO_REPLY:'true',GEMINI_API_KEY:'fake'};
  const mock=async(u)=>{if(u.includes('generativelanguage')){started();await blocked;return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify({action:'reply',reply:'Здравствуйте',reason:'',summary:''})}]}}]})};}telegramCount++;return {ok:true,json:async()=>({ok:true})};};
  const a=createServer({env,fetch:mock}),b=createServer({env,fetch:mock});await Promise.all([a.ready,b.ready]);await Promise.all([new Promise(r=>a.listen(0,'127.0.0.1',r)),new Promise(r=>b.listen(0,'127.0.0.1',r))]);t.after(()=>{resolveAI();a.close();b.close()});
  const root=x=>'http://127.0.0.1:'+x.address().port;
  const r=await fetch(root(a)+'/api/telegram/webhook',{method:'POST',headers:{'content-type':'application/json','x-telegram-bot-api-secret-token':env.TELEGRAM_WEBHOOK_SECRET},body:JSON.stringify({update_id:5,message:{message_id:5,chat:{id:42,type:'private'},text:'Здравствуйте'}})});assert.equal(r.status,200);await active;
  const take=await fetch(root(b)+'/api/telegram/conversations/42/take',{method:'POST',headers:{Authorization:'Bearer '+env.ADMIN_TOKEN}});assert.equal(take.status,200);resolveAI();await new Promise(r=>setTimeout(r,250));assert.equal(telegramCount,0);
  const chat=await (await fetch(root(b)+'/api/telegram/conversations/42',{headers:{Authorization:'Bearer '+env.ADMIN_TOKEN}})).json();assert.equal(chat.mode,'assigned');assert.equal(chat.messages.length,1);
});
