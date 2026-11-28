const sessionFixture=require('./session-fixture.cjs');
'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {JSDOM, ResourceLoader, VirtualConsole} = require('jsdom');
const {createServer} = require('../src/app');

test('Кнопки Telegram работают без системных диалогов и randomUUID', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-telegram-ui-'));
  const token = 'test-admin-token-long-enough-123456';
  const secret = 'test_webhook_secret_1234567890';
  const env = {ADMIN_TOKEN: token, TELEGRAM_BOT_TOKEN: 'fake', TELEGRAM_WEBHOOK_SECRET: secret, GEMINI_API_KEY:'fake', AI_AUTO_REPLY:'true'};
  const outgoing = [];
  const mockFetch = async (url, opts) => {
    if (url.includes('sendMessage')) {
      outgoing.push(JSON.parse(opts.body));
      return {ok:true, json:async()=>({ok:true,result:{message_id:outgoing.length}})};
    }
    throw new Error('Unexpected external call');
  };
  const app = createServer({env, fetch:mockFetch, dataFile:path.join(dir,'data.json')});
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  t.after(()=>{app.close(); fs.rmSync(dir,{recursive:true,force:true});});
  const base = 'http://127.0.0.1:' + app.address().port;await sessionFixture.session(base,token);
  const headers = {Authorization:'Bearer ' + token};
  const incoming = {update_id:12345, message:{message_id:1,chat:{id:123,type:'private'},from:{first_name:'Тест'},text:'Позовите администратора'}};
  const webhook = await fetch(base+'/api/telegram/webhook',{method:'POST',headers:{'content-type':'application/json','x-telegram-bot-api-secret-token':secret},body:JSON.stringify(incoming)});
  assert.equal(webhook.status,200);
  for(let i=0;i<100 && outgoing.length===0;i++) await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(outgoing.length,1,'уведомление о передаче отправлено');

  class LocalOnly extends ResourceLoader {
    fetch(url, options) {return url.startsWith(base+'/') ? super.fetch(url,options) : null;}
  }
  const errors = [], virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error.message));
  const dom = await JSDOM.fromURL(base+'/',{
    runScripts:'dangerously', resources:new LocalOnly(), pretendToBeVisual:true, virtualConsole,
    beforeParse(w) {
      w.confirm = () => {throw new Error('Системное подтверждение заблокировано');};
      Object.defineProperty(w.crypto,'randomUUID',{value:undefined,configurable:true});
      w.fetch = (url,options) => fetch(new URL(url,base),options);
      const interval=w.setInterval.bind(w); w.setInterval=(fn,ms)=>{if(ms===10000)w.testPoll=fn;return interval(fn,ms);};
    }
  });
  t.after(()=>dom.window.close());
  await new Promise(resolve=>dom.window.addEventListener('load',resolve));
  const w=dom.window, d=w.document;
  assert.equal(d.getElementById('nav-telegram'),null,'нет отдельной вкладки Telegram');
  assert.equal(d.getElementById('tg-login-button'),null,'нет отдельной кнопки входа в Telegram');
  assert.equal(d.getElementById('crm-integration-controls'),null,'кнопки обновления и подключения удалены');
  assert.equal([...d.querySelectorAll('button')].some(b=>['Обновить','Подключить бота'].includes(b.textContent.trim())),false);
  assert.ok(d.getElementById('view-comms').contains(d.getElementById('inbox-list')),'единый список входящих');
  assert.ok(d.getElementById('view-comms').contains(d.getElementById('tg-patient-col')),'панель Telegram внутри коммуникаций');
  assert.equal(d.getElementById('tg-login-modal').classList.contains('open'),true,'единый вход открыт при загрузке');
  assert.match(d.getElementById('tg-login-title').textContent,/Вход в CRM/);
  assert.equal(d.querySelector('#inbox-list [data-source="telegram"]'),null,'приватный чат не показан без входа');
  d.getElementById('crm-login-username').value=sessionFixture.credentials.login;d.getElementById('crm-login-password').value='incorrect-token';await w.tgLogin();
  assert.match(d.getElementById('crm-login-error').textContent,/Неверный/);assert.equal(d.getElementById('tg-login-modal').classList.contains('open'),true);
  d.getElementById('crm-login-username').value=sessionFixture.credentials.login;d.getElementById('crm-login-password').value=sessionFixture.credentials.password;await w.tgLogin();
  assert.equal(d.getElementById('tg-login-modal').classList.contains('open'),false);
  assert.equal(d.getElementById('crm-session-btn').textContent,'Выйти');
  assert.equal((await fetch(base+'/api/telegram/conversations')).status,401,'чаты закрыты на сервере без ключа');
  assert.ok(!Object.values(w.localStorage).some(value=>String(value).includes(token)),'ключ не записывается в localStorage');
  assert.equal(d.querySelectorAll('#inbox-list .sidebar-item').length,1,'все чаты в одном списке');
  assert.equal(d.getElementById('inbox-count').textContent,'1');assert.match(d.getElementById('tg-alert-count').textContent,/1/);
  assert.match(d.querySelector('#inbox-list [data-source="telegram"]').textContent,/Тест/);
  d.querySelector('#inbox-list [data-source="telegram"]').click();
  for(let i=0;i<100 && !d.getElementById('tg-handoff-status').textContent.includes('Нужен человек');i++) await new Promise(r=>setTimeout(r,10));
  assert.equal(d.getElementById('demo-patient-col').style.display,'none');assert.notEqual(d.getElementById('tg-patient-col').style.display,'none');
  assert.equal(d.querySelectorAll('#inbox-list .sidebar-item.active').length,1);
  await w.tgSelect('123');w.showView('tasks');w.showView('comms');assert.notEqual(d.getElementById('tg-patient-col').style.display,'none');
  assert.match(d.getElementById('tg-handoff-status').textContent,/Нужен человек.*ИИ может отвечать/);
  w.showView('tasks');w.addDemoTask();d.getElementById('task-title').value='Проверить обращение';d.getElementById('task-assignee').value='Сотрудник';d.getElementById('task-patient').value='tg_123';await w.saveTask();
  const taskList=await(await fetch(base+'/api/manual',{headers})).json();assert.equal(taskList.tasks[0].patientId,'tg_123');assert.equal(taskList.tasks[0].assignee,'Сотрудник');
  d.querySelector('.task-card .task-right button').click();d.getElementById('task-open-patient').click();for(let i=0;i<100 && d.getElementById('tg-patient-edit').disabled;i++)await new Promise(r=>setTimeout(r,10));assert.notEqual(d.getElementById('tg-patient-col').style.display,'none','из задачи открывается Telegram-чат');
  assert.equal(d.getElementById('tg-draft-btn'),null);assert.equal(d.getElementById('tg-chat-name').textContent,'Тест');
  d.getElementById('tg-patient-edit').click();assert.equal(d.getElementById('tg-patient-modal').classList.contains('open'),true);
  d.getElementById('tg-pf-name').value='<Тест 123>';d.getElementById('tg-pf-phone').value='000-123';d.getElementById('tg-pf-admin').value='Сотрудник';
  await w.tgSavePatient();assert.equal(d.getElementById('tg-chat-name').textContent,'<Тест 123>');
  const savedCard=await (await fetch(base+'/api/telegram/conversations/123',{headers})).json();assert.equal(savedCard.patient.phone,'000-123');
  assert.equal((await fetch(base+'/api/telegram/conversations/123/patient',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);
  await w.tgRefresh();assert.equal(d.getElementById('tg-chat-name').textContent,'<Тест 123>');
  await w.tgTake();
  assert.equal(d.getElementById('tg-handoff-status').textContent,'В работе сотрудника');
  let resumeCalls=0;const realFetch=w.fetch;
  w.fetch=(url,options)=>{if(String(url).endsWith('/resume'))resumeCalls++;return realFetch(url,options);};
  const resume = w.tgResume(); const repeatedResume = w.tgResume();
  assert.equal(Boolean(d.getElementById('tg-confirm-modal')),false,'возврат без подтверждения');
  assert.equal(d.getElementById('tg-resume').disabled,true,'повторное нажатие заблокировано');
  await Promise.all([resume,repeatedResume]);assert.equal(resumeCalls,1);w.fetch=realFetch;
  assert.equal(d.getElementById('tg-handoff-status').textContent,'ИИ ведёт диалог');

  d.getElementById('tg-input').value='Проверенный ответ оператора';
  const send = w.tgSend(); const repeatedSend = w.tgSend();
  assert.equal(Boolean(d.getElementById('tg-confirm-modal')),false,'отправка без подтверждения');
  assert.equal(d.getElementById('tg-send-btn').disabled,true,'повторное нажатие заблокировано');
  await Promise.all([send,repeatedSend]);
  assert.equal(outgoing.length,2);
  assert.equal(outgoing[1].text,'Проверенный ответ оператора');
  const chat = await (await fetch(base+'/api/telegram/conversations/123',{headers})).json();
  assert.equal(chat.mode,'assigned');
  assert.equal(chat.messages.at(-1).text,'Проверенный ответ оператора');

  d.getElementById('tg-resume').click();
  assert.equal(Boolean(d.getElementById('tg-confirm-modal')),false,'кнопка «Вернуть ИИ» не открывает подтверждение');
  for(let i=0;i<100 && d.getElementById('tg-handoff-status').textContent!=='ИИ ведёт диалог';i++)await new Promise(r=>setTimeout(r,10));
  assert.equal(d.getElementById('tg-handoff-status').textContent,'ИИ ведёт диалог');
  d.getElementById('tg-input').value='Ответ по кнопке';d.getElementById('tg-send-btn').click();d.getElementById('tg-send-btn').click();
  assert.equal(Boolean(d.getElementById('tg-confirm-modal')),false,'кнопка отправки не открывает подтверждение');
  for(let i=0;i<100 && outgoing.length<3;i++)await new Promise(r=>setTimeout(r,10));
  assert.equal(outgoing.length,3,'двойное нажатие не дублирует отправку');assert.equal(outgoing[2].text,'Ответ по кнопке');
  for(let i=0;i<100 && d.getElementById('tg-send-btn').disabled;i++)await new Promise(r=>setTimeout(r,10));
  assert.deepEqual(errors,[]);
  assert.equal(typeof w.testPoll,'function','проверка чатов работает без кнопки обновления');
  const second={update_id:12346,message:{message_id:2,chat:{id:124,type:'private'},from:{first_name:'Новый тест'},text:'Нужен администратор'}};
  await fetch(base+'/api/telegram/webhook',{method:'POST',headers:{'content-type':'application/json','x-telegram-bot-api-secret-token':secret},body:JSON.stringify(second)});
  w.testPoll();for(let i=0;i<100 && !d.getElementById('inbox-list').textContent.includes('Новый тест');i++)await new Promise(r=>setTimeout(r,10));
  assert.match(d.getElementById('inbox-list').textContent,/Новый тест/,'новый чат появился после фонового обновления');
  await w.tgSelect('124');assert.equal(d.getElementById('tg-chat-name').textContent,'Новый тест','карточки разных чатов не смешиваются');
  d.getElementById('tg-patient-edit').click();d.getElementById('tg-pf-name').value='Новая карточка';d.getElementById('tg-pf-show-name').checked=false;await w.tgSavePatient();assert.equal(d.getElementById('tg-chat-name').textContent,'Имя скрыто');
  await w.tgSelect('123');assert.equal(d.getElementById('tg-chat-name').textContent,'<Тест 123>');assert.equal(d.getElementById('tg-chat-name').textContent,'<Тест 123>','видимость каждой карточки независима');
  d.getElementById('tg-patient-edit').click();await w.tgSelect('124');assert.equal(d.getElementById('tg-patient-modal').classList.contains('open'),false,'форма закрыта при смене чата');assert.equal(d.getElementById('tg-chat-name').textContent,'Имя скрыто');

  let release;const oldFetch=w.fetch;w.fetch=(url,options)=>String(url).includes('/api/telegram/conversations')?new Promise(resolve=>{release=resolve;}):oldFetch(url,options);
  const delayedRefresh=w.tgRefresh();w.tgLogout();release({ok:true,json:async()=>({items:[{id:'999',name:'stale private chat',preview:'secret',mode:'waiting'}]})});await delayedRefresh;w.fetch=oldFetch;
  assert.doesNotMatch(d.getElementById('inbox-list').textContent,/stale private chat/,'данные старой сессии не появляются после выхода');
  assert.equal(d.getElementById('tg-patient-col').style.display,'none');assert.equal(d.getElementById('tg-login-modal').classList.contains('open'),true);assert.equal(d.querySelector('#inbox-list [data-source=telegram]'),null);assert.equal(d.getElementById('inbox-count').textContent,'0');
  w.closeTelegramLogin();assert.equal(d.getElementById('tg-login-modal').classList.contains('open'),false);d.getElementById('crm-session-btn').click();assert.equal(d.getElementById('tg-login-modal').classList.contains('open'),true);await new Promise(r=>setTimeout(r,100));
});
