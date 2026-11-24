'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {extractPatientInfo,applyPatientInfo,contactQuestion}=require('../src/workflow/patient-autofill');
const {createServer}=require('../src/app');

test('Только явно сообщённые имя и номер; без угадывания и данных других людей',()=>{
  assert.deepEqual(extractPatientInfo('Привет, меня зовут максим, мой телефон: +7 999 123-45-67'),{name:'максим',phone:'+7 999 123-45-67'});
  assert.deepEqual(extractPatientInfo('У мамы номер +7 999 123-45-67'),{});
  assert.deepEqual(extractPatientInfo('Не мой номер +7 999 123-45-67'),{});
  assert.deepEqual(extractPatientInfo('Мой телефон +7 999 123-45-67'),{phone:'+7 999 123-45-67'});
  assert.deepEqual(extractPatientInfo('Иван'),{});
  assert.deepEqual(extractPatientInfo('Иван',true),{name:'Иван'});
  assert.deepEqual(extractPatientInfo('Иван, +7 999 123-45-67',true),{name:'Иван',phone:'+7 999 123-45-67'});
  assert.deepEqual(extractPatientInfo('Спасибо',true),{});
  assert.deepEqual(extractPatientInfo('Помогите',true),{});
  assert.deepEqual(extractPatientInfo('Как записаться',true),{});
  assert.deepEqual(extractPatientInfo('Меня зовут Редкоеимя'),{name:'Редкоеимя'});
  assert.deepEqual(extractPatientInfo('Я хочу записаться',true),{});
  assert.deepEqual(extractPatientInfo('У меня аллергия на пенициллин'),{});
  assert.deepEqual(contactQuestion('Как вас зовут?'),{name:true,phone:false,left:2});
  assert.deepEqual(contactQuestion('Можете указать телефон для связи?'),{name:false,phone:true,left:2});
  assert.equal(contactQuestion('Не указывайте телефон'),null);
  const c={patient:{name:'Старое имя',phone:'',admin:'Админ',doctor:'Врач'}};
  applyPatientInfo(c,{name:'Новое имя'},{id:'123',at:'2026-01-01'});
  assert.equal(c.patient.name,'Новое имя');assert.equal(c.patient.admin,'Админ');assert.equal(c.patient.doctor,'Врач');assert.equal(c.patientVersion,1);assert.equal(c.patientSources.name.source,'telegram');assert.equal(c.patientSources.name.messageId,'123');
});

test('Автозаполнение до и во время передачи, версия и источник карточки',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'crm-card-auto-')),sent=[];
  const token='test-admin-token-long-enough-123456',secret='test_webhook_secret_1234567890';
  const env={ADMIN_TOKEN:token,TELEGRAM_BOT_TOKEN:'fake',TELEGRAM_WEBHOOK_SECRET:secret,GEMINI_API_KEY:'fake',AI_AUTO_REPLY:'true'};
  const mock=async(url,opts)=>{if(url.includes('sendMessage')){sent.push(JSON.parse(opts.body));return {ok:true,json:async()=>({ok:true,result:{message_id:sent.length}})};}return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify({action:'reply',reply:'Спасибо за информацию.',reason:'',summary:''})}]}}]})};};
  const app=createServer({env,fetch:mock,dataFile:path.join(dir,'data.json')});await new Promise(r=>app.listen(0,'127.0.0.1',r));t.after(()=>{app.close();fs.rmSync(dir,{recursive:true,force:true})});
  const root='http://127.0.0.1:'+app.address().port,headers={Authorization:'Bearer '+token,'content-type':'application/json'};let n=10;
  async function incoming(text,id=123){const num=n++;return fetch(root+'/api/telegram/webhook',{method:'POST',headers:{'content-type':'application/json','x-telegram-bot-api-secret-token':secret},body:JSON.stringify({update_id:num,message:{message_id:num,chat:{id,type:'private'},text}})});}
  async function chat(id=123){return (await (await fetch(root+'/api/telegram/conversations/'+id,{headers})).json());}
  async function edit(id,data){const r=await fetch(root+'/api/telegram/conversations/'+id+'/patient',{method:'POST',headers,body:JSON.stringify(data)});return {status:r.status,data:await r.json()};}
  async function wait(fn){for(let i=0;i<300;i++){if(await fn())return;await new Promise(r=>setTimeout(r,5));}assert.fail('не дождались');}
  await incoming('Позовите администратора');await wait(()=>sent.length===1);assert.match(sent[0].text,/Как к вам обращаться/);
  await new Promise(r=>setTimeout(r,40));assert.equal(sent.length,1,'без повторных инициативных сообщений');
  await incoming('Иван, +7 999 123-45-67');await wait(async()=>(await chat()).patient?.name==='Иван');
  let c=await chat();assert.equal(c.mode,'waiting');assert.equal(c.patient.phone,'+7 999 123-45-67');assert.equal(c.patientSources.name.source,'telegram');assert.equal(c.patientSources.phone.source,'telegram');assert.equal(c.patientVersion,1);
  const stale=c.patientVersion;await incoming('Меня зовут Олег, мой телефон +7 999 555-55-55');await wait(async()=>(await chat()).patient?.name==='Олег');c=await chat();assert.equal(c.patientVersion,2);assert.equal(c.patient.phone,'+7 999 555-55-55');
  let result=await edit(123,{...c.patient,expectedVersion:stale});assert.equal(result.status,409,'запрет потери обновления');
  c=await chat();result=await edit(123,{...c.patient,name:'Проверенное имя',admin:'Сотрудник',expectedVersion:c.patientVersion});assert.equal(result.status,200);assert.equal(result.data.patientSources.name.source,'staff');assert.equal(result.data.patientSources.phone.source,'telegram');
  await incoming('Моё имя Ирина');await wait(async()=>(await chat()).patient?.name==='Ирина');c=await chat();assert.equal(c.patientSources.name.source,'telegram');assert.equal(c.patient.admin,'Сотрудник');
  await wait(async()=>!(await chat()).messages.some(m=>m.direction==='in' && m.text==='Моё имя Ирина') || (await chat()).messages.at(-1).direction==='out');
  let response=await fetch(root+'/api/telegram/conversations/123/take',{method:'POST',headers,body:'{}'});assert.equal(response.status,200);
  await incoming('Меня зовут Марина, мой телефон +7 999 777-77-77');c=await chat();assert.equal(c.patient.name,'Ирина');assert.equal(c.patient.phone,'+7 999 555-55-55','после принятия автоматического изменения нет');
  await incoming('Позовите администратора',124);await wait(async()=>(await chat(124)).mode==='waiting');assert.equal((await chat(124)).patient,null,'отдельный чат — отдельная карточка');
});

test('Ответы на вопрос могут прийти двумя сообщениями; без автоответов карточка не заполняется',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'crm-card-parts-')),sent=[];
  const token='test-admin-token-long-enough-123456',secret='test_webhook_secret_1234567890';
  const env={ADMIN_TOKEN:token,TELEGRAM_BOT_TOKEN:'fake',TELEGRAM_WEBHOOK_SECRET:secret,GEMINI_API_KEY:'fake',AI_AUTO_REPLY:'true'};
  const mock=async(url,opts)=>{if(url.includes('sendMessage')){sent.push(JSON.parse(opts.body));return {ok:true,json:async()=>({ok:true,result:{message_id:sent.length}})};}return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify({action:'reply',reply:'Спасибо.',reason:'',summary:''})}]}}]})};};
  const file=path.join(dir,'data.json');let app=createServer({env,fetch:mock,dataFile:file});await new Promise(r=>app.listen(0,'127.0.0.1',r));
  let root='http://127.0.0.1:'+app.address().port;let n=10;
  t.after(()=>{app.close();fs.rmSync(dir,{recursive:true,force:true})});
  async function incoming(text,id=123){let num=n++;const r=await fetch(root+'/api/telegram/webhook',{method:'POST',headers:{'content-type':'application/json','x-telegram-bot-api-secret-token':secret},body:JSON.stringify({update_id:num,message:{message_id:num,chat:{id,type:'private'},text}})});assert.equal(r.status,200);}
  async function chat(id=123){return (await (await fetch(root+'/api/telegram/conversations/'+id,{headers:{Authorization:'Bearer '+token}})).json());}
  async function wait(fn){for(let i=0;i<250;i++){if(await fn())return;await new Promise(r=>setTimeout(r,5));}assert.fail('не дождались');}
  await incoming('Позовите администратора');await wait(()=>sent.length===1);
  await incoming('Иван');await wait(async()=>(await chat()).patient?.name==='Иван');
  await incoming('+7 999 123-45-67');await wait(async()=>(await chat()).patient?.phone==='+7 999 123-45-67');
  await new Promise(r=>app.close(r));app=createServer({env:{...env,AI_AUTO_REPLY:'false'},fetch:mock,dataFile:file});await new Promise(r=>app.listen(0,'127.0.0.1',r));root='http://127.0.0.1:'+app.address().port;
  await incoming('Меня зовут Ирина',124);assert.equal((await chat(124)).patient,null);
});

test('Ответ, пришедший во время отправки вопроса, не включает устаревшее ожидание контактов',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'crm-card-race-'));
  const token='test-admin-token-long-enough-123456',secret='test_webhook_secret_1234567890';
  let release,entered;const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
  const env={ADMIN_TOKEN:token,TELEGRAM_BOT_TOKEN:'fake',TELEGRAM_WEBHOOK_SECRET:secret,GEMINI_API_KEY:'fake',AI_AUTO_REPLY:'true'};
  const mock=async(url)=>{if(url.includes('sendMessage')){entered();await gate;return {ok:true,json:async()=>({ok:true,result:{message_id:1}})};}return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify({action:'reply',reply:'Спасибо',reason:'',summary:''})}]}}]})};};
  const app=createServer({env,fetch:mock,dataFile:path.join(dir,'data.json')});await new Promise(r=>app.listen(0,'127.0.0.1',r));t.after(()=>{release();app.close();fs.rmSync(dir,{recursive:true,force:true})});
  const root='http://127.0.0.1:'+app.address().port;let n=1;
  async function incoming(text){const id=n++;await fetch(root+'/api/telegram/webhook',{method:'POST',headers:{'content-type':'application/json','x-telegram-bot-api-secret-token':secret},body:JSON.stringify({update_id:id,message:{message_id:id,chat:{id:123,type:'private'},text}})});}
  async function chat(){return (await (await fetch(root+'/api/telegram/conversations/123',{headers:{Authorization:'Bearer '+token}})).json());}
  await incoming('Позовите администратора');await started;await incoming('Спасибо');release();
  for(let i=0;i<200 && (await chat()).messages.filter(m=>m.direction==='out').length<2;i++)await new Promise(r=>setTimeout(r,5));
  await incoming('Мария');assert.equal((await chat()).patient,null,'несвязанный краткий текст не записан как имя');
});

test('Краткий ответ на вопрос самого ИИ попадает в карточку',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'crm-card-ai-question-')),sent=[];
  const token='test-admin-token-long-enough-123456',secret='test_webhook_secret_1234567890';
  const env={ADMIN_TOKEN:token,TELEGRAM_BOT_TOKEN:'fake',TELEGRAM_WEBHOOK_SECRET:secret,GEMINI_API_KEY:'fake',AI_AUTO_REPLY:'true'};
  const mock=async(url,opts)=>{if(url.includes('sendMessage')){sent.push(JSON.parse(opts.body));return {ok:true,json:async()=>({ok:true,result:{message_id:sent.length}})};}return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify({action:'reply',reply:'Как вас зовут?',reason:'',summary:''})}]}}]})};};
  const app=createServer({env,fetch:mock,dataFile:path.join(dir,'data.json')});await new Promise(r=>app.listen(0,'127.0.0.1',r));t.after(()=>{app.close();fs.rmSync(dir,{recursive:true,force:true})});const root='http://127.0.0.1:'+app.address().port;let n=1;
  async function incoming(text){const id=n++;await fetch(root+'/api/telegram/webhook',{method:'POST',headers:{'content-type':'application/json','x-telegram-bot-api-secret-token':secret},body:JSON.stringify({update_id:id,message:{message_id:id,chat:{id:123,type:'private'},text}})});}
  async function chat(){return (await (await fetch(root+'/api/telegram/conversations/123',{headers:{Authorization:'Bearer '+token}})).json());}
  await incoming('Привет');for(let i=0;i<200&&!sent.length;i++)await new Promise(r=>setTimeout(r,5));assert.match(sent[0].text,/Как вас зовут/);
  await incoming('Иван');assert.equal((await chat()).patient.name,'Иван');assert.equal((await chat()).patientSources.name.source,'telegram');
});
