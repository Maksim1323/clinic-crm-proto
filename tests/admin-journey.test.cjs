'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createServer}=require('../src/app');const {phoneKey}=require('../src/workflow/patient-search');
const key='setup-token-at-least-24-characters',hook='webhook-secret-at-least-24-characters';
function id(n){return 'p_'+String(n).repeat(32)}
function card(name,phone){return {name,phone,stageNum:1,history:[],plan:'план',bonuses:120,note:'заметка',visibility:{phone:false}};}
async function harness(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'crm-admin-flow-')),app=createServer({env:{ADMIN_TOKEN:key,TELEGRAM_WEBHOOK_SECRET:hook,AI_AUTO_REPLY:'false'},dataFile:path.join(dir,'state.json')});await app.ready;await new Promise(r=>app.listen(0,'127.0.0.1',r));t.after(()=>{app.close();fs.rmSync(dir,{recursive:true,force:true})});const base='http://127.0.0.1:'+app.address().port;
 async function req(url,method='GET',data,token){const r=await fetch(base+url,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(data?{'content-type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})});return [r.status,await r.json()];}
 const [,manager]=await req('/api/auth/bootstrap','POST',{login:'manager',name:'Руководитель',password:'Strongpass123456',setupToken:key});const [,created]=await req('/api/manage/staff','POST',{login:'admin',name:'Администратор',password:'Strongpass123456',role:'administrator'},manager.token);const [,admin]=await req('/api/auth/login','POST',{login:'admin',password:'Strongpass123456'});
 async function incoming(n,text,chat=42){const r=await fetch(base+'/api/telegram/webhook',{method:'POST',headers:{'content-type':'application/json','x-telegram-bot-api-secret-token':hook},body:JSON.stringify({update_id:n,message:{message_id:n,chat:{id:chat,type:'private'},from:{first_name:'Гость'},text}})});assert.equal(r.status,200);}
 return {req,manager:manager.token,admin:admin.token,staff:created.user,incoming};}

test('Поиск и проверка дублей не объединяют записи и не раскрывают закрытые поля',async t=>{
 const h=await harness(t),{req,manager,admin}=h;assert.equal(phoneKey('+7 (999) 111-22-33'),'79991112233');assert.equal(phoneKey('8 999 111-22-33'),'79991112233');assert.equal(phoneKey('123'),'');
 assert.equal((await req('/api/manual/patients/'+id(1),'PUT',{record:card('Ирина','+7 (999) 111-22-33'),expectedVersion:null},manager))[0],200);
 let [code,res]=await req('/api/patients/search?q='+encodeURIComponent('ирИн'),'GET',null,admin);assert.equal(code,200);assert.equal(res.items[0].name,'Ирина');assert(!('plan' in res.items[0]));assert(!('bonuses' in res.items[0]));
 [,res]=await req('/api/patients/search?q='+encodeURIComponent('8 999 111 22 33'),'GET',null,admin);assert.equal(res.items[0].id,id(1));assert.equal((await req('/api/patients/search?q=Ирина'))[0],401);
 const create={record:card('Другой пациент','8 999 111 22 33'),expectedVersion:null};[code,res]=await req('/api/manual/patients/'+id(2),'PUT',create,manager);assert.equal(code,409);assert.equal(res.code,'possible_duplicate');assert.deepEqual(res.matches.map(x=>x.id),[id(1)]);
 assert.equal((await req('/api/manual/patients/'+id(2),'PUT',{...create,acknowledgedDuplicates:['p_bad']},manager))[0],409);
 assert.equal((await req('/api/manual/patients/'+id(2),'PUT',{...create,acknowledgedDuplicates:[id(1)]},manager))[0],200);
 const legacy={scope:'a'.repeat(32),kind:'patient',legacyId:'old',record:card('Старая карточка','8 999 111 22 33')};[code,res]=await req('/api/manual/import','POST',legacy,manager);assert.equal(code,409);assert.equal(res.code,'possible_duplicate');assert.equal(res.matches.length,2);assert.equal((await req('/api/manual/import','POST',{...legacy,acknowledgedDuplicates:res.matches.map(m=>m.id)},manager))[0],200);
 const [,all]=await req('/api/manual','GET',null,manager);assert.equal(all.patients.length,3);const existing=all.patients.find(p=>p.id===id(2));assert.equal((await req('/api/manual/patients/'+id(2),'PUT',{record:{...existing,name:'Изменено'},expectedVersion:1},manager))[0],200,'редактирование без изменения телефона не блокируется');
});

test('Связь, задачи и статусы сохраняют обе карточки и историю; новые сообщения открывают обращение заново',async t=>{
 const h=await harness(t),{req,manager,admin}=h;await req('/api/manual/patients/'+id(1),'PUT',{record:card('Ирина','+7 999 111-22-33'),expectedVersion:null},manager);await h.incoming(1,'Здравствуйте');
 let [code,before]=await req('/api/telegram/conversations/42','GET',null,admin);assert.equal(before.caseStatus,'new');assert.equal(before.linkVersion,0);
 [code]=await req('/api/telegram/conversations/42/patient','POST',{name:'Ирина из чата',phone:'8 999 111 22 33',admin:'',doctor:'',expectedVersion:0},admin);assert.equal(code,409);
 [code]=await req('/api/telegram/conversations/42/patient','POST',{name:'Ирина из чата',phone:'8 999 111 22 33',admin:'',doctor:'',expectedVersion:0,acknowledgedDuplicates:[id(1)]},admin);assert.equal(code,200);
 [,before]=await req('/api/telegram/conversations/42','GET',null,admin);
 [code]=await req('/api/telegram/conversations/42/link','POST',{patientId:id(1),expectedVersion:0},admin);assert.equal(code,200);
 assert.equal((await req('/api/telegram/conversations/42/link','POST',{patientId:'',expectedVersion:0},manager))[0],409);
 let [,after]=await req('/api/telegram/conversations/42','GET',null,admin);assert.equal(after.linkedPatientId,id(1));assert.deepEqual(after.patient,before.patient);assert.deepEqual(after.messages,before.messages);assert.equal(after.patientVersion,before.patientVersion);
 const task={title:'Позвонить',patientId:'tg_42',assignee:'',assigneeUserId:h.staff.id,done:false,dueAt:null,due:'без срока'};const taskId='t_'+'b'.repeat(32);assert.equal((await req('/api/manual/tasks/'+taskId,'PUT',{record:task,expectedVersion:null},admin))[0],200);let [,all]=await req('/api/manual','GET',null,admin);assert.equal(all.links[0].patientId,id(1));assert.equal(all.tasks[0].patientId,'tg_42');assert.equal(all.patients[0].plan,undefined);
 assert.equal((await req('/api/telegram/conversations/42/status','POST',{status:'resolved',expectedVersion:0},admin))[0],200);assert.equal((await req('/api/telegram/conversations/42/status','POST',{status:'new',expectedVersion:0},manager))[0],409);
 await h.incoming(1,'Повтор webhook');[,after]=await req('/api/telegram/conversations/42','GET',null,admin);assert.equal(after.caseStatus,'resolved');await h.incoming(2,'Новый вопрос');[,after]=await req('/api/telegram/conversations/42','GET',null,admin);assert.equal(after.caseStatus,'new');assert.equal(after.caseStatusVersion,2);
 assert.equal((await req('/api/telegram/conversations/42/take','POST',{},admin))[0],200);[,after]=await req('/api/telegram/conversations/42','GET',null,admin);assert.equal(after.caseStatus,'in_progress');assert.equal(after.caseStatusVersion,3);
 assert.equal((await req('/api/telegram/conversations/42/link','POST',{patientId:'',expectedVersion:1},admin))[0],200);[,after]=await req('/api/telegram/conversations/42','GET',null,admin);assert.equal(after.linkedPatientId,'');assert.equal(after.patient.name,'Ирина из чата');assert.equal(after.messages.length,2);
 const [,audit]=await req('/api/manage/audit','GET',null,manager);assert(audit.items.some(e=>e.action==='conversation_patient_link_changed'&&e.actorId===h.staff.id));assert(audit.items.some(e=>e.action==='case_status_changed'&&e.status==='new'&&e.actorId==='system'));
});

test('Режим ИИ не меняет статус старого диалога без сохранённого статуса',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'crm-old-case-')),file=path.join(dir,'old.json');fs.writeFileSync(file,JSON.stringify({updates:[],sends:{},jobs:[],conversations:{'42':{id:'42',name:'Тест',mode:'assigned',messages:[]}}}));const app=createServer({env:{ADMIN_TOKEN:key,TELEGRAM_WEBHOOK_SECRET:hook,TELEGRAM_BOT_TOKEN:'fake',GEMINI_API_KEY:'fake',AI_AUTO_REPLY:'true'},dataFile:file});await app.ready;await new Promise(r=>app.listen(0,'127.0.0.1',r));t.after(()=>{app.close();fs.rmSync(dir,{recursive:true,force:true})});const base='http://127.0.0.1:'+app.address().port;
 const boot=await fetch(base+'/api/auth/bootstrap',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({login:'manager',name:'Руководитель',password:'Strongpass123456',setupToken:key})});const {token}=await boot.json(),headers={Authorization:'Bearer '+token};
 let chat=await(await fetch(base+'/api/telegram/conversations/42',{headers})).json();assert.equal(chat.caseStatus,'in_progress');assert.equal((await fetch(base+'/api/telegram/conversations/42/resume',{method:'POST',headers})).status,200);
 chat=await(await fetch(base+'/api/telegram/conversations/42',{headers})).json();assert.equal(chat.mode,'ai');assert.equal(chat.caseStatus,'in_progress');
});

test('Автозаполнение Telegram не блокируется и помечает совпадение для проверки сотрудником',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'crm-auto-match-'));const mock=async(url)=>url.includes('sendMessage')?{ok:true,json:async()=>({ok:true,result:{message_id:1}})}:{ok:true,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify({action:'reply',reply:'Здравствуйте',reason:'',summary:''})}]}}]})};
 const app=createServer({env:{ADMIN_TOKEN:key,TELEGRAM_WEBHOOK_SECRET:hook,TELEGRAM_BOT_TOKEN:'fake',GEMINI_API_KEY:'fake',AI_AUTO_REPLY:'true'},fetch:mock,dataFile:path.join(dir,'state.json')});await app.ready;await new Promise(r=>app.listen(0,'127.0.0.1',r));t.after(()=>{app.close();fs.rmSync(dir,{recursive:true,force:true})});const base='http://127.0.0.1:'+app.address().port;
 const auth=await fetch(base+'/api/auth/bootstrap',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({login:'manager',name:'Руководитель',password:'Strongpass123456',setupToken:key})});const {token}=await auth.json(),headers={Authorization:'Bearer '+token,'content-type':'application/json'};
 const saved=await fetch(base+'/api/manual/patients/'+id(1),{method:'PUT',headers,body:JSON.stringify({record:card('Ирина','+7 999 111 22 33'),expectedVersion:null})});assert.equal(saved.status,200);
 const incoming=await fetch(base+'/api/telegram/webhook',{method:'POST',headers:{'content-type':'application/json','x-telegram-bot-api-secret-token':hook},body:JSON.stringify({update_id:1,message:{message_id:1,chat:{id:42,type:'private'},text:'Меня зовут Ирина, мой телефон: +7 999 111 22 33'}})});assert.equal(incoming.status,200);
 const chat=await(await fetch(base+'/api/telegram/conversations/42',{headers})).json();assert.equal(chat.patientSources.phone.source,'telegram');assert.equal(chat.possibleDuplicates[0].id,id(1));assert.equal(chat.linkedPatientId,'');
});
