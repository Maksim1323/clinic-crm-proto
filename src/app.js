'use strict';
// Test-only service; storage remains unsuitable for clinical/patient use.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {readConfig}=require('./config');
const {openTransactionStore}=require('./storage/transaction-store');
const {createExternalClient}=require('./integrations/http-client');
const {createAI}=require('./integrations/ai');
const {createGigachatFetch}=require('./integrations/gigachat-transport');
const {createTelegram}=require('./integrations/telegram');
const {initial,context,shortContext,trigger,riskyOutput,aiFailureReason}=require('./workflow/triage');
const {routeIntake}=require('./workflow/intake');
const {WAITING_FALLBACK,EMERGENCY_RESPONSE,emergency,safetyReply}=require('./workflow/waiting');
const {extractPatientInfo,applyPatientInfo,contactQuestion}=require('./workflow/patient-autofill');
const manual=require('./workflow/manual-records');

function createServer(options={}) {
  const env=options.env||process.env, callFetch=options.fetch||global.fetch;
  const config=readConfig(env,options.dataFile),{admin,tg,hookSecret,baseUrl,autoEnabled}=config;
  const store=openTransactionStore(config), external=createExternalClient(callFetch), telegram=createTelegram(external,tg);
  const aiFetch=config.aiProvider==='gigachat'&&!options.fetch?createGigachatFetch(callFetch):callFetch;
  const ai=createAI(config,aiFetch===callFetch?external:createExternalClient(aiFetch),aiFetch);
  const LEASE_MS=180000;
  function equal(a,b){const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length===y.length&&crypto.timingSafeEqual(x,y);}
  function json(res,status,data){const body=JSON.stringify(data);res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(body);}
  function fail(res,status,message){json(res,status,{error:message});}
  const authFailures=new Map();
  function auth(req,res){
    const ip=req.socket.remoteAddress||'unknown',now=Date.now(),recent=(authFailures.get(ip)||[]).filter(t=>now-t<60000);
    if(recent.length>=15){authFailures.set(ip,recent);fail(res,429,'Слишком много попыток. Подождите минуту.');return false;}
    if(admin.length<24){fail(res,503,'На сервере не настроен ADMIN_TOKEN (минимум 24 символа).');return false;}
    const value=(req.headers.authorization||'').replace(/^Bearer /,'');
    if(!equal(value,admin)){recent.push(now);authFailures.set(ip,recent);fail(res,401,'Неверный ключ администратора.');return false;}
    authFailures.delete(ip);return true;
  }
  async function body(req){let size=0,chunks=[];for await(const part of req){size+=part.length;if(size>64*1024)throw Error('too_large');chunks.push(part);}if(!size)return {};try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch(_){throw Error('bad_json');}}
  const response=(status,data)=>({status,data});
  const error=(status,message)=>response(status,{error:message});
  function transfer(state,c,reason,summary,suppressNotice=false){
    initial(c);if(c.mode==='assigned')return;
    const wasAi=c.mode==='ai',initialContext=c.intake?.initialText||'';
    const info=initialContext?'Начальный запрос: '+initialContext+' | '+shortContext(c):shortContext(c);
    delete c.intake;c.mode='waiting';c.modeVersion=(c.modeVersion||0)+1;delete c.waitingPaused;
    c.handoff={reason:String(reason||'Нужна проверка сотрудника').slice(0,300),summary:String(summary||info).slice(0,1200),initialContext,at:new Date().toISOString()};
    if(wasAi&&tg&&autoEnabled&&!suppressNotice)state.jobs.push({id:'notice_'+crypto.randomUUID().replaceAll('-',''),chatId:c.id,kind:'notice',stage:'queued',urgent:emergency(c.messages.at(-1)?.text)});
  }
  function waitingIssue(c,issue){if(c.mode==='waiting'&&c.handoff&&!c.handoff.reason.includes(issue))c.handoff.reason=(issue+' · '+c.handoff.reason).slice(0,300);}
  function pauseWaiting(c,issue){if(c.mode==='waiting'){c.waitingPaused=true;waitingIssue(c,issue);}}
  function queueHandoffNotice(c,job){
    const last=c.messages.filter(m=>m.direction==='in').at(-1)?.text||'';
    const refuses=/(не\s+(?:хочу|буду|могу)\s+(?:указывать|оставлять|давать|сообщать|говорить|отвечать)|не спрашивайте|без вопросов|не нужен телефон|не звоните)/i.test(last);
    const sensitive=job.urgent||refuses||/Медицинский|Несовершеннолетний|Жалоба|Срочное/i.test(c.handoff?.reason||'');
    const askName=!sensitive&&!c.patient?.name,askPhone=!sensitive&&!c.patient?.phone;
    const text=job.urgent?EMERGENCY_RESPONSE:sensitive?'Ваш вопрос передан сотруднику. Если хотите, можете добавить организационные детали — они будут видны в диалоге.':askName?'Ваш вопрос передан сотруднику. Как к вам обращаться? Например: «Меня зовут Анна».'+(askPhone?' Если хотите, можете также указать телефон для связи.':''):'Ваш вопрос передан сотруднику. Есть ли ещё организационные детали, которые вы хотели бы сообщить?'+(askPhone?' Если хотите, можете также указать телефон для связи.':'');
    return {text,asked:askName||askPhone?{name:askName,phone:askPhone,left:2}:null};
  }
  function owned(state,task){const job=state.jobs.find(j=>j.id===task.jobId);return job&&job.owner===task.owner&&['generating','sending'].includes(job.stage)?job:null;}
  async function claimJob(){return store.transact(state=>{
    const now=Date.now();
    for(const j of state.jobs.filter(j=>['generating','sending'].includes(j.stage)&&(!j.leaseUntil||j.leaseUntil<=now))){
      const c=state.conversations[j.chatId];if(c){if(c.mode==='waiting')pauseWaiting(c,'Обработка прервалась: проверьте диалог и возможную отправку');else transfer(state,c,'Обработка прервалась: проверьте диалог и возможную отправку',undefined,true);}j.stage='done';
    }
    if(state.jobs.some(j=>['generating','sending'].includes(j.stage)))return null;
    const job=state.jobs.find(j=>j.stage==='queued');if(!job)return null;
    const c=state.conversations[job.chatId],waiting=job.kind==='waiting_reply',expected=waiting?'waiting':'ai';
    if(!c){job.stage='done';return {skip:true};}
    if(job.kind==='notice'){
      if(initial(c).mode!=='waiting'||!tg||!autoEnabled||c.waitingPaused){job.stage='done';return {skip:true};}
      const notice=queueHandoffNotice(c,job), owner=crypto.randomUUID();job.owner=owner;job.leaseUntil=now+LEASE_MS;job.stage='sending';
      state.sends[job.id]={chatId:c.id,status:'pending',at:new Date().toISOString()};
      return {jobId:job.id,owner,chatId:c.id,notice:true,text:notice.text,asked:notice.asked,before:c.messages.filter(m=>m.direction==='in').at(-1)?.id};
    }
    if(initial(c).mode!==expected||(waiting&&c.waitingPaused)){job.stage='done';return {skip:true};}
    if(!autoEnabled||!tg||(!waiting&&ai.configError)){if(!waiting)transfer(state,c,ai.configError||'ИИ выключен или не настроен');job.stage='done';return {skip:true};}
    const owner=crypto.randomUUID();job.owner=owner;job.leaseUntil=now+LEASE_MS;job.stage='generating';
    return {jobId:job.id,owner,chatId:c.id,waiting,expected,version:c.modeVersion||0,kind:job.kind,reply:job.reply,urgent:!!job.urgent,history:context(c),updateId:job.updateId};
  });}
  async function generate(task){
    try {
      return {decision:task.kind==='intake'||(task.waiting&&task.reply)?{action:'reply',reply:task.reply,reason:'',summary:''}:task.waiting&&ai.configError?{action:'reply',reply:WAITING_FALLBACK,reason:'',summary:''}:await ai.decide(task.history,{waiting:task.waiting})};
    }catch(e){return {failure:aiFailureReason(e,config.aiProvider)};}
  }
  async function prepareSend(task,outcome){return store.transact(state=>{
    const job=owned(state,task),c=state.conversations[task.chatId];
    if(!job||job.stage!=='generating'||!c)return null;
    if(job.leaseUntil<=Date.now()){job.stage='done';if(c.mode==='waiting')pauseWaiting(c,'Обработка прервалась: проверьте диалог и возможную отправку');else transfer(state,c,'Обработка прервалась: проверьте диалог и возможную отправку',undefined,true);return null;}
    if(c.mode!==task.expected||(c.modeVersion||0)!==task.version||(task.waiting&&c.waitingPaused)){job.stage='done';return null;}
    let decision=outcome.decision;
    if(outcome.failure){if(task.waiting){waitingIssue(c,outcome.failure);decision={action:'reply',reply:WAITING_FALLBACK,reason:'',summary:''};}else{transfer(state,c,outcome.failure);job.stage='done';return null;}}
    if(!task.urgent&&state.jobs.some(next=>next.chatId===c.id&&next.stage==='queued'&&next.kind!=='notice')){job.stage='done';return null;}
    if(decision.action==='handoff'||!decision.reply.trim()||decision.reply.length>3500||riskyOutput(decision.reply)){
      if(task.waiting)decision={action:'reply',reply:WAITING_FALLBACK,reason:'',summary:''};
      else{transfer(state,c,decision.reason||'Ответ ИИ требует проверки',decision.summary?'Сводка ИИ (требует проверки): '+decision.summary:undefined);job.stage='done';return null;}
    }
    const key='auto_'+String(task.updateId);
    if(state.sends[key]){if(task.waiting)pauseWaiting(c,'Результат прежней отправки не подтверждён');else transfer(state,c,'Результат прежней отправки не подтверждён',undefined,true);job.stage='done';return null;}
    job.stage='sending';job.leaseUntil=Date.now()+LEASE_MS;state.sends[key]={chatId:c.id,status:'pending',at:new Date().toISOString()};
    return {...task,key,text:decision.reply.trim(),asked:contactQuestion(decision.reply),before:c.messages.filter(m=>m.direction==='in').at(-1)?.id};
  });}
  async function deliver(task){
    let result;try{result=await telegram.send(task.chatId,task.text);}catch(_){result=null;}
    await store.transact(state=>{
      const job=owned(state,task),c=state.conversations[task.chatId];if(!job||job.stage!=='sending'||!c)return;
      const key=task.notice?task.jobId:task.key;
      if(!result||!result.ok){state.sends[key].status=result?'failed':'unknown';const issue=result?'Telegram не подтвердил отправку ответа':'Результат отправки неизвестен — проверьте Telegram';if(c.mode==='waiting')pauseWaiting(c,issue);else transfer(state,c,issue,undefined,true);job.stage='done';return;}
      state.sends[key].status='sent';
      if(task.asked&&c.messages.filter(m=>m.direction==='in').at(-1)?.id===task.before)c.awaitingContactReply=task.asked;
      c.messages.push({id:String(result.result?.message_id||key),direction:'out',author:task.notice?'system':'ai',text:task.text,at:new Date().toISOString()});job.stage='done';
    });
  }
  let processing=false,closed=false;
  function schedule(){if(!closed)setImmediate(()=>drain().catch(()=>console.error('Ошибка очереди тестового ИИ')));}
  async function drain(){
    if(processing||closed)return;processing=true;
    try{while(!closed){const task=await claimJob();if(!task)break;if(task.skip)continue;if(task.notice){await deliver(task);continue;}const outcome=await generate(task),send=await prepareSend(task,outcome);if(send)await deliver(send);}}
    finally{processing=false;}
  }
  const timer=setInterval(schedule,2000);timer.unref();store.ready.then(schedule).catch(()=>{});
  function files(req,res,pathname){const allowed={'/':['index.html','text/html; charset=utf-8'],'/index.html':['index.html','text/html; charset=utf-8'],'/css/app.css':['css/app.css','text/css; charset=utf-8'],'/js/app.js':['js/app.js','text/javascript; charset=utf-8'],'/js/telegram.js':['js/telegram.js','text/javascript; charset=utf-8']};if(!allowed[pathname])return false;const [name,type]=allowed[pathname];fs.readFile(path.join(__dirname,'..',name),(err,content)=>{if(err){fail(res,404,'Файл не найден');return;}res.writeHead(200,{'content-type':type,'cache-control':'no-cache','x-content-type-options':'nosniff'});res.end(content);});return true;}
  const server=http.createServer(async(req,res)=>{
    const pathname=new URL(req.url,'http://localhost').pathname;
    try{
      await store.ready;
      if(req.method==='GET'&&files(req,res,pathname))return;
      if(req.method==='GET'&&pathname==='/health'){await store.transact(()=>null);return json(res,200,{status:'ok',mode:'test-only',storage:store.kind});}
      if(req.method==='POST'&&pathname==='/api/telegram/webhook'){
        if(hookSecret.length<24||!equal(req.headers['x-telegram-bot-api-secret-token'],hookSecret))return fail(res,403,'Недопустимый webhook');
        const u=await body(req);if(!Number.isSafeInteger(u.update_id))return fail(res,400,'Некорректный update_id');
        const result=await store.transact(state=>{
          if(state.updates.includes(u.update_id))return response(200,{ok:true});
          const m=u.message;
          if(m&&m.chat&&m.chat.type==='private'&&(typeof m.chat.id==='number'||typeof m.chat.id==='string')){
            const id=String(m.chat.id);if(!/^-?\d{1,20}$/.test(id))return error(400,'Некорректный чат');
            let c=state.conversations[id];if(!c)c=state.conversations[id]={id,name:'Telegram · '+id,messages:[]};
            c.name=[m.from?.first_name,m.from?.last_name].filter(x=>typeof x==='string').join(' ').slice(0,100)||('Telegram · '+id);
            const text=typeof m.text==='string'?m.text.slice(0,4096):'[Вложение: откройте Telegram для просмотра]';
            initial(c);const incoming={id:String(m.message_id||u.update_id),direction:'in',text,at:new Date().toISOString()};c.messages.push(incoming);
            if(autoEnabled&&tg&&c.mode!=='assigned'&&!c.waitingPaused&&typeof m.text==='string'){
              const pending=c.awaitingContactReply,extracted=extractPatientInfo(text,pending&&typeof pending==='object'?pending:false);applyPatientInfo(c,extracted,incoming);
              if(pending&&typeof pending==='object'){if(extracted.name)pending.name=false;if(extracted.phone)pending.phone=false;pending.left=(pending.left||1)-1;if(pending.left<=0||(!pending.name&&!pending.phone))delete c.awaitingContactReply;}else delete c.awaitingContactReply;
            }
            const reason=typeof m.text==='string'?(emergency(text)?'Срочное сообщение — возможна угроза жизни':trigger(text)):'Вложение не обрабатывается — проверьте Telegram';
            if(c.mode==='waiting'&&c.handoff)c.handoff.summary=((c.handoff.initialContext?'Начальный запрос: '+c.handoff.initialContext+' | ':'')+shortContext(c)).slice(0,1200);
            if(c.mode==='waiting'&&reason)waitingIssue(c,reason);
            if(c.mode==='waiting'&&autoEnabled&&tg&&!c.waitingPaused){
              state.jobs.filter(j=>j.chatId===c.id&&j.stage==='queued'&&j.kind==='waiting_reply'&&!j.urgent).forEach(j=>j.stage='done');
              state.jobs.push({id:'job_'+u.update_id,updateId:u.update_id,chatId:id,kind:'waiting_reply',reply:typeof m.text!=='string'?'Вложение передано сотруднику. Я не могу его просмотреть; откройте Telegram для проверки.':safetyReply(text,reason),urgent:emergency(text),stage:'queued'});
            }
            if(c.mode==='ai'){
              if(reason)transfer(state,c,reason);else if(!autoEnabled)transfer(state,c,'Автоответ ИИ выключен: нужен сотрудник');else{
                const intake=routeIntake(c,text);
                if(intake){state.jobs.filter(j=>j.chatId===c.id&&j.stage==='queued'&&j.kind!=='notice').forEach(j=>j.stage='done');if(intake.handoff)transfer(state,c,intake.handoff);else state.jobs.push({id:'job_'+u.update_id,updateId:u.update_id,chatId:id,kind:'intake',reply:intake.reply,stage:'queued'});}
                else state.jobs.push({id:'job_'+u.update_id,updateId:u.update_id,chatId:id,stage:'queued'});
              }
            }
          }
          state.updates.push(u.update_id);state.updates=state.updates.slice(-3000);return response(200,{ok:true});
        });schedule();return json(res,result.status,result.data);
      }
      if(!pathname.startsWith('/api/'))return fail(res,404,'Страница не найдена');
      if(!auth(req,res))return;
      if(req.method==='GET'&&pathname==='/api/manual')return json(res,200,await store.transact(manual.list));
      if(req.method==='POST'&&pathname==='/api/manual/import'){const data=await body(req),result=await store.transact(state=>manual.importOne(state,data));return json(res,result.status,result.data);}
      const manualMatch=pathname.match(/^\/api\/manual\/(patients|tasks)\/((?:p|t)_[a-f0-9]{32})$/);
      if(req.method==='PUT'&&manualMatch){const data=await body(req),result=await store.transact(state=>manual.save(state,manualMatch[1]==='patients'?'patient':'task',manualMatch[2],data));return json(res,result.status,result.data);}
      if(req.method==='POST'&&pathname==='/api/setup-webhook'){
        if(!tg||hookSecret.length<24)return fail(res,503,'Проверьте TELEGRAM_BOT_TOKEN и TELEGRAM_WEBHOOK_SECRET (не менее 24 символов).');
        if(!/^[A-Za-z0-9_-]{24,256}$/.test(hookSecret))return fail(res,503,'TELEGRAM_WEBHOOK_SECRET: только буквы, цифры, дефис и подчёркивание.');
        let url;try{url=new URL(baseUrl);}catch(_){return fail(res,503,'Укажите HTTPS PUBLIC_BASE_URL или проверьте URL Render.');}
        if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)return fail(res,503,'Базовый URL должен быть HTTPS-адресом без пути и параметров.');
        const result=await telegram.setWebhook(baseUrl+'/api/telegram/webhook',hookSecret);return result.ok?json(res,200,{ok:true}):fail(res,502,'Telegram не подтвердил установку webhook.');
      }
      if(req.method==='GET'&&pathname==='/api/telegram/conversations'){
        const result=await store.transact(state=>Object.values(state.conversations).map(c=>({id:c.id,name:c.name,mode:initial(c).mode,reason:c.handoff?.reason||'',latest:c.messages.at(-1)?.at||null,preview:c.messages.at(-1)?.text||''})).sort((a,b)=>String(b.latest).localeCompare(String(a.latest))));return json(res,200,{items:result});
      }
      const match=pathname.match(/^\/api\/telegram\/conversations\/(-?\d{1,20})(?:\/(patient|send|take|resume))?$/);if(!match)return fail(res,404,'Не найдено');
      const id=match[1],action=match[2];
      if(req.method==='GET'&&!action){const result=await store.transact(state=>{const c=state.conversations[id];return !c?error(404,'Чат не найден'):response(200,{id:c.id,name:c.name,messages:c.messages,mode:initial(c).mode,handoff:c.handoff,autoEnabled,waitingAiActive:!!(autoEnabled&&tg&&c.mode==='waiting'&&!c.waitingPaused),patient:c.patient||null,patientVersion:Number.isSafeInteger(c.patientVersion)?c.patientVersion:0,patientSources:c.patientSources||{},patientVisibility:c.patientVisibility||{}});});return json(res,result.status,result.data);}
      if(req.method==='POST'&&['take','resume'].includes(action)){
        const result=await store.transact(state=>{const c=state.conversations[id];if(!c)return error(404,'Чат не найден');
          if(action==='resume'&&(!autoEnabled||!tg||ai.configError))return error(503,ai.configError||'Автоответ ИИ не включён или Telegram не настроен.');
          if(state.jobs.some(j=>j.chatId===id&&(j.stage==='sending'||(action==='resume'&&j.stage==='generating'))))return error(409,'Завершается предыдущее действие; обновите чат через несколько секунд.');
          delete c.intake;delete c.awaitingContactReply;delete c.waitingPaused;c.modeVersion=(c.modeVersion||0)+1;state.jobs.filter(j=>j.chatId===id&&j.stage==='queued').forEach(j=>j.stage='done');
          if(action==='resume'){c.mode='ai';c.handoff=null;}else{c.mode='assigned';if(!c.handoff)c.handoff={reason:'Сотрудник взял диалог в работу',summary:shortContext(c),at:new Date().toISOString()};}return response(200,{ok:true});});return json(res,result.status,result.data);
      }
      if(req.method==='POST'&&action==='patient'){
        const data=await body(req),fields=['name','phone','admin','doctor'];if(!data||typeof data!=='object'||Array.isArray(data)||fields.some(k=>typeof data[k]!=='string'||data[k].length>100)||!Number.isSafeInteger(data.expectedVersion)||data.expectedVersion<0)return fail(res,400,'Проверьте поля и версию карточки.');
        if(data.visibility!==undefined&&(!data.visibility||typeof data.visibility!=='object'||Array.isArray(data.visibility)||Object.keys(data.visibility).some(k=>!fields.includes(k))||fields.some(k=>typeof data.visibility[k]!=='boolean')))return fail(res,400,'Проверьте настройки отображения полей.');
        const result=await store.transact(state=>{const c=state.conversations[id];if(!c)return error(404,'Чат не найден');const version=Number.isSafeInteger(c.patientVersion)?c.patientVersion:0;if(data.expectedVersion!==version)return error(409,'Карточка изменилась. Закройте окно и откройте заново, чтобы не потерять новые данные.');const next=Object.fromEntries(fields.map(k=>[k,data[k].trim()])),changed=fields.filter(k=>(c.patient?.[k]||'')!==next[k]);const visibilityChanged=data.visibility&&fields.some(k=>data.visibility[k]!==((c.patientVisibility||{})[k]!==false));c.patient=next;c.patientSources||={};changed.forEach(k=>{c.patientSources[k]={source:'staff',at:new Date().toISOString()};});if(data.visibility)c.patientVisibility=Object.fromEntries(fields.map(k=>[k,data.visibility[k]]));if(changed.length||visibilityChanged)c.patientVersion=version+1;return response(200,{patient:c.patient,patientSources:c.patientSources,patientVisibility:c.patientVisibility||{},patientVersion:Number.isSafeInteger(c.patientVersion)?c.patientVersion:0});});return json(res,result.status,result.data);
      }
      if(req.method==='POST'&&action==='send'){
        if(!tg)return fail(res,503,'TELEGRAM_BOT_TOKEN не настроен.');const b=await body(req),text=typeof b.text==='string'?b.text.trim():'',key=String(b.requestId||'');if(!text||text.length>4096||!/^[a-zA-Z0-9_-]{16,100}$/.test(key))return fail(res,400,'Проверьте текст сообщения и идентификатор запроса.');
        const start=await store.transact(state=>{const c=state.conversations[id];if(!c)return error(404,'Чат не найден');if(state.sends[key])return error(409,'Этот запрос уже обрабатывался. Проверьте историю перед повторной отправкой.');if(state.jobs.some(j=>j.chatId===id&&j.stage==='sending'))return error(409,'ИИ уже отправляет ответ. Дождитесь результата и обновите чат.');delete c.intake;delete c.awaitingContactReply;delete c.waitingPaused;c.modeVersion=(c.modeVersion||0)+1;state.jobs.filter(j=>j.chatId===id&&j.stage==='queued').forEach(j=>j.stage='done');c.mode='assigned';if(!c.handoff)c.handoff={reason:'Сотрудник отвечает вручную',summary:shortContext(c),at:new Date().toISOString()};state.sends[key]={chatId:id,status:'pending',at:new Date().toISOString()};return response(200,{ok:true});});
        if(start.status!==200)return json(res,start.status,start.data);
        let sent;try{sent=await telegram.send(id,text);}catch(_){sent=null;}
        const finish=await store.transact(state=>{const c=state.conversations[id],entry=state.sends[key];if(!c||!entry)return error(502,'Результат отправки неизвестен. Проверьте Telegram перед повтором.');if(!sent){entry.status='unknown';return error(502,'Результат отправки неизвестен. Проверьте Telegram перед повтором.');}if(!sent.ok){entry.status='failed';return error(502,'Telegram не подтвердил отправку.');}entry.status='sent';c.messages.push({id:String(sent.result?.message_id||key),direction:'out',author:'admin',text,at:new Date().toISOString()});return response(200,{ok:true});});return json(res,finish.status,finish.data);
      }
      return fail(res,405,'Метод не поддерживается');
    }catch(e){if(e.message==='too_large')return fail(res,413,'Слишком большой запрос');if(e.message==='bad_json')return fail(res,400,'Некорректный JSON');console.error('Ошибка запроса:',e.code||e.name||'error');return fail(res,502,'Ошибка сервиса или хранилища. Проверьте настройки и журналы Render.');}
  });
  server.ready=store.ready;server.once('close',()=>{closed=true;clearInterval(timer);store.close().catch(()=>{});});return server;
}
module.exports={createServer};
