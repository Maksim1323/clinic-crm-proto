const {test}=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM,ResourceLoader,VirtualConsole}=require('jsdom');
const {createServer}=require('../src/app');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
test('Карточка пациента, редактирование задач и смена этапа в демо',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'crm-ui-test-'));
  const app=createServer({env:{},dataFile:path.join(dir,'db.json')});await new Promise(r=>app.listen(0,'127.0.0.1',r));
  t.after(()=>{app.close();fs.rmSync(dir,{recursive:true,force:true})});
  const origin='http://127.0.0.1:'+app.address().port;
  class LocalOnly extends ResourceLoader {fetch(url,opts){if(!url.startsWith(origin+'/'))return null;return super.fetch(url,opts);}}
  const errors=[],virtualConsole=new VirtualConsole();virtualConsole.on('jsdomError',e=>errors.push(e.message));
  async function load(storage){const dom=await JSDOM.fromURL(origin+'/',{runScripts:'dangerously',resources:new LocalOnly(),pretendToBeVisual:true,virtualConsole,beforeParse(w){if(storage)Object.entries(storage).forEach(([k,v])=>w.localStorage.setItem(k,v));}});await new Promise(r=>dom.window.addEventListener('load',r));return dom;}
  const dom=await load();t.after(()=>dom.window.close());const w=dom.window,d=w.document;
  w.closeTelegramLogin();
  assert.equal(d.querySelector('#demo-patient-col .content-row #profile-card')!==null,true,'карточка в правой колонке рядом с историей');
  assert.equal(d.getElementById('history-feed').children.length>0,true);
  assert.equal(d.getElementById('notif-panel'),null);assert.doesNotMatch(d.querySelector('header').textContent,/UIS · демо/);
  assert.doesNotMatch(d.body.textContent,/Путь обращения|Черновик ИИ|Рекомендация по регламенту/);
  d.querySelector('#profile-card .profile-actions-bar button').click();assert(d.getElementById('patient-modal').classList.contains('open'));
  d.getElementById('pf-name').value='Тестовая карточка';w.savePatientCard();assert.equal(d.getElementById('pr-name').textContent,'Тестовая карточка');
  w.showView('tasks');d.querySelector('.task-card .task-right button').click();assert.match(d.getElementById('task-legacy-due').textContent,/сегодня 18:00/);w.saveTask();assert.match(d.querySelector('.task-card .task-right').textContent,/сегодня 18:00/,'старый срок сохраняется при редактировании');
  const before=d.querySelectorAll('.task-card').length;w.addDemoTask();assert(d.getElementById('task-modal').classList.contains('open'));
  w.saveTask();assert(d.getElementById('task-modal').classList.contains('open'),'пустая задача не сохраняется');
  d.getElementById('task-title').value='<img src=x onerror=alert(1)>';d.getElementById('task-assignee').value='Тестовый сотрудник';d.getElementById('task-due').value='2030-05-06T12:30';d.getElementById('task-patient').value='ivanov';w.saveTask();
  assert.equal(d.querySelectorAll('.task-card').length,before+1);assert.equal(d.querySelector('#tasks-list img'),null);assert.match(d.getElementById('tasks-list').textContent,/<img/);
  d.querySelector('.task-card .task-right button').click();assert.equal(d.getElementById('task-title').value,'<img src=x onerror=alert(1)>');d.getElementById('task-title').value='Изменённая задача';w.saveTask();
  assert.match(d.getElementById('tasks-list').textContent,/Изменённая задача/);
  w.addDemoTask();d.getElementById('task-title').value='Не сохранять';w.closeTaskModal();assert.doesNotMatch(d.getElementById('tasks-list').textContent,/Не сохранять/);
  w.showView('kanban');w.movePatientStage('ivanov',3);w.showView('tasks');assert.match(d.getElementById('tasks-list').textContent,/Проверить этап/);
  const storage={};for(let i=0;i<w.localStorage.length;i++){const k=w.localStorage.key(i);storage[k]=w.localStorage.getItem(k)}
  const dom2=await load(storage);t.after(()=>dom2.window.close());dom2.window.showView('tasks');assert.match(dom2.window.document.getElementById('tasks-list').textContent,/Изменённая задача/);assert.match(dom2.window.document.getElementById('tasks-list').textContent,/Проверить этап/);
  for(const id of ['nav-auto','view-auto','nav-analytics','view-analytics'])assert.equal(d.getElementById(id),null);
  assert.deepEqual(errors,[]);
});
