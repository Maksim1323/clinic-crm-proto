const sessionFixture=require('./session-fixture.cjs');
const {test}=require('node:test');const assert=require('node:assert/strict');
const {JSDOM,ResourceLoader,VirtualConsole}=require('jsdom');const {createServer}=require('../src/app');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
test('Серверные ручные карточки и задачи доступны двум браузерам и сохраняют видимость',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'crm-ui-test-')),token='test-admin-token-long-enough-123456';
  const app=createServer({env:{ADMIN_TOKEN:token},dataFile:path.join(dir,'db.json')});await new Promise(r=>app.listen(0,'127.0.0.1',r));
  t.after(()=>{app.close();fs.rmSync(dir,{recursive:true,force:true})});const origin='http://127.0.0.1:'+app.address().port;await sessionFixture.session(origin,token);
  class LocalOnly extends ResourceLoader{fetch(url,opts){return url.startsWith(origin+'/')?super.fetch(url,opts):null;}}
  const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
  async function load(){const dom=await JSDOM.fromURL(origin+'/',{runScripts:'dangerously',resources:new LocalOnly(),pretendToBeVisual:true,virtualConsole:vc,beforeParse(w){w.fetch=(url,options)=>fetch(new URL(url,origin),options);}});await new Promise(r=>dom.window.addEventListener('load',r));dom.window.document.getElementById('crm-login-username').value=sessionFixture.credentials.login;dom.window.document.getElementById('crm-login-password').value=sessionFixture.credentials.password;await dom.window.tgLogin();return dom;}
  const first=await load(),second=await load();t.after(()=>{first.window.close();second.window.close()});const w=first.window,d=w.document;
  assert.equal(d.getElementById('inbox-count').textContent,'0');w.openPatientModal('create');d.getElementById('pf-name').value='Локальный тест';d.getElementById('pf-phone').value='000';await w.savePatientCard();
  let list=await (await fetch(origin+'/api/manual',{headers:{Authorization:'Bearer '+token}})).json();const patientId=list.patients[0].id;
  d.querySelector('#profile-card .profile-actions-bar button').click();d.getElementById('pf-name').value='Тестовая карточка';d.getElementById('pf-show-phone').checked=false;d.getElementById('pf-show-name').checked=false;d.getElementById('pf-show-note').checked=true;d.getElementById('pf-note').value='Тестовая заметка';await w.savePatientCard();
  assert.equal(d.getElementById('pr-name').style.display,'none');assert.equal(d.getElementById('pr-phone').closest('.profile-row').style.display,'none');
  w.openPatientModal('edit');assert.equal(d.getElementById('pf-phone').value,'000');d.getElementById('pf-show-phone').checked=true;w.closePatientModal();w.openPatientModal('edit');assert.equal(d.getElementById('pf-show-phone').checked,false);w.closePatientModal();
  w.showView('tasks');w.addDemoTask();await w.saveTask();assert(d.getElementById('task-modal').classList.contains('open'));
  d.getElementById('task-title').value='<img src=x onerror=alert(1)>';d.getElementById('task-assignee').value='Тестовый сотрудник';d.getElementById('task-due').value='2030-05-06T12:30';d.getElementById('task-patient').value=patientId;await w.saveTask();
  assert.equal(d.querySelectorAll('.task-card').length,1);assert.equal(d.querySelector('#tasks-list img'),null);assert.match(d.getElementById('tasks-list').textContent,/<img/);
  d.querySelector('.task-card .task-right button').click();d.getElementById('task-title').value='Изменённая задача';await w.saveTask();
  await w.movePatientStage(patientId,3);w.showView('tasks');assert.match(d.getElementById('tasks-list').textContent,/Проверить этап/);
  await second.window.crmRefreshManual();const d2=second.window.document;second.window.selectPatient(patientId);assert.equal(d2.getElementById('pr-phone').closest('.profile-row').style.display,'none');second.window.openPatientModal('edit');assert.equal(d2.getElementById('pf-phone').value,'000');d2.getElementById('pf-show-phone').checked=true;await second.window.savePatientCard();assert.notEqual(d2.getElementById('pr-phone').closest('.profile-row').style.display,'none');second.window.showView('tasks');assert.match(d2.getElementById('tasks-list').textContent,/Изменённая задача/);
  w.openPatientModal('edit');d.getElementById('pf-name').value='Несохранённый текст';await w.savePatientCard();assert.match(d.getElementById('patient-save-error').textContent,/изменилась/);assert.equal(d.getElementById('pf-name').value,'Несохранённый текст');assert.equal(d.getElementById('patient-modal').classList.contains('open'),true);w.closePatientModal();
  assert.equal((await fetch(origin+'/api/manual')).status,401);assert.deepEqual(errors,[]);
});
