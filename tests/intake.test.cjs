const sessionFixture=require('./session-fixture.cjs');
'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {routeIntake}=require('../src/workflow/intake');
const {trigger}=require('../src/workflow/triage');
const {createServer}=require('../src/app');

test('Запись и цены: уточнение только отсутствующих данных и ограничение попыток',()=>{
  assert.match(routeIntake({},'запишите меня на чистку завтра').handoff,/Запись/);
  assert.match(routeIntake({},'сколько стоят брекеты').handoff,/стоимости/);
  let c={};assert.match(routeIntake(c,'хочу записаться на приём').reply,/какой приём/);
  assert.match(routeIntake(c,'на чистку').reply,/какой день и время/);
  assert.match(routeIntake(c,'завтра в 18:00').handoff,/Запись/);
  c={};assert.match(routeIntake(c,'записаться на чистку завтра').handoff,/Запись/);
  c={};assert.match(routeIntake(c,'хочу записаться завтра').reply,/какой приём/);assert.match(routeIntake(c,'чистка').handoff,/Запись/);
  c={};assert.match(routeIntake(c,'сколько стоит?').reply,/какая услуга/);assert.match(routeIntake(c,'чистка').handoff,/стоимости/);
  c={};assert.match(routeIntake(c,'сколько стоит чистка').handoff,/стоимости/);
  c={};routeIntake(c,'записаться');assert.match(routeIntake(c,'не знаю').handoff,/помощь сотрудника/);
  c={};routeIntake(c,'записаться');routeIntake(c,'да');routeIntake(c,'ок');assert.match(routeIntake(c,'спасибо').handoff,/уточнить/);
  assert.match(trigger('хочу записаться, болит зуб'),/Медицинский/);
  assert.match(trigger('Записаться для ребенка'),/Несовершеннолетний/);
  assert.match(trigger('Перенести запись'),/Изменение/);
  assert.match(trigger('Позовите администратора'),/сотрудника/);
});

test('Тестовый Telegram: уточнение, передача с контекстом, приоритет безопасности',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'crm-intake-'));
  const token='test-admin-token-long-enough-123456',secret='test_webhook_secret_1234567890';
  const env={ADMIN_TOKEN:token,TELEGRAM_BOT_TOKEN:'fake',TELEGRAM_WEBHOOK_SECRET:secret,AI_PROVIDER:'gigachat',GIGACHAT_AUTH_KEY:'fake',AI_AUTO_REPLY:'true'};
  const sent=[];let aiCalls=0;
  const mock=async(url,opts)=>{
    if(url.includes('sendMessage')){sent.push(JSON.parse(opts.body));return {ok:true,json:async()=>({ok:true,result:{message_id:100+sent.length}})};}
    aiCalls++;throw new Error('Шаблонный сценарий не должен обращаться к модели');
  };
  const app=createServer({env,fetch:mock,dataFile:path.join(dir,'data.json')});await new Promise(r=>app.listen(0,'127.0.0.1',r));
  t.after(()=>{app.close();fs.rmSync(dir,{recursive:true,force:true})});const root='http://127.0.0.1:'+app.address().port;let id=1;
  async function incoming(chat,text){const n=id++;let res=await fetch(root+'/api/telegram/webhook',{method:'POST',headers:{'content-type':'application/json','x-telegram-bot-api-secret-token':secret},body:JSON.stringify({update_id:n,message:{message_id:n,chat:{id:chat,type:'private'},text}})});assert.equal(res.status,200);}
  async function chat(id){return (await (await fetch(root+'/api/telegram/conversations/'+id,{headers:{Authorization:'Bearer '+token}})).json());}
  async function wait(cond){for(let i=0;i<200;i++){if(await cond())return;await new Promise(r=>setTimeout(r,5));}assert.fail('не дождались ответа');}
  await incoming(123,'хочу записаться на приём');await wait(()=>sent.length===1);assert.match(sent[0].text,/какой приём/);assert.equal((await chat(123)).mode,'ai');
  await incoming(123,'чистка');await wait(()=>sent.length===2);assert.match(sent[1].text,/какой день и время/);assert.equal((await chat(123)).mode,'ai');
  await incoming(123,'завтра в 18:00');await wait(()=>sent.length===3);assert.match(sent[2].text,/передан сотруднику/);
  let c=await chat(123);assert.equal(c.mode,'waiting');assert.match(c.handoff.reason,/Запись/);assert.match(c.handoff.summary,/чистка/);assert.match(c.handoff.summary,/завтра/);
  await incoming(124,'сколько стоит?');await wait(()=>sent.length===4);assert.match(sent[3].text,/какая услуга/);assert.equal((await chat(124)).mode,'ai');
  await incoming(124,'чистка');await wait(()=>sent.length===5);c=await chat(124);assert.equal(c.mode,'waiting');assert.match(c.handoff.summary,/чистка/);
  await incoming(125,'сколько стоит чистка?');await wait(()=>sent.length===6);assert.equal((await chat(125)).mode,'waiting');
  await incoming(126,'хочу записаться на чистку завтра');await wait(()=>sent.length===7);assert.equal((await chat(126)).mode,'waiting');
  await incoming(127,'хочу записаться');await wait(()=>sent.length===8);await incoming(127,'болит зуб');await wait(()=>sent.length===9);assert.match((await chat(127)).handoff.reason,/Медицинский/);
  await incoming(128,'сколько стоит?');await wait(()=>sent.length===10);await incoming(128,'позовите администратора');await wait(()=>sent.length===11);assert.match((await chat(128)).handoff.reason,/сотрудника/);
  assert.equal(aiCalls,0,'сценарии не зависят от ответа модели');
});

test('Новый запрос записи отменяет устаревший ответ генерации',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'crm-intake-race-')),sent=[];
  const token='test-admin-token-long-enough-123456',secret='test_webhook_secret_1234567890';
  const env={ADMIN_TOKEN:token,TELEGRAM_BOT_TOKEN:'fake',TELEGRAM_WEBHOOK_SECRET:secret,GEMINI_API_KEY:'fake',AI_AUTO_REPLY:'true'};
  let release,entered;const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
  const mock=async(url,opt)=>{
    if(url.includes('generateContent')){entered();await gate;return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify({action:'reply',reply:'Устаревший ответ',reason:'',summary:''})}]}}]})};}
    sent.push(JSON.parse(opt.body).text);return {ok:true,json:async()=>({ok:true,result:{message_id:100}})};
  };
  const app=createServer({env,fetch:mock,dataFile:path.join(dir,'data.json')});await new Promise(r=>app.listen(0,'127.0.0.1',r));t.after(()=>{release();app.close();fs.rmSync(dir,{recursive:true,force:true})});
  const root='http://127.0.0.1:'+app.address().port;
  async function send(id,text){const res=await fetch(root+'/api/telegram/webhook',{method:'POST',headers:{'content-type':'application/json','x-telegram-bot-api-secret-token':secret},body:JSON.stringify({update_id:id,message:{message_id:id,chat:{id:123,type:'private'},text}})});assert.equal(res.status,200);}
  await send(1,'Здравствуйте');await started;await send(2,'хочу записаться');release();
  for(let i=0;i<200 && !sent.length;i++)await new Promise(r=>setTimeout(r,5));
  assert.equal(sent.length,1);assert.match(sent[0],/какой приём/);assert(!sent.includes('Устаревший ответ'));
});
