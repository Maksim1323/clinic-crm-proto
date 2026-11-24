'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {JSDOM,ResourceLoader,VirtualConsole}=require('jsdom');const {createServer}=require('../src/app');

test('Карточка показывает источник, не затирает новую версию при одновременном редактировании',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'crm-card-ui-')),token='test-admin-token-long-enough-123456',secret='test_webhook_secret_1234567890',sent=[];
  const env={ADMIN_TOKEN:token,TELEGRAM_BOT_TOKEN:'fake',TELEGRAM_WEBHOOK_SECRET:secret,GEMINI_API_KEY:'fake',AI_AUTO_REPLY:'true'};
  const mock=async(url,opts)=>{if(url.includes('sendMessage')){sent.push(JSON.parse(opts.body));return {ok:true,json:async()=>({ok:true,result:{message_id:sent.length}})};}return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify({action:'reply',reply:'Спасибо, информация добавлена.',reason:'',summary:''})}]}}]})};};
  const app=createServer({env,fetch:mock,dataFile:path.join(dir,'data.json')});await new Promise(r=>app.listen(0,'127.0.0.1',r));t.after(()=>{app.close();fs.rmSync(dir,{recursive:true,force:true});});
  const root='http://127.0.0.1:'+app.address().port;let num=10;
  async function incoming(text){const id=num++;await fetch(root+'/api/telegram/webhook',{method:'POST',headers:{'content-type':'application/json','x-telegram-bot-api-secret-token':secret},body:JSON.stringify({update_id:id,message:{message_id:id,chat:{id:123,type:'private'},text}})});}
  async function wait(fn){for(let i=0;i<250;i++){if(await fn())return;await new Promise(r=>setTimeout(r,5));}assert.fail('не дождались');}
  await incoming('Позовите администратора');await wait(()=>sent.length===1);
  class Local extends ResourceLoader {fetch(url,options){return url.startsWith(root+'/')?super.fetch(url,options):null;}}
  const errors=[],virtualConsole=new VirtualConsole();virtualConsole.on('jsdomError',e=>errors.push(e.message));
  const dom=await JSDOM.fromURL(root+'/',{runScripts:'dangerously',resources:new Local(),pretendToBeVisual:true,virtualConsole,beforeParse(w){w.fetch=(url,options)=>fetch(new URL(url,root),options);}});t.after(()=>dom.window.close());
  await new Promise(r=>dom.window.addEventListener('load',r));const w=dom.window,d=w.document;d.getElementById('tg-admin-token').value=token;await w.tgLogin();await w.tgSelect('123');
  await incoming('Меня зовут Иван, мой телефон: +7 999 123-45-67');
  await wait(async()=>{await w.tgRefresh(true);return d.getElementById('tg-patient-name').textContent==='Иван';});
  assert.equal(d.getElementById('tg-patient-name-source').textContent,'Из Telegram · не проверено');assert.equal(d.getElementById('tg-patient-phone-source').textContent,'Из Telegram · не проверено');
  w.tgEditPatient();assert.equal(d.getElementById('tg-pf-show-name').checked,true);d.getElementById('tg-pf-admin').value='Сотрудник';d.getElementById('tg-pf-show-name').checked=false;d.getElementById('tg-pf-show-phone').checked=false;await w.tgSavePatient();
  assert.equal(d.getElementById('tg-patient-name').closest('.profile-row').style.display,'none');assert.equal(d.getElementById('tg-patient-name-source').style.display,'none');
  await w.tgRefresh(true);assert.equal(d.getElementById('tg-patient-phone').closest('.profile-row').style.display,'none');
  w.tgEditPatient();assert.equal(d.getElementById('tg-pf-name').value,'Иван');assert.equal(d.getElementById('tg-pf-show-name').checked,false);d.getElementById('tg-pf-show-name').checked=true;w.tgClosePatient();w.tgEditPatient();assert.equal(d.getElementById('tg-pf-show-name').checked,false);w.tgClosePatient();
  assert.equal(d.getElementById('tg-patient-name-source').textContent,'Из Telegram · не проверено','источник не изменённых полей сохранён');
  w.tgEditPatient();d.getElementById('tg-pf-admin').value='Новое значение';
  await incoming('Меня зовут Ирина');await w.tgSavePatient();
  assert.match(d.getElementById('tg-patient-error').textContent,/Карточка изменилась/);assert.equal(d.getElementById('tg-patient-modal').classList.contains('open'),true);
  assert.equal(d.getElementById('tg-pf-admin').value,'Новое значение','несохранённые данные остались в форме');
  assert.equal(d.getElementById('tg-patient-name').textContent,'Ирина','обновлённые данные не потеряны');
  w.tgClosePatient();w.tgEditPatient();assert.equal(d.getElementById('tg-pf-name').value,'Ирина','скрытое значение по-прежнему обновляется');d.getElementById('tg-pf-name').value='Проверено';d.getElementById('tg-pf-show-name').checked=true;await w.tgSavePatient();assert.notEqual(d.getElementById('tg-patient-name').closest('.profile-row').style.display,'none');
  assert.equal(d.getElementById('tg-patient-name-source').textContent,'Указано сотрудником');assert.deepEqual(errors,[]);
});
