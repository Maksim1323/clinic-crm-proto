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
const identity=require('./workflow/identity');
const aiSettings=require('./workflow/ai-settings');

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
  function limitBootstrap(req){const key=req.socket.remoteAddress||'unknown',now=Date.now(),r=(authFailures.get(key)||[]).filter(t=>now-t<60000);if(r.length>=10)return false;r.push(now);authFailures.set(key,r);return true;}
  const deny=(status,message)=>Object.assign(new Error(message),{httpStatus:status});
  async function body(req){let size=0,chunks=[];for await(const part of req){size+=part.length;if(size>64*1024)throw Error('too_large');chunks.push(part);}if(!size)return {};try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch(_){throw Error('bad_json');}}
  const response=(status,data)=>({status,data});
  const error=(status,message)=>response(status,{error:message});
  function autoAssign(state,c,preferred){
    if(c.assigneeUserId)return;const target=[preferred,aiSettings.current(state).config.defaultAssignee].find(id=>id&&state.staffUsers?.[id]?.active);
    if(target){c.assigneeUserId=target;identity.audit(state,{id:'system',name:'Система'},'ai_auto_assigned','conversation',c.id);}
  }
  function transfer(state,c,reason,summary,suppressNotice=false,preferred=''){
    initial(c);if(c.mode==='assigned')return;
    const wasAi=c.mode==='ai',initialContext=c.intake?.initialText||'';
    const info=initialContext?'Начальный запрос: '+initialContext+' | '+shortContext(c):shortContext(c);
    delete c.intake;c.mode='waiting';c.modeVersion=(c.modeVersion||0)+1;delete c.waitingPaused;
    c.handoff={reason:String(reason||'Нужна проверка сотрудника').slice(0,300),summary:String(summary||info).slice(0,1200),initialContext,at:new Date().toISOString()};autoAssign(state,c,preferred);
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
    const activeSettings=aiSettings.current(state);
    if(job.kind!=='notice'&&(job.settingsVersion??0)!==activeSettings.version){
      if(c.mode==='waiting')pauseWaiting(c,'Настройки ИИ изменились: проверьте диалог');else transfer(state,c,'Настройки ИИ изменились: проверьте диалог');job.stage='done';return {skip:true};
    }
    if(job.kind==='notice'){
      if(initial(c).mode!=='waiting'||!tg||!autoEnabled||c.waitingPaused){job.stage='done';return {skip:true};}
      const notice=queueHandoffNotice(c,job), owner=crypto.randomUUID();job.owner=owner;job.leaseUntil=now+LEASE_MS;job.stage='sending';
      state.sends[job.id]={chatId:c.id,status:'pending',at:new Date().toISOString()};
      return {jobId:job.id,owner,chatId:c.id,notice:true,text:notice.text,asked:notice.asked,before:c.messages.filter(m=>m.direction==='in').at(-1)?.id};
    }
    if(initial(c).mode!==expected||(waiting&&c.waitingPaused)){job.stage='done';return {skip:true};}
    if(!autoEnabled||!tg||(!waiting&&ai.configError)){if(!waiting)transfer(state,c,ai.configError||'ИИ выключен или не настроен');job.stage='done';return {skip:true};}
    const owner=crypto.randomUUID();job.owner=owner;job.leaseUntil=now+LEASE_MS;job.stage='generating';
    return {jobId:job.id,owner,chatId:c.id,waiting,expected,version:c.modeVersion||0,settingsVersion:activeSettings.version,clinic:activeSettings.config,kind:job.kind,reply:job.reply,urgent:!!job.urgent,history:context(c),updateId:job.updateId};
  });}
  async function generate(task){
    try {
      return {decision:task.kind==='intake'||(task.waiting&&task.reply)?{action:'reply',reply:task.reply,reason:'',summary:''}:task.waiting&&ai.configError?{action:'reply',reply:WAITING_FALLBACK,reason:'',summary:''}:await ai.decide(task.history,{waiting:task.waiting,clinic:task.clinic})};
    }catch(e){return {failure:aiFailureReason(e,config.aiProvider)};}
  }
  async function prepareSend(task,outcome){return store.transact(state=>{
    const job=owned(state,task),c=state.conversations[task.chatId];
    if(!job||job.stage!=='generating'||!c)return null;
    if(job.leaseUntil<=Date.now()){job.stage='done';if(c.mode==='waiting')pauseWaiting(c,'Обработка прервалась: проверьте диалог и возможную отправку');else transfer(state,c,'Обработка прервалась: проверьте диалог и возможную отправку',undefined,true);return null;}
    if(c.mode!==task.expected||(c.modeVersion||0)!==task.version||(task.waiting&&c.waitingPaused)){job.stage='done';return null;}
    if(aiSettings.current(state).version!==task.settingsVersion){if(task.waiting)pauseWaiting(c,'Настройки ИИ изменились: проверьте диалог');else transfer(state,c,'Настройки ИИ изменились: проверьте диалог');job.stage='done';return null;}
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
  function files(req,res,pathname){const allowed={'/':['index.html','text/html; charset=utf-8'],'/index.html':['index.html','text/html; charset=utf-8'],'/css/app.css':['css/app.css','text/css; charset=utf-8'],'/js/app.js':['js/app.js','text/javascript; charset=utf-8'],'/js/telegram.js':['js/telegram.js','text/javascript; charset=utf-8'],'/js/ai-settings-ui.js':['js/ai-settings-ui.js','text/javascript; charset=utf-8']};if(!allowed[pathname])return false;const [name,type]=allowed[pathname];fs.readFile(path.join(__dirname,'..',name),(err,content)=>{if(err){fail(res,404,'Файл не найден');return;}res.writeHead(200,{'content-type':type,'cache-control':'no-cache','x-content-type-options':'nosniff'});res.end(content);});return true;}
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
            const settings=aiSettings.current(state),custom=typeof m.text==='string'?aiSettings.match(settings.config,text):null;
            const reason=typeof m.text==='string'?(emergency(text)?'Срочное сообщение — возможна угроза жизни':trigger(text)|| (custom?'Дополнительное условие клиники':null)):'Вложение не обрабатывается — проверьте Telegram';
            if(c.mode==='waiting'&&c.handoff)c.handoff.summary=((c.handoff.initialContext?'Начальный запрос: '+c.handoff.initialContext+' | ':'')+shortContext(c)).slice(0,1200);
            if(c.mode==='waiting'&&reason){waitingIssue(c,reason);if(custom)autoAssign(state,c,custom.assigneeUserId);}
            if(c.mode==='waiting'&&autoEnabled&&tg&&!c.waitingPaused){
              state.jobs.filter(j=>j.chatId===c.id&&j.stage==='queued'&&j.kind==='waiting_reply'&&!j.urgent).forEach(j=>j.stage='done');
              state.jobs.push({id:'job_'+u.update_id,updateId:u.update_id,chatId:id,kind:'waiting_reply',reply:typeof m.text!=='string'?'Вложение передано сотруднику. Я не могу его просмотреть; откройте Telegram для проверки.':safetyReply(text,reason),urgent:emergency(text),settingsVersion:settings.version,stage:'queued'});
            }
            if(c.mode==='ai'){
              if(reason)transfer(state,c,reason,undefined,false,custom?.assigneeUserId);else if(!autoEnabled)transfer(state,c,'Автоответ ИИ выключен: нужен сотрудник');else{
                const intake=routeIntake(c,text,settings.config.wording);
                if(intake){state.jobs.filter(j=>j.chatId===c.id&&j.stage==='queued'&&j.kind!=='notice').forEach(j=>j.stage='done');if(intake.handoff)transfer(state,c,intake.handoff);else state.jobs.push({id:'job_'+u.update_id,updateId:u.update_id,chatId:id,kind:'intake',reply:intake.reply,settingsVersion:settings.version,stage:'queued'});}
                else state.jobs.push({id:'job_'+u.update_id,updateId:u.update_id,chatId:id,settingsVersion:settings.version,stage:'queued'});
              }
            }
          }
          state.updates.push(u.update_id);state.updates=state.updates.slice(-3000);return response(200,{ok:true});
        });schedule();return json(res,result.status,result.data);
      }
      if(!pathname.startsWith('/api/'))return fail(res,404,'Страница не найдена');
      if(req.method==='GET'&&pathname==='/api/auth/status'){const configured=await store.transact(s=>{identity.ensure(s);return Object.keys(s.staffUsers).length>0;});return json(res,200,{configured});}
      if(req.method==='POST'&&pathname==='/api/auth/bootstrap'){
        if(!limitBootstrap(req))return fail(res,429,'Слишком много попыток.');const d=await body(req),problem=identity.credentials(d.login,d.name,d.password);if(problem)return fail(res,400,problem);
        if(admin.length<24||!equal(d.setupToken,admin))return fail(res,403,'Неверный ключ первоначальной настройки.');
        const secret=await identity.passwordHash(d.password),r=await store.transact(s=>identity.bootstrap(s,d,secret));return r.error?fail(res,r.status,r.error):json(res,200,{user:r.user,token:r.token});
      }
      if(req.method==='POST'&&pathname==='/api/auth/login'){
        const d=await body(req);if(typeof d.login!=='string'||!/^[a-zA-Z0-9_.-]{3,40}$/.test(d.login)||typeof d.password!=='string'||Buffer.byteLength(d.password)>512)return fail(res,400,'Проверьте логин и пароль.');
        const snapshot=await store.transact(s=>{identity.ensure(s);return {count:identity.currentFailures(s,d.login).length,user:Object.values(s.staffUsers).find(u=>u.login.toLowerCase()===d.login.toLowerCase())||null};});
        if(snapshot.count>=10)return fail(res,429,'Слишком много попыток. Подождите минуту.');
        const verified=await identity.passwordMatches(d.password,snapshot.user?.password||{salt:'00000000000000000000000000000000',hash:'0'.repeat(64)});
        const r=await store.transact(s=>{identity.ensure(s);const u=snapshot.user&&s.staffUsers[snapshot.user.id];if(!verified||!u?.active||u.password.hash!==snapshot.user.password.hash){identity.failure(s,d.login);return null;}delete s.staffLoginFailures[identity.hash(d.login.toLowerCase())];return {user:identity.publicUser(u),token:identity.issue(s,u)};});
        return r?json(res,200,r):fail(res,401,'Неверный логин или пароль.');
      }
      const token=(req.headers.authorization||'').replace(/^Bearer /,'');let actor;
      const tx=fn=>store.transact(s=>{const u=identity.resolve(s,token);if(!u)throw deny(401,'Сессия закончилась. Войдите снова.');actor=u;return fn(s,u);});
      await tx(()=>null);
      if(req.method==='GET'&&pathname==='/api/auth/me')return json(res,200,await tx((s,u)=>identity.publicUser(u)));
      if(req.method==='POST'&&pathname==='/api/auth/logout'){await tx(s=>{delete s.staffSessions[identity.hash(token)];});return json(res,200,{ok:true});}
      if(req.method==='POST'&&pathname==='/api/auth/password'){
        const d=await body(req);if(typeof d.currentPassword!=='string'||Buffer.byteLength(d.currentPassword)>512||typeof d.newPassword!=='string'||d.newPassword.length<12||Buffer.byteLength(d.newPassword)>512)return fail(res,400,'Новый пароль: не менее 12 символов.');
        const previous=actor.password,valid=await identity.passwordMatches(d.currentPassword,previous);if(!valid)return fail(res,403,'Неверный текущий пароль.');const secret=await identity.passwordHash(d.newPassword);
        const result=await tx((s,u)=>{if(u.password.hash!==previous.hash)throw deny(409,'Пароль уже изменён. Войдите снова.');u.password=secret;identity.revoke(s,u.id);identity.audit(s,u,'password_changed','staff',u.id);return {ok:true};});return json(res,200,result);
      }
      if(req.method==='GET'&&pathname==='/api/staff')return json(res,200,await tx(s=>Object.values(s.staffUsers).map(u=>({id:u.id,name:u.name,role:u.role,active:u.active}))));
      if(req.method==='GET'&&pathname==='/api/manage/staff'){const r=await tx((s,u)=>u.role==='manager'?{users:Object.values(s.staffUsers).map(identity.publicUser)}:null);return r?json(res,200,r):fail(res,403,'Только управляющий.');}
      if(req.method==='POST'&&pathname==='/api/manage/staff'){
        const d=await body(req),problem=identity.credentials(d.login,d.name,d.password);if(problem||!identity.ROLES.has(d.role))return fail(res,400,problem||'Укажите роль.');const secret=await identity.passwordHash(d.password);
        const r=await tx((s,u)=>u.role==='manager'?identity.create(s,{...d,secret},u):{error:'Только управляющий.'});return r.error?fail(res,actor.role==='manager'?400:403,r.error):json(res,200,r);
      }
      const staffMatch=pathname.match(/^\/api\/manage\/staff\/(u_[a-f0-9]{32})$/);
      if(req.method==='POST'&&staffMatch){const d=await body(req);if(d.password!==undefined&&(typeof d.password!=='string'||d.password.length<12||Buffer.byteLength(d.password)>512))return fail(res,400,'Пароль: не менее 12 символов.');const secret=d.password!==undefined?await identity.passwordHash(d.password):undefined;
        const r=await tx((s,u)=>identity.setupRoles(s,u,staffMatch[1],{role:d.role,active:d.active,name:d.name,secret}));return r.error?fail(res,r.status,r.error):json(res,200,r);}
      if(req.method==='GET'&&pathname==='/api/manage/audit'){const r=await tx((s,u)=>u.role==='manager'?s.audit.slice(-500).reverse():null);return r?json(res,200,{items:r}):fail(res,403,'Только управляющий.');}
      if(req.method==='POST'&&pathname==='/api/auth/preferences'){const d=await body(req),allowed=['name','phone','age','gender','channel','admin','doctor','stage','bonuses','nps','nospam','inclinic','plan','note'];if(!d||typeof d!=='object'||Array.isArray(d)||Object.keys(d).some(k=>!allowed.includes(k)||typeof d[k]!=='boolean'))return fail(res,400,'Проверьте настройки.');const result=await tx((s,u)=>{u.preferences={...d};identity.audit(s,u,'preferences_updated','staff',u.id);return identity.publicUser(u);});return json(res,200,{user:result});}

      if(req.method==='GET'&&pathname==='/api/manage/ai-settings'){
        const data=await tx((s,u)=>u.role==='manager'?{current:aiSettings.current(s),versions:aiSettings.history(s)}:null);return data?json(res,200,data):fail(res,403,'Только управляющий может изменять настройки ИИ.');
      }
      if(req.method==='POST'&&pathname==='/api/manage/ai-settings/preview'){
        const d=await body(req);if(typeof d.sample!=='string'||d.sample.length>500||!Number.isSafeInteger(d.expectedVersion))return fail(res,400,'Проверьте пример и версию.');
        const r=await tx((s,u)=>{if(u.role!=='manager')return error(403,'Только управляющий может изменять настройки ИИ.');if(aiSettings.current(s).version!==d.expectedVersion)return error(409,'Настройки изменились. Откройте их заново.');
          const checked=aiSettings.validate(d.config,s);if(checked.errors.length)return response(200,{valid:false,errors:checked.errors});s.aiSettingsPreviews||={};s.aiSettingsPreviews[u.id]={digest:aiSettings.digest(checked.config),base:d.expectedVersion,at:Date.now()};
          return response(200,{valid:true,config:checked.config,preview:aiSettings.preview(checked.config,d.sample),warnings:['Проверка правил и шаблонов не вызывает модель и не гарантирует качество её ответа.','Встроенные ограничения и сценарии имеют приоритет. Сведения клиники нужно проверять вручную.']});});return json(res,r.status,r.data);
      }
      if(req.method==='PUT'&&pathname==='/api/manage/ai-settings'){
        const d=await body(req);if(!Number.isSafeInteger(d.expectedVersion)||!(d.restoredFrom===null||Number.isSafeInteger(d.restoredFrom)))return fail(res,400,'Проверьте версию настроек.');
        const r=await tx((s,u)=>{if(u.role!=='manager')return error(403,'Только управляющий может изменять настройки ИИ.');const current=aiSettings.current(s);if(current.version!==d.expectedVersion)return error(409,'Настройки изменились. Откройте их заново.');
          const checked=aiSettings.validate(d.config,s);if(checked.errors.length)return error(400,checked.errors.join(' '));const digest=aiSettings.digest(checked.config),p=s.aiSettingsPreviews?.[u.id];
          if(!p||p.base!==current.version||p.digest!==digest||Date.now()-p.at<0||Date.now()-p.at>600000)return error(409,'Сначала повторно проверьте эти настройки.');
          if(d.restoredFrom!==null){const old=aiSettings.history(s).find(v=>v.version===d.restoredFrom);if(!old||aiSettings.digest(old.config)!==digest)return error(400,'Восстанавливаемая версия отличается от проверенных настроек.');}
          const next={version:current.version+1,config:checked.config,savedAt:new Date().toISOString(),savedBy:u.name,savedById:u.id,restoredFrom:d.restoredFrom};if(!s.aiSettingsVersions?.length)s.aiSettingsVersions=[aiSettings.baseline()];s.aiSettingsVersions.push(next);delete s.aiSettingsPreviews[u.id];identity.audit(s,u,d.restoredFrom===null?'ai_settings_published':'ai_settings_restored','ai_settings',String(next.version));return response(200,{current:next});});return json(res,r.status,r.data);
      }

      if(req.method==='GET'&&pathname==='/api/manual')return json(res,200,await tx((s,u)=>manual.list(s,u)));
      if(req.method==='POST'&&pathname==='/api/manual/import'){const data=await body(req),result=await tx(state=>manual.importOne(state,data,actor));return json(res,result.status,result.data);}
      const manualMatch=pathname.match(/^\/api\/manual\/(patients|tasks)\/((?:p|t)_[a-f0-9]{32})$/);
      if(req.method==='PUT'&&manualMatch){const data=await body(req),result=await tx(state=>manual.save(state,manualMatch[1]==='patients'?'patient':'task',manualMatch[2],data,actor));return json(res,result.status,result.data);}
      if(req.method==='POST'&&pathname==='/api/setup-webhook'){
        if(!tg||hookSecret.length<24)return fail(res,503,'Проверьте TELEGRAM_BOT_TOKEN и TELEGRAM_WEBHOOK_SECRET (не менее 24 символов).');
        if(!/^[A-Za-z0-9_-]{24,256}$/.test(hookSecret))return fail(res,503,'TELEGRAM_WEBHOOK_SECRET: только буквы, цифры, дефис и подчёркивание.');
        let url;try{url=new URL(baseUrl);}catch(_){return fail(res,503,'Укажите HTTPS PUBLIC_BASE_URL или проверьте URL Render.');}
        if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)return fail(res,503,'Базовый URL должен быть HTTPS-адресом без пути и параметров.');
        await tx((s,u)=>{if(u.role!=='manager')throw deny(403,'Только управляющий может настроить webhook.');identity.audit(s,u,'webhook_setup','integration','telegram');});
        const result=await telegram.setWebhook(baseUrl+'/api/telegram/webhook',hookSecret);return result.ok?json(res,200,{ok:true}):fail(res,502,'Telegram не подтвердил установку webhook.');
      }
      if(req.method==='GET'&&pathname==='/api/telegram/conversations'){
        const result=await tx(state=>Object.values(state.conversations).map(c=>({id:c.id,name:c.name,mode:initial(c).mode,reason:c.handoff?.reason||'',latest:c.messages.at(-1)?.at||null,preview:c.messages.at(-1)?.text||''})).sort((a,b)=>String(b.latest).localeCompare(String(a.latest))));return json(res,200,{items:result});
      }
      const match=pathname.match(/^\/api\/telegram\/conversations\/(-?\d{1,20})(?:\/(patient|send|take|resume|assign))?$/);if(!match)return fail(res,404,'Не найдено');
      const id=match[1],action=match[2];
      if(req.method==='GET'&&!action){const result=await tx(state=>{const c=state.conversations[id];return !c?error(404,'Чат не найден'):response(200,{id:c.id,name:c.name,messages:c.messages,mode:initial(c).mode,handoff:c.handoff,autoEnabled,waitingAiActive:!!(autoEnabled&&tg&&c.mode==='waiting'&&!c.waitingPaused),patient:c.patient||null,patientVersion:Number.isSafeInteger(c.patientVersion)?c.patientVersion:0,patientSources:c.patientSources||{},patientVisibility:c.patientVisibility||{},assigneeUserId:c.assigneeUserId||''});});return json(res,result.status,result.data);}
      if(req.method==='POST'&&action==='assign'){const d=await body(req);if(typeof d.assigneeUserId!=='string')return fail(res,400,'Выберите сотрудника.');const r=await tx((s,u)=>{const c=s.conversations[id];if(!c)return error(404,'Чат не найден');if(d.assigneeUserId&&(!identity.VALID_ID.test(d.assigneeUserId)||!s.staffUsers[d.assigneeUserId]?.active))return error(400,'Выберите активного сотрудника.');c.assigneeUserId=d.assigneeUserId;identity.audit(s,u,'conversation_assigned','conversation',id);return response(200,{ok:true});});return json(res,r.status,r.data);}
      if(req.method==='POST'&&['take','resume'].includes(action)){
        const result=await tx(state=>{const c=state.conversations[id];if(!c)return error(404,'Чат не найден');
          if(action==='resume'&&(!autoEnabled||!tg||ai.configError))return error(503,ai.configError||'Автоответ ИИ не включён или Telegram не настроен.');
          if(state.jobs.some(j=>j.chatId===id&&(j.stage==='sending'||(action==='resume'&&j.stage==='generating'))))return error(409,'Завершается предыдущее действие; обновите чат через несколько секунд.');
          delete c.intake;delete c.awaitingContactReply;delete c.waitingPaused;c.modeVersion=(c.modeVersion||0)+1;state.jobs.filter(j=>j.chatId===id&&j.stage==='queued').forEach(j=>j.stage='done');
          if(action==='resume'){c.mode='ai';c.handoff=null;}else{c.mode='assigned';if(!c.handoff)c.handoff={reason:'Сотрудник взял диалог в работу',summary:shortContext(c),at:new Date().toISOString()};}identity.audit(state,actor,action==='take'?'conversation_taken':'conversation_resumed','conversation',id);return response(200,{ok:true});});return json(res,result.status,result.data);
      }
      if(req.method==='POST'&&action==='patient'){
        const data=await body(req),fields=['name','phone','admin','doctor'];if(!data||typeof data!=='object'||Array.isArray(data)||fields.some(k=>typeof data[k]!=='string'||data[k].length>100)||!Number.isSafeInteger(data.expectedVersion)||data.expectedVersion<0)return fail(res,400,'Проверьте поля и версию карточки.');
        if(data.visibility!==undefined&&(!data.visibility||typeof data.visibility!=='object'||Array.isArray(data.visibility)||Object.keys(data.visibility).some(k=>!fields.includes(k))||fields.some(k=>typeof data.visibility[k]!=='boolean')))return fail(res,400,'Проверьте настройки отображения полей.');
        const result=await tx(state=>{const c=state.conversations[id];if(!c)return error(404,'Чат не найден');const version=Number.isSafeInteger(c.patientVersion)?c.patientVersion:0;if(data.expectedVersion!==version)return error(409,'Карточка изменилась. Закройте окно и откройте заново, чтобы не потерять новые данные.');const next=Object.fromEntries(fields.map(k=>[k,data[k].trim()])),changed=fields.filter(k=>(c.patient?.[k]||'')!==next[k]);const visibilityChanged=data.visibility&&fields.some(k=>data.visibility[k]!==((c.patientVisibility||{})[k]!==false));c.patient=next;c.patientSources||={};changed.forEach(k=>{c.patientSources[k]={source:'staff',at:new Date().toISOString()};});if(data.visibility)c.patientVisibility=Object.fromEntries(fields.map(k=>[k,data.visibility[k]]));if(changed.length||visibilityChanged){c.patientVersion=version+1;identity.audit(state,actor,'telegram_patient_updated','conversation',id);}return response(200,{patient:c.patient,patientSources:c.patientSources,patientVisibility:c.patientVisibility||{},patientVersion:Number.isSafeInteger(c.patientVersion)?c.patientVersion:0});});return json(res,result.status,result.data);
      }
      if(req.method==='POST'&&action==='send'){
        if(!tg)return fail(res,503,'TELEGRAM_BOT_TOKEN не настроен.');const b=await body(req),text=typeof b.text==='string'?b.text.trim():'',key=String(b.requestId||'');if(!text||text.length>4096||!/^[a-zA-Z0-9_-]{16,100}$/.test(key))return fail(res,400,'Проверьте текст сообщения и идентификатор запроса.');
        const start=await tx(state=>{const c=state.conversations[id];if(!c)return error(404,'Чат не найден');if(state.sends[key])return error(409,'Этот запрос уже обрабатывался. Проверьте историю перед повторной отправкой.');if(state.jobs.some(j=>j.chatId===id&&j.stage==='sending'))return error(409,'ИИ уже отправляет ответ. Дождитесь результата и обновите чат.');delete c.intake;delete c.awaitingContactReply;delete c.waitingPaused;c.modeVersion=(c.modeVersion||0)+1;state.jobs.filter(j=>j.chatId===id&&j.stage==='queued').forEach(j=>j.stage='done');c.mode='assigned';if(!c.handoff)c.handoff={reason:'Сотрудник отвечает вручную',summary:shortContext(c),at:new Date().toISOString()};state.sends[key]={chatId:id,status:'pending',at:new Date().toISOString(),actorId:actor.id,actorName:actor.name};identity.audit(state,actor,'telegram_send_requested','conversation',id);return response(200,{ok:true});});
        if(start.status!==200)return json(res,start.status,start.data);
        let sent;try{sent=await telegram.send(id,text);}catch(_){sent=null;}
        const finish=await store.transact(state=>{const c=state.conversations[id],entry=state.sends[key];if(!c||!entry)return error(502,'Результат отправки неизвестен. Проверьте Telegram перед повтором.');if(!sent){entry.status='unknown';return error(502,'Результат отправки неизвестен. Проверьте Telegram перед повтором.');}if(!sent.ok){entry.status='failed';return error(502,'Telegram не подтвердил отправку.');}entry.status='sent';c.messages.push({id:String(sent.result?.message_id||key),direction:'out',author:'admin',staffId:entry.actorId,staffName:entry.actorName,text,at:new Date().toISOString()});return response(200,{ok:true});});return json(res,finish.status,finish.data);
      }
      return fail(res,405,'Метод не поддерживается');
    }catch(e){if(e.httpStatus)return fail(res,e.httpStatus,e.message);if(e.message==='too_large')return fail(res,413,'Слишком большой запрос');if(e.message==='bad_json')return fail(res,400,'Некорректный JSON');console.error('Ошибка запроса:',/^(?:invalid_relational_[a-z_]+|relational_[a-z_]+|legacy_state_roundtrip_mismatch|unsupported_relational_schema)$/.test(e.message)?e.message:(e.code||e.name||'error'));return fail(res,502,'Ошибка сервиса или хранилища. Проверьте настройки и журналы Render.');}
  });
  server.ready=store.ready;server.once('close',()=>{closed=true;clearInterval(timer);store.close().catch(()=>{});});return server;
}
module.exports={createServer};
