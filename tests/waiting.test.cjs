'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createServer}=require('../src/app');

async function harness(t,mockOverride) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'crm-waiting-'));
  const token='test-admin-token-long-enough-123456',secret='test_webhook_secret_1234567890',sent=[],prompts=[];
  const env={ADMIN_TOKEN:token,TELEGRAM_BOT_TOKEN:'fake',TELEGRAM_WEBHOOK_SECRET:secret,AI_PROVIDER:'gigachat',GIGACHAT_AUTH_KEY:'fake',AI_AUTO_REPLY:'true'};
  const mock=async(url,opts)=>{
    if(mockOverride){const value=await mockOverride(url,opts);if(value!==undefined)return value;}
    if(url.includes('/oauth'))return {ok:true,json:async()=>({access_token:'token',expires_at:Date.now()+1800000})};
    if(url.includes('chat/completions')){prompts.push(JSON.parse(opts.body).messages[0].content);return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({action:'reply',reply:'Понимаю вас, можете уточнить организационный вопрос?',reason:'',summary:''})}}]})};}
    if(url.includes('sendMessage')){sent.push(JSON.parse(opts.body));return {ok:true,json:async()=>({ok:true,result:{message_id:100+sent.length}})};}
    throw Error('unexpected external API');
  };
  const app=createServer({env,fetch:mock,dataFile:path.join(dir,'data.json')});await new Promise(r=>app.listen(0,'127.0.0.1',r));
  t.after(()=>{app.close();fs.rmSync(dir,{recursive:true,force:true});});
  const root='http://127.0.0.1:'+app.address().port,headers={Authorization:'Bearer '+token,'content-type':'application/json'};
  let n=10;
  async function incoming(text,chat=123){const id=n++;const r=await fetch(root+'/api/telegram/webhook',{method:'POST',headers:{'content-type':'application/json','x-telegram-bot-api-secret-token':secret},body:JSON.stringify({update_id:id,message:{message_id:id,chat:{id:chat,type:'private'},text}})});assert.equal(r.status,200);}
  async function chat(id=123){return await (await fetch(root+'/api/telegram/conversations/'+id,{headers})).json();}
  async function take(id=123){return fetch(root+'/api/telegram/conversations/'+id+'/take',{method:'POST',headers,body:'{}'});}
  async function wait(cond){for(let i=0;i<300;i++){if(await cond())return;await new Promise(r=>setTimeout(r,5));}assert.fail('не дождались состояния');}
  return {sent,prompts,incoming,chat,take,wait};
}

test('После передачи ИИ отвечает, пока сотрудник не взял диалог',async t=>{
  const h=await harness(t);await h.incoming('Позовите администратора');await h.wait(()=>h.sent.length===1);
  let chat=await h.chat();assert.equal(chat.mode,'waiting');assert.equal(chat.waitingAiActive,true);
  await h.incoming('Я хотел ещё кое-что спросить');await h.wait(()=>h.sent.length===2);
  assert.match(h.sent[1].text,/Понимаю вас/);assert.match(h.prompts[0],/УЖЕ передан сотруднику/);
  chat=await h.chat();assert.equal(chat.mode,'waiting');assert.match(chat.handoff.summary,/хотел ещё/);
  await h.incoming('Сколько стоит чистка?');await h.wait(()=>h.sent.length===3);assert.match(h.sent[2].text,/прайса у меня нет/);
  await h.incoming('Мне трудно дышать');await h.wait(()=>h.sent.length===4);assert.match(h.sent[3].text,/экстренную службу/);
  chat=await h.chat();assert.match(chat.handoff.reason,/Срочное сообщение/);assert.match(chat.handoff.summary,/трудно дышать/);
  const response=await h.take();assert.equal(response.status,200);assert.equal((await h.chat()).mode,'assigned');
  await h.incoming('Есть ли ответ?');await new Promise(r=>setTimeout(r,40));assert.equal(h.sent.length,4,'после принятия бот молчит');
});

test('Сотрудник может принять диалог во время генерации, ответ ИИ не уйдёт',async t=>{
  let entered,release;const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
  const h=await harness(t,async(url)=>{
    if(url.includes('chat/completions')){entered();await gate;return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({action:'reply',reply:'Просроченный ответ',reason:'',summary:''})}}]})};}
  });t.after(()=>release());
  await h.incoming('Позовите администратора');await h.wait(()=>h.sent.length===1);
  await h.incoming('У меня уточнение');await started;assert.equal((await h.take()).status,200);release();
  await new Promise(r=>setTimeout(r,50));assert.equal(h.sent.length,1);assert.equal((await h.chat()).mode,'assigned');
});

test('Небезопасный ответ модели не отправляется в ожидании',async t=>{
  const h=await harness(t,async(url)=>{
    if(url.includes('chat/completions'))return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({action:'reply',reply:'Принимайте антибиотик каждый день.',reason:'',summary:''})}}]})};
  });
  await h.incoming('Позовите администратора');await h.wait(()=>h.sent.length===1);await h.incoming('Как мне быть?');await h.wait(()=>h.sent.length===2);
  assert.doesNotMatch(h.sent[1].text,/антибиотик/i);assert.match(h.sent[1].text,/сотрудника/);assert.equal((await h.chat()).mode,'waiting');
});

test('Неизвестный результат отправки приостанавливает автоответы до сотрудника',async t=>{
  let sendCount=0;
  const h=await harness(t,async(url)=>{
    if(url.includes('sendMessage') && ++sendCount===2)throw Error('timeout');
  });
  await h.incoming('Позовите администратора');await h.wait(()=>h.sent.length===1);await h.incoming('Ещё вопрос');
  await h.wait(async()=>(await h.chat()).waitingAiActive===false);
  const chat=await h.chat();assert.equal(chat.mode,'waiting');assert.match(chat.handoff.reason,/Результат отправки неизвестен/);
  await h.incoming('Ещё одно сообщение');await new Promise(r=>setTimeout(r,40));assert.equal(sendCount,2,'автоповтора и новых автоответов нет');
  assert.equal((await h.take()).status,200);
});

test('Срочное сообщение сразу передаётся и получает безопасное уведомление',async t=>{
  const h=await harness(t);await h.incoming('Я задыхаюсь');await h.wait(()=>h.sent.length===1);
  assert.match(h.sent[0].text,/экстренную службу/);const c=await h.chat();assert.equal(c.mode,'waiting');assert.match(c.handoff.reason,/Срочное/);
});

test('Во время фактической отправки принять диалог можно после её завершения',async t=>{
  let count=0,entered,release;const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
  const h=await harness(t,async(url,opts)=>{
    if(url.includes('sendMessage') && ++count===2){entered();await gate;return {ok:true,json:async()=>({ok:true,result:{message_id:200}})};}
  });t.after(()=>release());
  await h.incoming('Позовите администратора');await h.wait(()=>h.sent.length===1);await h.incoming('Вопрос');await started;
  assert.equal((await h.take()).status,409,'при уже начатой отправке сервер не обещает мгновенную отмену');release();
  let response;await h.wait(async()=>{response=await h.take();return response.status===200;});assert.equal((await h.chat()).mode,'assigned');
});

test('При сбое провайдера режим ожидания не сбрасывается и отправляется безопасная заглушка',async t=>{
  const h=await harness(t,async(url)=>{if(url.includes('/oauth'))throw new Error('simulated network error');});
  await h.incoming('Позовите администратора');await h.wait(()=>h.sent.length===1);await h.incoming('Дополнительный вопрос');await h.wait(()=>h.sent.length===2);
  assert.match(h.sent[1].text,/время ответа мне неизвестно/);const c=await h.chat();assert.equal(c.mode,'waiting');assert.match(c.handoff.reason,/ИИ не ответил/);
});

test('Если собеседник отказался от вопросов, бот не запрашивает контакт',async t=>{
  const h=await harness(t);await h.incoming('Позовите администратора, не спрашивайте телефон');await h.wait(()=>h.sent.length===1);
  assert.doesNotMatch(h.sent[0].text,/Как к вам обращаться|указать телефон/);
});
