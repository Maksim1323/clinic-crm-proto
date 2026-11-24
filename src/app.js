'use strict';
// Test-only Telegram + configurable AI service. No patient data; no clinical use.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {readConfig} = require('./config');
const {openStore} = require('./storage/json-store');
const {createExternalClient} = require('./integrations/http-client');
const {createAI} = require('./integrations/ai');
const {createGigachatFetch} = require('./integrations/gigachat-transport');
const {createTelegram} = require('./integrations/telegram');
const {initial, context, shortContext, trigger, riskyOutput, aiFailureReason} = require('./workflow/triage');
const {routeIntake} = require('./workflow/intake');
const {WAITING_FALLBACK, EMERGENCY_RESPONSE, emergency, safetyReply} = require('./workflow/waiting');
const {extractPatientInfo, applyPatientInfo, contactQuestion} = require('./workflow/patient-autofill');

function createServer(options = {}) {
  const env = options.env || process.env;
  const callFetch = options.fetch || global.fetch;
  const config = readConfig(env, options.dataFile);
  const {file, admin, tg, hookSecret, baseUrl, autoEnabled} = config;
  const {state, persist} = openStore(file);
  const external = createExternalClient(callFetch);
  const telegram = createTelegram(external, tg);
  // Injection keeps tests offline; in production apply the CA only to GigaChat requests.
  const aiFetch = config.aiProvider === 'gigachat' && !options.fetch ? createGigachatFetch(callFetch) : callFetch;
  const aiExternal = aiFetch === callFetch ? external : createExternalClient(aiFetch);
  const ai = createAI(config, aiExternal, aiFetch);
  function equal(a,b) { const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||'')); return x.length === y.length && crypto.timingSafeEqual(x,y); }
  function json(res,status,data) { const body=JSON.stringify(data); res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}); res.end(body); }
  function fail(res,status,message) { json(res,status,{error:message}); }
  const authFailures = new Map();
  function auth(req,res) {
    const ip=req.socket.remoteAddress || 'unknown'; const now=Date.now(); const recent=(authFailures.get(ip)||[]).filter(t=>now-t<60000);
    if(recent.length>=15) {authFailures.set(ip,recent);fail(res,429,'Слишком много попыток. Подождите минуту.');return false;}
    if (admin.length < 24) {fail(res,503,'На сервере не настроен ADMIN_TOKEN (минимум 24 символа).');return false;}
    const value = (req.headers.authorization || '').replace(/^Bearer /, '');
    if (!equal(value,admin)) {recent.push(now);authFailures.set(ip,recent);fail(res,401,'Неверный ключ администратора.');return false;} authFailures.delete(ip);return true;
  }
  async function body(req) {
    let size=0, chunks=[]; for await (const c of req) {size+=c.length;if(size>64*1024) throw new Error('too_large');chunks.push(c);}
    if(!size)return {}; try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch(_){throw new Error('bad_json');}
  }
  function transfer(c,reason,summary) {
    initial(c); if(c.mode==='assigned')return;
    const wasAi=c.mode==='ai';
    const initialContext=c.intake?.initialText || '';
    const intakeContext=initialContext ? 'Начальный запрос: '+initialContext+' | '+shortContext(c) : shortContext(c);
    delete c.intake; c.mode='waiting'; c.modeVersion=(c.modeVersion || 0)+1; delete c.waitingPaused; c.handoff={reason:String(reason||'Нужна проверка сотрудника').slice(0,300),summary:String(summary||intakeContext).slice(0,1200),initialContext,at:new Date().toISOString()};
    if(wasAi && tg && autoEnabled) state.jobs.push({id:'notice_'+crypto.randomUUID().replaceAll('-',''),chatId:c.id,kind:'notice',stage:'queued',urgent:emergency(c.messages.at(-1)?.text)});
  }
  function waitingIssue(c, issue) {
    if(c.mode!=='waiting' || !c.handoff)return;
    if(!c.handoff.reason.includes(issue))c.handoff.reason=(issue+' · '+c.handoff.reason).slice(0,300);
  }
  function pauseWaiting(c, issue) { if(c.mode==='waiting'){c.waitingPaused=true;waitingIssue(c,issue);} }
  let processing = false;
  function schedule() { setImmediate(() => drain().catch(()=>console.error('Ошибка очереди тестового ИИ'))); }
  async function drain() {
    if(processing)return; processing=true;
    try {
      for (;;) {
        const job=state.jobs.find(j=>j.stage==='queued'); if(!job)break;
        const c=state.conversations[job.chatId];
        if(job.kind==='notice') {
          if(!c || initial(c).mode!=='waiting' || !tg || !autoEnabled || c.waitingPaused){job.stage='done';persist();continue;}
          const lastIncoming=c.messages.filter(m=>m.direction==='in').at(-1)?.text || '';
          const refusesQuestions=/(не\s+(?:хочу|буду|могу)\s+(?:указывать|оставлять|давать|сообщать|говорить|отвечать)|не спрашивайте|без вопросов|не нужен телефон|не звоните)/i.test(lastIncoming);
          const sensitive=job.urgent || refusesQuestions || /Медицинский|Несовершеннолетний|Жалоба|Срочное/i.test(c.handoff?.reason || '');
          const askName=!sensitive && !c.patient?.name, askPhone=!sensitive && !c.patient?.phone;
          const notice=job.urgent ? EMERGENCY_RESPONSE : sensitive
            ? 'Ваш вопрос передан сотруднику. Если хотите, можете добавить организационные детали — они будут видны в диалоге.'
            : askName ? 'Ваш вопрос передан сотруднику. Как к вам обращаться? Например: «Меня зовут Анна».'+(askPhone ? ' Если хотите, можете также указать телефон для связи.' : '')
            : 'Ваш вопрос передан сотруднику. Есть ли ещё организационные детали, которые вы хотели бы сообщить?'+(askPhone ? ' Если хотите, можете также указать телефон для связи.' : '');
          const beforeNotice=c.messages.filter(m=>m.direction==='in').at(-1)?.id;
          job.stage='sending';state.sends[job.id]={chatId:c.id,status:'pending',at:new Date().toISOString()};persist();
          try {
            const sent=await telegram.send(c.id, notice);
            if(sent.ok) {state.sends[job.id].status='sent';if((askName || askPhone) && c.messages.filter(m=>m.direction==='in').at(-1)?.id===beforeNotice)c.awaitingContactReply={name:askName,phone:askPhone,left:2};c.messages.push({id:String(sent.result?.message_id||job.id),direction:'out',author:'system',text:notice,at:new Date().toISOString()});}
            else {state.sends[job.id].status='failed';pauseWaiting(c,'Telegram не подтвердил уведомление');}
          } catch (_) {state.sends[job.id].status='unknown';pauseWaiting(c,'Результат отправки неизвестен — проверьте Telegram');}
          job.stage='done';persist();continue;
        }
        const waiting=job.kind==='waiting_reply', expectedMode=waiting ? 'waiting' : 'ai';
        if(!c || initial(c).mode!==expectedMode || (waiting && c.waitingPaused)) {job.stage='done';persist();continue;}
        if(!autoEnabled || !tg || (!waiting && ai.configError)) {
          if(!waiting)transfer(c,ai.configError || 'ИИ выключен или не настроен');
          job.stage='done';persist();continue;
        }
        const version=c.modeVersion || 0;
        job.stage='generating';persist();
        let decision;
        try {
          decision=job.kind==='intake' || (waiting && job.reply)
            ? {action:'reply',reply:job.reply,reason:'',summary:''}
            : waiting && ai.configError
              ? {action:'reply',reply:WAITING_FALLBACK,reason:'',summary:''}
              : await ai.decide(context(c),{waiting});
        } catch (error) {
          if(waiting) {
            if(c.mode==='waiting' && (c.modeVersion || 0)===version)waitingIssue(c,aiFailureReason(error,config.aiProvider));
            decision={action:'reply',reply:WAITING_FALLBACK,reason:'',summary:''};
          } else {if(c.mode==='ai' && (c.modeVersion || 0)===version)transfer(c,aiFailureReason(error, config.aiProvider));job.stage='done';persist();continue;}
        }
        // Taking or returning a chat invalidates even an in-flight generation (ABA safe).
        if(c.mode!==expectedMode || (c.modeVersion || 0)!==version || (waiting && c.waitingPaused)) {job.stage='done';persist();continue;}
        if(!job.urgent && state.jobs.some(next=>next.chatId===c.id && next.stage==='queued' && next.kind!=='notice')) {job.stage='done';persist();continue;}
        if(decision.action==='handoff' || !decision.reply.trim() || decision.reply.length>3500 || riskyOutput(decision.reply)) {
          if(waiting) decision={action:'reply',reply:WAITING_FALLBACK,reason:'',summary:''};
          else {transfer(c,decision.reason || 'Ответ ИИ требует проверки',decision.summary ? 'Сводка ИИ (требует проверки): '+decision.summary : undefined);job.stage='done';persist();continue;}
        }
        const key='auto_'+String(job.updateId);
        if(state.sends[key]) {
          if(waiting)pauseWaiting(c,'Результат прежней отправки не подтверждён');else transfer(c,'Результат прежней отправки не подтверждён');
          job.stage='done';persist();continue;
        }
        const beforeReply=c.messages.filter(m=>m.direction==='in').at(-1)?.id;
        job.stage='sending';state.sends[key]={chatId:c.id,status:'pending',at:new Date().toISOString()};persist();
        let result;
        try {result=await telegram.send(c.id, decision.reply.trim());}
        catch (_) {state.sends[key].status='unknown';if(waiting)pauseWaiting(c,'Результат отправки неизвестен — проверьте Telegram');else transfer(c,'Ошибка отправки ИИ: результат неизвестен, проверьте Telegram');job.stage='done';persist();continue;}
        if(!result.ok) {state.sends[key].status='failed';if(waiting)pauseWaiting(c,'Telegram не подтвердил отправку ответа');else transfer(c,'Telegram не подтвердил отправку ответа ИИ');job.stage='done';persist();continue;}
        state.sends[key].status='sent';
        const asked=contactQuestion(decision.reply);
        if(asked && c.messages.filter(m=>m.direction==='in').at(-1)?.id===beforeReply)c.awaitingContactReply=asked;
        c.messages.push({id:String(result.result?.message_id||key),direction:'out',author:'ai',text:decision.reply.trim(),at:new Date().toISOString()});job.stage='done';persist();
      }
    } finally { processing=false; }
  }
  // An interrupted generation/send has unknown outcome: transfer instead of retrying.
  let recovered=false;
  state.jobs.forEach(j=>{if(['generating','sending'].includes(j.stage)){const c=state.conversations[j.chatId];if(c){if(c.mode==='waiting')pauseWaiting(c,'Обработка прервалась: проверьте диалог и возможную отправку');else transfer(c,'Обработка прервалась: проверьте диалог и возможную отправку');}j.stage='done';recovered=true;}});
  if(recovered)persist();
  if(state.jobs.some(j=>j.stage==='queued'))schedule();
  function files(req,res,pathname) {
    const allowed={'/':['index.html','text/html; charset=utf-8'],'/index.html':['index.html','text/html; charset=utf-8'], '/css/app.css':['css/app.css','text/css; charset=utf-8'], '/js/app.js':['js/app.js','text/javascript; charset=utf-8'], '/js/telegram.js':['js/telegram.js','text/javascript; charset=utf-8']};
    if (!allowed[pathname]) return false;
    const [name,type]=allowed[pathname]; fs.readFile(path.join(__dirname,'..',name),(err,content)=>{if(err){fail(res,404,'Файл не найден');return;}res.writeHead(200,{'content-type':type,'cache-control':'no-cache','x-content-type-options':'nosniff'});res.end(content);});return true;
  }
  return http.createServer(async (req,res)=> {
    const pathname = new URL(req.url,'http://localhost').pathname;
    try {
      if(req.method==='GET' && files(req,res,pathname))return;
      if(req.method==='GET' && pathname==='/health') return json(res,200,{status:'ok',mode:'test-only'});
      if(req.method==='POST' && pathname==='/api/telegram/webhook') {
        if(hookSecret.length<24 || !equal(req.headers['x-telegram-bot-api-secret-token'],hookSecret))return fail(res,403,'Недопустимый webhook');
        const u=await body(req);
        if(!Number.isSafeInteger(u.update_id))return fail(res,400,'Некорректный update_id');
        if(state.updates.includes(u.update_id))return json(res,200,{ok:true});
        const m=u.message;
        if(m && m.chat && m.chat.type==='private' && (typeof m.chat.id==='number' || typeof m.chat.id==='string')) {
          const id=String(m.chat.id); if(!/^-?\d{1,20}$/.test(id))return fail(res,400,'Некорректный чат');
          let c=state.conversations[id]; if(!c)c=state.conversations[id]={id,name:'Telegram · '+id,messages:[]};
          c.name=[m.from?.first_name,m.from?.last_name].filter(x=>typeof x==='string').join(' ').slice(0,100)||('Telegram · '+id);
          const text=typeof m.text==='string' ? m.text.slice(0,4096) : '[Вложение: откройте Telegram для просмотра]';
          initial(c); const incoming={id:String(m.message_id||u.update_id),direction:'in',text,at:new Date().toISOString()};c.messages.push(incoming);
          if(autoEnabled && tg && c.mode!=='assigned' && !c.waitingPaused && typeof m.text==='string') {
            const pending=c.awaitingContactReply;
            const extracted=extractPatientInfo(text,pending && typeof pending==='object' ? pending : false);
            applyPatientInfo(c,extracted,incoming);
            if(pending && typeof pending==='object') {
              if(extracted.name)pending.name=false;if(extracted.phone)pending.phone=false;
              pending.left=(pending.left || 1)-1;
              if(pending.left<=0 || (!pending.name && !pending.phone))delete c.awaitingContactReply;
            } else delete c.awaitingContactReply;
          }
          const reason=typeof m.text==='string' ? (emergency(text) ? 'Срочное сообщение — возможна угроза жизни' : trigger(text)) : 'Вложение не обрабатывается — проверьте Telegram';
          if(c.mode==='waiting' && c.handoff) c.handoff.summary=(c.handoff.initialContext ? 'Начальный запрос: '+c.handoff.initialContext+' | ' : '') .concat(shortContext(c)).slice(0,1200);
          if(c.mode==='waiting' && reason)waitingIssue(c,reason);
          if(c.mode==='waiting' && autoEnabled && tg && !c.waitingPaused) {
            state.jobs.filter(j=>j.chatId===c.id && j.stage==='queued' && j.kind==='waiting_reply' && !j.urgent).forEach(j=>j.stage='done');
            const urgent=emergency(text);
            const reply=typeof m.text!=='string' ? 'Вложение передано сотруднику. Я не могу его просмотреть; откройте Telegram для проверки.' : safetyReply(text,reason);
            state.jobs.push({id:'job_'+u.update_id,updateId:u.update_id,chatId:id,kind:'waiting_reply',reply,urgent,stage:'queued'});
          }
          if(c.mode==='ai') {
            if(reason) transfer(c,reason);
            else if(!autoEnabled) transfer(c,'Автоответ ИИ выключен: нужен сотрудник');
            else {
              const intake=routeIntake(c,text);
              if(intake) {
                // Newer input replaces unsent intake questions and pending generations.
                state.jobs.filter(j=>j.chatId===c.id && j.stage==='queued' && j.kind!=='notice').forEach(j=>j.stage='done');
                if(intake.handoff)transfer(c,intake.handoff);
                else state.jobs.push({id:'job_'+u.update_id,updateId:u.update_id,chatId:id,kind:'intake',reply:intake.reply,stage:'queued'});
              } else state.jobs.push({id:'job_'+u.update_id,updateId:u.update_id,chatId:id,stage:'queued'});
            }
          }
        }
        state.updates.push(u.update_id);state.updates=state.updates.slice(-3000); persist(); schedule(); return json(res,200,{ok:true});
      }
      if(!pathname.startsWith('/api/'))return fail(res,404,'Страница не найдена');
      if(!auth(req,res))return;
      if(req.method==='POST' && pathname==='/api/setup-webhook') {
        if(!tg || hookSecret.length<24) return fail(res,503,'Проверьте TELEGRAM_BOT_TOKEN и TELEGRAM_WEBHOOK_SECRET (не менее 24 символов).');
        if(!/^[A-Za-z0-9_-]{24,256}$/.test(hookSecret))return fail(res,503,'TELEGRAM_WEBHOOK_SECRET: только буквы, цифры, дефис и подчёркивание.');
        let url; try{url=new URL(baseUrl);}catch(_){return fail(res,503,'Укажите HTTPS PUBLIC_BASE_URL или проверьте URL Render.');}
        if(url.protocol!=='https:' || url.username || url.password || url.pathname!=='/' || url.search || url.hash)return fail(res,503,'Базовый URL должен быть HTTPS-адресом без пути и параметров.');
        const result=await telegram.setWebhook(baseUrl+'/api/telegram/webhook', hookSecret);
        if(!result.ok)return fail(res,502,'Telegram не подтвердил установку webhook.');
        return json(res,200,{ok:true});
      }
      if(req.method==='GET' && pathname==='/api/telegram/conversations') {
        const items=Object.values(state.conversations).map(c=>({id:c.id,name:c.name,mode:initial(c).mode,reason:c.handoff?.reason||'',latest:c.messages.at(-1)?.at||null,preview:c.messages.at(-1)?.text||''})).sort((a,b)=>String(b.latest).localeCompare(String(a.latest)));
        return json(res,200,{items});
      }
      const match=pathname.match(/^\/api\/telegram\/conversations\/(-?\d{1,20})(?:\/(patient|send|take|resume))?$/);
      if(!match)return fail(res,404,'Не найдено');
      const c=state.conversations[match[1]];if(!c)return fail(res,404,'Чат не найден');
      if(req.method==='GET' && !match[2])return json(res,200,{id:c.id,name:c.name,messages:c.messages,mode:initial(c).mode,handoff:c.handoff,autoEnabled,waitingAiActive:!!(autoEnabled && tg && c.mode==='waiting' && !c.waitingPaused),patient:c.patient || null,patientVersion:Number.isSafeInteger(c.patientVersion)?c.patientVersion:0,patientSources:c.patientSources || {}});
      if(req.method==='POST' && match[2]==='take') {
        if(state.jobs.some(j=>j.chatId===c.id && j.stage==='sending'))return fail(res,409,'Ответ ИИ уже отправляется. Подождите и обновите чат.');
        delete c.intake;delete c.awaitingContactReply;delete c.waitingPaused;c.modeVersion=(c.modeVersion || 0)+1;state.jobs.filter(j=>j.chatId===c.id && j.stage==='queued').forEach(j=>j.stage='done');c.mode='assigned'; if(!c.handoff)c.handoff={reason:'Сотрудник взял диалог в работу',summary:shortContext(c),at:new Date().toISOString()};persist();return json(res,200,{ok:true});
      }
      if(req.method==='POST' && match[2]==='resume') {
        if(!autoEnabled || !tg || ai.configError)return fail(res,503,ai.configError || 'Автоответ ИИ не включён или Telegram не настроен.');
        if(state.jobs.some(j=>j.chatId===c.id && ['sending','generating'].includes(j.stage)))return fail(res,409,'Завершается предыдущее действие; обновите чат через несколько секунд.');
        state.jobs.filter(j=>j.chatId===c.id && j.stage==='queued').forEach(j=>j.stage='done');
        delete c.intake;delete c.awaitingContactReply;delete c.waitingPaused;c.modeVersion=(c.modeVersion || 0)+1;c.mode='ai';c.handoff=null;persist();return json(res,200,{ok:true});
      }
      if(req.method==='POST' && match[2]==='patient') {
        const data=await body(req), fields=['name','phone','admin','doctor'];
        if(!data || typeof data!=='object' || Array.isArray(data) || fields.some(key=>typeof data[key]!=='string' || data[key].length>100) || !Number.isSafeInteger(data.expectedVersion) || data.expectedVersion<0) return fail(res,400,'Проверьте поля и версию карточки.');
        const currentVersion=Number.isSafeInteger(c.patientVersion)?c.patientVersion:0;
        if(data.expectedVersion!==currentVersion)return fail(res,409,'Карточка изменилась. Закройте окно и откройте заново, чтобы не потерять новые данные.');
        const next=Object.fromEntries(fields.map(key=>[key,data[key].trim()]));
        const changed=fields.filter(key=>(c.patient?.[key] || '')!==next[key]);
        c.patient=next;c.patientSources ||= {};
        changed.forEach(key=>{c.patientSources[key]={source:'staff',at:new Date().toISOString()};});
        if(changed.length)c.patientVersion=currentVersion+1;
        persist();return json(res,200,{patient:c.patient,patientSources:c.patientSources,patientVersion:Number.isSafeInteger(c.patientVersion)?c.patientVersion:0});
      }
      if(req.method==='POST' && match[2]==='send') {
        if(!tg)return fail(res,503,'TELEGRAM_BOT_TOKEN не настроен.');
        const b=await body(req), text=typeof b.text==='string'?b.text.trim():'', key=String(b.requestId||'');
        if(!text || text.length>4096 || !/^[a-zA-Z0-9_-]{16,100}$/.test(key))return fail(res,400,'Проверьте текст сообщения и идентификатор запроса.');
        if(state.sends[key])return fail(res,409,'Этот запрос уже обрабатывался. Проверьте историю перед повторной отправкой.');
        if(state.jobs.some(j=>j.chatId===c.id && j.stage==='sending'))return fail(res,409,'ИИ уже отправляет ответ. Дождитесь результата и обновите чат.');
        delete c.intake;delete c.awaitingContactReply;delete c.waitingPaused;c.modeVersion=(c.modeVersion || 0)+1;state.jobs.filter(j=>j.chatId===c.id && j.stage==='queued').forEach(j=>j.stage='done');c.mode='assigned'; if(!c.handoff)c.handoff={reason:'Сотрудник отвечает вручную',summary:shortContext(c),at:new Date().toISOString()};
        state.sends[key]={chatId:c.id,status:'pending',at:new Date().toISOString()};persist();
        let result;
        try{result=await telegram.send(c.id, text);}
        catch(e){state.sends[key].status='unknown';persist();return fail(res,502,'Результат отправки неизвестен. Проверьте Telegram перед повтором.');}
        if(!result.ok){state.sends[key].status='failed';persist();return fail(res,502,'Telegram не подтвердил отправку.');}
        state.sends[key].status='sent';
        c.messages.push({id:String(result.result?.message_id||key),direction:'out',author:'admin',text,at:new Date().toISOString()});persist();
        return json(res,200,{ok:true});
      }
      return fail(res,405,'Метод не поддерживается');
    } catch(e) {
      if(e.message==='too_large')return fail(res,413,'Слишком большой запрос');
      if(e.message==='bad_json')return fail(res,400,'Некорректный JSON');
      console.error('Ошибка запроса:', e.code || e.name || 'error');
      return fail(res,502,'Ошибка сервиса или внешнего API. Проверьте настройки и журналы Render.');
    }
  });
}
module.exports={createServer};
