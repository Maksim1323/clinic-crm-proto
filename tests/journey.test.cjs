const {test}=require('node:test');
const {JSDOM,ResourceLoader,VirtualConsole}=require('jsdom');
const {createServer}=require('../src/app');
const fs=require('node:fs'); const os=require('node:os'); const path=require('node:path');
function assert(x,msg){if(!x)throw Error(msg);}
test('Полный путь администратора в браузере',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'crm-ui-test-'));
  const app=createServer({env:{},dataFile:path.join(dir,'db.json')});
  await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
  t.after(()=>{app.close();fs.rmSync(dir,{recursive:true,force:true})});
  const origin='http://127.0.0.1:'+app.address().port;
  class LocalOnly extends ResourceLoader {fetch(url,opts){if(!url.startsWith(origin+'/'))return null;return super.fetch(url,opts);}}
  const virtualConsole=new VirtualConsole(), errors=[]; virtualConsole.on('jsdomError',e=>errors.push(e.message));
  async function load(storage){const dom=await JSDOM.fromURL(origin+'/',{runScripts:'dangerously',resources:new LocalOnly(),pretendToBeVisual:true,virtualConsole,beforeParse(w){w.confirm=()=>true;if(storage)Object.entries(storage).forEach(([k,v])=>w.localStorage.setItem(k,v));}});await new Promise(resolve=>dom.window.addEventListener('load',resolve));return dom;}
  const dom=await load();t.after(()=>dom.window.close());const w=dom.window,d=w.document;
assert(typeof w.openJourney==='function','загрузились оба JS файла');
w.openJourney();assert(d.getElementById('journey-content').textContent.includes('Новое'),'новое обращение');
d.getElementById('journey-reason').value='Пациент просит человека';w.journeyHandoff();assert(d.getElementById('journey-content').textContent.includes('Ожидает сотрудника'),'передача создана');
w.journeyAccept();assert(d.getElementById('journey-content').textContent.includes('В работе сотрудника'),'принятие в работу');
const date=new Date(Date.now()+3*86400000); let local=new Date(date-Date.prototype.getTimezoneOffset.call(date)*60000).toISOString().slice(0,16);d.getElementById('journey-date').value=local;w.journeyPropose();assert(d.getElementById('journey-content').textContent.includes('Запись согласуется'),'время согласуется без МИС');
w.journeyConfirm();assert(d.getElementById('journey-content').textContent.includes('Запись согласуется'),'проверка чекбокса обязательна');
d.getElementById('journey-checked').checked=true;w.journeyConfirm();assert(d.getElementById('journey-content').textContent.includes('Записан'),'ручная отметка записи');
w.journeyReminder();let tasks=JSON.parse(w.localStorage.getItem('cliniccrm_journey_tasks_v1'));assert(tasks.filter(t=>t.source==='Напоминание · вручную').length===1,'напоминание сохранено');w.journeyReminder();tasks=JSON.parse(w.localStorage.getItem('cliniccrm_journey_tasks_v1'));assert(tasks.filter(t=>t.source==='Напоминание · вручную').length===1,'нет дубля напоминания');
w.journeyVisit('visited');d.getElementById('journey-followup').value='<img src=x onerror=alert(1)>';w.journeyFollowup();w.showView('tasks');assert(!d.querySelector('#tasks-list img'),'экранирование пользовательской задачи');
w.showView('comms');w.openJourney();w.journeyFinishVisited();w.journeyNew();assert(d.getElementById('journey-content').textContent.includes('Новое'),'отдельное новое обращение');let state=JSON.parse(w.localStorage.getItem('cliniccrm_v13'));assert(state.patients.ivanov.journeys.length===2,'два обращения в одном профиле');
const saved={};for(let i=0;i<w.localStorage.length;i++){const k=w.localStorage.key(i);saved[k]=w.localStorage.getItem(k)}; const dom2=await load(saved); t.after(()=>dom2.window.close());dom2.window.openJourney();assert(dom2.window.document.getElementById('journey-content').textContent.includes('Новое'),'восстановление обращения после перезагрузки');dom2.window.showView('tasks');assert(dom2.window.document.getElementById('tasks-list').textContent.includes('<img'),'сохранена последующая задача');
const d2=dom2.window.document;
for (const id of ['nav-auto','view-auto','nav-analytics','view-analytics']) assert(!d2.getElementById(id),'удалён '+id);
for (const view of ['comms','kanban','tasks']) {dom2.window.showView(view);assert(d2.getElementById('view-'+view).classList.contains('active'),'доступен '+view);}
dom2.window.showView('kanban');dom2.window.movePatientStage('ivanov',3);dom2.window.showView('tasks');assert(d2.getElementById('tasks-list').textContent.includes('Проверить этап'),'задача при смене этапа сохранена');
assert(!errors.length,'нет ошибок JS: '+errors.join('; '));
});
