'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {createServer}=require('./server');
test('Telegram, Gemini и ручное подтверждение: серверный сценарий',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'crm-test-')), dataFile=path.join(dir,'data.json');
  const admin='test-admin-token-with-more-than-24-chars', secret='test_webhook_secret_1234567890', calls=[];
  const env={ADMIN_TOKEN:admin,TELEGRAM_BOT_TOKEN:'test-telegram-token',TELEGRAM_WEBHOOK_SECRET:secret,GEMINI_API_KEY:'test-gemini-key',PUBLIC_BASE_URL:'https://example.onrender.com'};
  const mockFetch=async (url,opt)=>{calls.push({url,body:JSON.parse(opt.body)});if(url.includes('generateContent'))return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:'Тестовый черновик'}]}}]})};if(url.includes('sendMessage'))return {ok:true,json:async()=>({ok:true,result:{message_id:100}})};return {ok:true,json:async()=>({ok:true})};};
  const server=createServer({env,fetch:mockFetch,dataFile});await new Promise(r=>server.listen(0,'127.0.0.1',r));const root='http://127.0.0.1:'+server.address().port;
  t.after(()=>{server.close();fs.rmSync(dir,{recursive:true,force:true});});
  async function req(url,opts={}){const response=await fetch(root+url,opts);return {status:response.status,data:await response.json()};}
  const authorized={Authorization:'Bearer '+admin}, jsonHeaders={...authorized,'Content-Type':'application/json'};
  assert.equal((await req('/health')).status,200);
  assert.equal((await req('/api/telegram/conversations')).status,401);
  assert.equal((await req('/api/telegram/webhook',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status,403);
  let x=await req('/api/setup-webhook',{method:'POST',headers:jsonHeaders,body:'{}'});assert.equal(x.status,200);assert.equal(calls[0].body.secret_token,secret);
  const u={update_id:10,message:{message_id:20,chat:{id:123,type:'private'},from:{first_name:'Тест'},text:'Добрый день'}};
  const incoming=()=>req('/api/telegram/webhook',{method:'POST',headers:{'content-type':'application/json','x-telegram-bot-api-secret-token':secret},body:JSON.stringify(u)});
  assert.equal((await incoming()).status,200);await incoming();
  x=await req('/api/telegram/conversations/123',{headers:authorized});assert.equal(x.data.messages.length,1);
  x=await req('/api/telegram/conversations/123/draft',{method:'POST',headers:jsonHeaders,body:'{}'});assert.equal(x.data.draft,'Тестовый черновик');assert.equal(calls.filter(c=>c.url.includes('sendMessage')).length,0,'ИИ не отправляет ответ автоматически');
  const msg={text:'Проверенный ответ',requestId:'aabbccddeeff11223344556677889900'};
  x=await req('/api/telegram/conversations/123/send',{method:'POST',headers:jsonHeaders,body:JSON.stringify(msg)});assert.equal(x.status,200);
  x=await req('/api/telegram/conversations/123/send',{method:'POST',headers:jsonHeaders,body:JSON.stringify(msg)});assert.equal(x.status,409);assert.equal(calls.filter(c=>c.url.includes('sendMessage')).length,1,'защита от повтора');
  x=await req('/api/telegram/conversations/123',{headers:authorized});assert.equal(x.data.messages.length,2);assert.equal(x.data.messages[1].text,'Проверенный ответ');
  assert.ok(fs.readFileSync(dataFile,'utf8').includes('Добрый день'),'история сохранена на диск');
  const denied=await fetch(root+'/.env');assert.equal(denied.status,404,'секретные файлы не раздаются');
});

test('Автоответ, триггеры, передача и возврат ИИ',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'crm-auto-test-')), file=path.join(dir,'data.json');
  const admin='test-admin-token-with-more-than-24-chars', secret='test_webhook_secret_1234567890';
  const env={ADMIN_TOKEN:admin,TELEGRAM_BOT_TOKEN:'test-telegram-token',TELEGRAM_WEBHOOK_SECRET:secret,GEMINI_API_KEY:'test-gemini-key',AI_AUTO_REPLY:'true'};
  const sent=[];let aiMode='reply';
  const mockFetch=async(url,opt)=>{
    if(url.includes('generateContent')){
      if(aiMode==='error')throw new Error('simulated error');
      const decision=aiMode==='handoff'?{action:'handoff',reply:'',reason:'Запрос неясен',summary:'Собеседнику нужна помощь'}:{action:'reply',reply:'Здравствуйте! Чем могу помочь?',reason:'',summary:''};
      return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify(decision)}]}}]})};
    }
    if(url.includes('sendMessage')){sent.push(JSON.parse(opt.body));return {ok:true,json:async()=>({ok:true,result:{message_id:100+sent.length}})};}
    return {ok:true,json:async()=>({ok:true})};
  };
  const server=createServer({env,fetch:mockFetch,dataFile:file});await new Promise(r=>server.listen(0,'127.0.0.1',r));const root='http://127.0.0.1:'+server.address().port;t.after(()=>{server.close();fs.rmSync(dir,{recursive:true,force:true});});
  async function req(url,opts={}){const r=await fetch(root+url,opts);return {status:r.status,data:await r.json()};}
  const headers={Authorization:'Bearer '+admin,'content-type':'application/json'};
  let n=100;
  async function incoming(id,text){const num=n++;return req('/api/telegram/webhook',{method:'POST',headers:{'content-type':'application/json','x-telegram-bot-api-secret-token':secret},body:JSON.stringify({update_id:num,message:{message_id:num,chat:{id,type:'private'},from:{first_name:'Тест'},text}})});}
  async function chat(id){return (await req('/api/telegram/conversations/'+id,{headers})).data;}
  async function wait(predicate){const deadline=Date.now()+2000;while(Date.now()<deadline){if(await predicate())return;await new Promise(r=>setTimeout(r,10));}assert.fail('состояние не появилось');}
  await incoming(123,'Добрый день');await wait(async()=>sent.length===1);assert.match(sent[0].text,/Здравствуйте/);let c=await chat(123);assert.equal(c.mode,'ai');assert.equal(c.messages.at(-1).author,'ai');
  await incoming(123,'Хочу поговорить с администратором');c=await chat(123);assert.equal(c.mode,'waiting');assert.match(c.handoff.reason,/сотрудника/);assert.match(c.handoff.summary,/администратором/);
  await wait(async()=>sent.length===2);assert.match(sent[1].text,/сотруднику/);await incoming(123,'Когда сможете ответить?');await new Promise(r=>setTimeout(r,40));assert.equal(sent.length,2,'нет сообщений ИИ после передачи');
  await req('/api/telegram/conversations/123/take',{method:'POST',headers,body:'{}'});assert.equal((await chat(123)).mode,'assigned');
  await req('/api/telegram/conversations/123/resume',{method:'POST',headers,body:'{}'});assert.equal((await chat(123)).mode,'ai');await new Promise(r=>setTimeout(r,30));assert.equal(sent.length,2,'старые сообщения не переотправляются');
  await incoming(123,'Спасибо!');await wait(async()=>sent.length===3);
  await incoming(124,'Мне 16 лет');assert.equal((await chat(124)).mode,'waiting','несовершеннолетний: передача');
  await incoming(125,'У меня болят зубы');assert.match((await chat(125)).handoff.reason,/Медицинский/);
  aiMode='handoff';await incoming(126,'Это необычный случай');await wait(async()=>(await chat(126)).mode==='waiting');assert.match((await chat(126)).handoff.summary,/Сводка ИИ/);
  aiMode='error';await incoming(127,'Привет');await wait(async()=>(await chat(127)).mode==='waiting');assert.match((await chat(127)).handoff.reason,/не ответил/);
});

test('Передача человеку во время генерации отменяет автоматический ответ',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'crm-race-test-'));const file=path.join(dir,'data.json');
  const admin='test-admin-token-with-more-than-24-chars',secret='test_webhook_secret_1234567890';
  const env={ADMIN_TOKEN:admin,TELEGRAM_BOT_TOKEN:'test-token',TELEGRAM_WEBHOOK_SECRET:secret,GEMINI_API_KEY:'test-key',AI_AUTO_REPLY:'true'};
  let release,entered;const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r),sent=[];
  const mock=async(url,opt)=>{if(url.includes('generateContent')){entered();await gate;return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify({action:'reply',reply:'Это ответ ИИ',reason:'',summary:''})}]}}]})};}sent.push(JSON.parse(opt.body).text);return {ok:true,json:async()=>({ok:true,result:{message_id:33}})};};
  const server=createServer({env,fetch:mock,dataFile:file});await new Promise(r=>server.listen(0,'127.0.0.1',r));const root='http://127.0.0.1:'+server.address().port;t.after(()=>{server.close();fs.rmSync(dir,{recursive:true,force:true});});
  async function incoming(id,text){const r=await fetch(root+'/api/telegram/webhook',{method:'POST',headers:{'content-type':'application/json','x-telegram-bot-api-secret-token':secret},body:JSON.stringify({update_id:id,message:{message_id:id,chat:{id:123,type:'private'},text}})});assert.equal(r.status,200);}
  await incoming(10,'Здравствуйте');await started;await incoming(11,'Позовите администратора');release();
  const deadline=Date.now()+1000;while(!sent.length && Date.now()<deadline)await new Promise(r=>setTimeout(r,10));
  assert.equal(sent.length,1);assert.match(sent[0],/сотруднику/);assert.ok(!sent.includes('Это ответ ИИ'));
  const chat=await (await fetch(root+'/api/telegram/conversations/123',{headers:{Authorization:'Bearer '+admin}})).json();assert.equal(chat.mode,'waiting');
});
