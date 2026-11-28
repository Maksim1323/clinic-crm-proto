/* Telegram view uses the server serving this page. Credentials stay in tab memory. */
(() => {
  let adminToken = '', currentChat = null, poller = null, isSending = false, isResuming = false, telegramItems = [], sessionVersion = 0, isLoggingIn = false, patientLoaded = false, patientRevision = 0, selectedCaseVersion=0, selectedLinkId='', selectedLinkVersion=0, linkEditChat=null, linkEditVersion=0, isSavingLink=false, isSavingStatus=false;
  const el = id => document.getElementById(id);
  function uniqueRequestId() {
    if (!window.crypto || typeof window.crypto.getRandomValues !== 'function') {
      throw new Error('Для безопасной отправки откройте сайт по HTTPS.');
    }
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  }
  const text = (tag, value, cls) => { const node=document.createElement(tag); if(cls)node.className=cls;node.textContent=value;return node; };
  async function api(url, method='GET', payload) {
    const version = sessionVersion, token = adminToken;
    let response;
    try {
      response=await fetch(url,{method,headers:{'Authorization':'Bearer '+token,...(payload?{'Content-Type':'application/json'}:{})},...(payload?{body:JSON.stringify(payload)}:{}),cache:'no-store'});
    } catch (_) { if(version!==sessionVersion)throw new Error('session_changed');throw new Error('Сервер недоступен. Откройте адрес Web Service на Render.'); }
    if(version!==sessionVersion)throw new Error('session_changed');
    let data; try{data=await response.json();}catch(_){throw new Error('API не найден. Откройте адрес Web Service на Render, а не GitHub Pages.');}
    if(version!==sessionVersion)throw new Error('session_changed');
    if(!response.ok) {
      if(response.status===401){adminToken='';if(!isLoggingIn){window.tgLogout();el('crm-login-error').textContent='Сессия завершена. Войдите снова.';}}
      throw Object.assign(new Error(data.error || 'Ошибка сервера'),{code:data.code,details:data,status:response.status});
    } return data;
  }
  window.crmApi=api;
  window.crmUser=null;window.crmStaff=[];
  const roleDefaults={administrator:new Set(['name','phone','admin','stage','nospam','inclinic']),curator:new Set(['name','phone','admin','doctor','stage','plan','bonuses','nospam','note']),manager:new Set(['name','phone','age','gender','channel','admin','doctor','stage','bonuses','nps','nospam','inclinic','plan','note'])};
  window.crmFieldAllowed=key=>{const u=window.crmUser;if(!u)return false;if(u.role==='administrator'&&['plan','bonuses'].includes(key))return false;return typeof u.preferences?.[key]==='boolean'?u.preferences[key]:!!roleDefaults[u.role]?.has(key);};
  window.crmFillStaff=function(select,selected=''){select.replaceChildren(new Option('Не назначен',''));window.crmStaff.filter(u=>u.active).forEach(u=>select.add(new Option(u.name,u.id)));if(selected&&!window.crmStaff.some(u=>u.id===selected&&u.active))select.add(new Option('Неактивный сотрудник',selected));select.value=selected;};
  async function authPost(url,data){const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)}),value=await r.json();if(!r.ok)throw Error(value.error||'Ошибка входа');return value;}
  let needsBootstrap=false;
  async function setupLogin(){try{const r=await fetch('/api/auth/status'),v=await r.json();needsBootstrap=!v.configured;el('bootstrap-key-wrap').style.display=needsBootstrap?'':'none';el('bootstrap-name-wrap').style.display=needsBootstrap?'':'none';el('tg-login-title').textContent=needsBootstrap?'Создать управляющего':'Вход в CRM';el('login-hint').textContent=needsBootstrap?'Один раз укажите ADMIN_TOKEN и создайте личный логин и пароль (от 12 символов).':'Войдите под личной учётной записью.';el('crm-login-submit').textContent=needsBootstrap?'Создать и войти':'Войти';}catch(_){el('crm-login-error').textContent='Сервер недоступен.';}}
  window.crmSetUser=function(user){window.crmUser=user;document.querySelector('.user-name').textContent=user?.name||'CRM';document.querySelector('.user-role').textContent=({administrator:'Администратор',curator:'Куратор',manager:'Управляющий'})[user?.role]||'';el('crm-prefs-btn').style.display=user?'':'none';el('crm-assistant-btn').style.display=user?'':'none';el('crm-staff-btn').style.display=user?.role==='manager'?'':'none';el('crm-ai-btn').style.display=user?.role==='manager'?'':'none';document.querySelectorAll('#pf-plan,#pf-bonuses').forEach(e=>e.closest('.form-field').style.display=user?.role==='administrator'?'none':'');};

  window.getTelegramPatientOptions=()=>telegramItems.map(c=>({id:c.id,name:c.name}));
  function status(message) { el('tg-status').textContent=message; }
  function updateButtons() { el('tg-send-btn').disabled=!currentChat || !patientLoaded || isSending || isResuming;el('tg-resume').disabled=!currentChat || !patientLoaded || isSending || isResuming;el('tg-patient-edit').disabled=!currentChat || !patientLoaded;el('tg-link-open').disabled=!currentChat||!patientLoaded||isSavingLink;el('tg-case-status').disabled=!currentChat||!patientLoaded||isSavingStatus; }
  function showLogin() {el('crm-login-error').textContent='';el('tg-login-modal').classList.add('open');setupLogin();setTimeout(()=>el('crm-login-username').focus(),30);}
  window.crmSessionAction = function() { if(adminToken) window.tgLogout(); else showLogin(); };
  window.openTelegramView = function() { showView('comms'); if(!adminToken)showLogin();else tgRefresh(); };
  // A public demo can be opened without a token; server-side chats remain inaccessible.
  window.closeTelegramLogin = function(){if(isLoggingIn){++sessionVersion;adminToken='';}el('tg-admin-token').value='';el('tg-login-modal').classList.remove('open');showView('comms');};
  function showInbox(items) {
    telegramItems=items.slice().sort((a,b)=>(a.mode==='waiting'?0:1)-(b.mode==='waiting'?0:1));
    const waiting=telegramItems.filter(c=>c.mode==='waiting').length;
    el('tg-alert-count').textContent=String(waiting);el('tg-alert-count').style.display=waiting?'inline-flex':'none';
    renderInbox();
  }
  window.getTelegramInboxCount = () => telegramItems.length;
  window.tgHasSelectedChat = () => Boolean(currentChat);
  window.crmSelectedChat=()=>currentChat&&patientLoaded?{id:currentChat,name:el('tg-chat-name').textContent}:null;
  window.renderTelegramInboxItems = function(list) {
    telegramItems.forEach(c=>{
      const item=document.createElement('div');item.className='sidebar-item'+(c.id===currentChat?' active':'');item.dataset.source='telegram';
      const row=document.createElement('div');row.className='sidebar-item-row';row.append(text('div','✈️','ch-icon'));
      const box=document.createElement('div');box.className='ch-body';box.append(text('div',c.name,'ch-name'));
      if(c.mode==='waiting')box.append(text('div','🚩 Нужен человек','ch-preview'));else if(c.mode==='assigned')box.append(text('div','У сотрудника','ch-preview'));
      box.append(text('div','Обращение · '+({new:'Новое',in_progress:'В работе',resolved:'Завершено'}[c.caseStatus]||'Новое'),'ch-preview'));box.append(text('div',c.preview,'ch-preview'));row.append(box);item.append(row);
      item.onclick=()=>tgSelect(c.id);list.append(item);
    });
  };
  window.tgLogin = async function(){
    if(isLoggingIn)return;
    const supplied={login:el('crm-login-username').value.trim(),password:el('crm-login-password').value,name:el('crm-login-name').value.trim(),setupToken:el('tg-admin-token').value};el('crm-login-password').value='';el('tg-admin-token').value='';
    if(!supplied.login||!supplied.password){el('crm-login-error').textContent='Введите логин и пароль.';return;}
    isLoggingIn=true;el('crm-login-submit').disabled=true;el('crm-login-error').textContent='';
    const version=++sessionVersion;
    try {
      const auth=await authPost(needsBootstrap?'/api/auth/bootstrap':'/api/auth/login',supplied);if(version!==sessionVersion)return;adminToken=auth.token;window.crmSetUser(auth.user);
      const data=await api('/api/telegram/conversations');
      if(version!==sessionVersion)return;
      await window.crmRefreshManual();
      if(version!==sessionVersion)return;
      el('tg-login-modal').classList.remove('open');el('crm-session-btn').textContent='Выйти';
      status('Подключено к тестовому серверу. Карточки Telegram привязаны к отдельным тестовым чатам.');showInbox(data.items);
      if(!poller)poller=setInterval(()=>{if(adminToken){tgRefresh(true);window.crmRefreshManual().catch(()=>{});}},10000);
    } catch(e) {
      if(version===sessionVersion){adminToken='';window.crmSetUser(null);el('crm-login-error').textContent=e.message;setupLogin();}
    } finally {isLoggingIn=false;el('crm-login-submit').disabled=false;}
  };
  window.tgShowDemo = function(){
    currentChat=null;patientLoaded=false;++patientRevision;window.tgClosePatient();window.tgCloseLink();el('tg-linked-patient').replaceChildren();el('tg-linked-tasks').replaceChildren();el('tg-possible-duplicates').replaceChildren();renderTgPatient(null);el('demo-patient-col').style.display='none';el('comms-empty').style.display='';el('tg-patient-col').style.display='none';updateButtons();
  };
  window.tgLogout = function(){
    if(adminToken)fetch('/api/auth/logout',{method:'POST',headers:{Authorization:'Bearer '+adminToken}}).catch(()=>{});++sessionVersion;adminToken='';window.crmSetUser(null);window.crmAiReset?.();window.crmAssistantReset?.();window.crmStaff=[];window.crmClearManual();window.tgShowDemo();el('tg-input').value='';el('tg-messages').replaceChildren();
    telegramItems=[];el('tg-chat-name').textContent='Выберите диалог';el('tg-alert-count').style.display='none';
    el('tg-handoff-status').textContent='Выберите чат';el('tg-handoff-reason').textContent='';el('tg-handoff-summary').textContent='';
    el('tg-take').style.display='none';el('tg-resume').style.display='none';el('crm-session-btn').textContent='Войти';
    if(poller){clearInterval(poller);poller=null;}renderInbox();showView('comms');showLogin();
  };
  window.tgRefresh = async function(silent=false){
    if(!adminToken)return;
    try {
      const data=await api('/api/telegram/conversations');showInbox(data.items);
      if(currentChat)await tgLoadMessages();
    }catch(e){if(e.message==='session_changed')return;if(!adminToken){window.tgLogout();el('crm-login-error').textContent='Сессия завершена. Войдите снова.';return;}if(!silent){status(e.message);toast(e.message);}}
  };
  window.tgSelect = async function(id){window.tgClosePatient();window.tgCloseLink();currentChat=id;patientLoaded=false;++patientRevision;selectedLinkId='';selectedLinkVersion=0;selectedCaseVersion=0;el('tg-linked-patient').textContent='Загрузка…';el('tg-possible-duplicates').replaceChildren();el('tg-linked-tasks').replaceChildren();renderTgPatient(null);el('tg-chat-name').textContent='Загрузка диалога…';el('tg-messages').replaceChildren();el('tg-handoff-status').textContent='Загрузка…';el('tg-handoff-reason').textContent='';el('tg-handoff-summary').textContent='';el('tg-take').style.display='none';el('tg-resume').style.display='none';el('comms-empty').style.display='none';el('demo-patient-col').style.display='none';el('tg-patient-col').style.display='';el('tg-input').value='';updateButtons();renderInbox();await tgRefresh();};
  async function tgLoadMessages(){
    if(!currentChat)return;const chatId=currentChat, revision=patientRevision, data=await api('/api/telegram/conversations/'+encodeURIComponent(chatId));if(chatId!==currentChat || revision!==patientRevision)return;
    renderTgPatient(data.patient || null,data.patientSources || {},data.patientVersion || 0,data.patientVisibility || {});renderCaseDetails(data);window.crmFillStaff(el('tg-assignee-user'),data.assigneeUserId||'');patientLoaded=true;updateButtons();el('tg-chat-name').textContent=data.name;const labels={ai:'ИИ ведёт диалог',waiting:data.waitingAiActive?'🚩 Нужен человек · ИИ может отвечать':'🚩 Нужен человек',assigned:'В работе сотрудника'};el('tg-handoff-status').textContent=labels[data.mode] || 'Неизвестно';el('tg-handoff-reason').textContent=data.handoff?.reason || (data.autoEnabled ? 'Новые сообщения обрабатывает ИИ.' : 'Автоответ ИИ выключен.');el('tg-handoff-summary').textContent=data.handoff?.summary || '';el('tg-take').style.display=data.mode==='waiting'?'':'none';el('tg-resume').style.display=data.mode==='assigned'?'':'none';const feed=el('tg-messages'); const nearBottom=feed.scrollHeight-feed.scrollTop-feed.clientHeight < 80;feed.replaceChildren();
    data.messages.forEach(m=>{
      const item=document.createElement('div');item.className='hist-item'; const top=document.createElement('div');top.className='hist-top';
      top.append(text('span',m.direction==='in'?'✈️':'👤','hist-icon'),text('span',m.direction==='in'?'Входящее · Telegram':m.author==='ai'?'ИИ · Telegram':m.author==='system'?'Система · Telegram':(m.staffName||'Сотрудник')+' · Telegram','hist-title'),text('span',new Date(m.at).toLocaleString('ru-RU'),'hist-date'));
      const content=text('div',m.text,'hist-body');content.style.whiteSpace='pre-wrap';item.append(top,content);feed.append(item);
    });if(nearBottom)feed.scrollTop=feed.scrollHeight;
  }
  function renderCaseDetails(data){
    selectedLinkId=data.linkedPatientId||'';selectedLinkVersion=data.linkVersion||0;selectedCaseVersion=data.caseStatusVersion||0;if(!isSavingStatus)el('tg-case-status').value=data.caseStatus||'new';
    const box=el('tg-linked-patient');box.replaceChildren();const target=(window.crmGetManualPatientOptions?.()||[]).find(p=>p.id===selectedLinkId);
    if(target){const b=text('button',target.name+' · открыть карточку','badge');b.type='button';b.onclick=()=>window.crmOpenPatientRef(target.id);box.append(b);}else box.textContent=selectedLinkId?'Связанная карточка недоступна':'Связи нет';
    const dup=el('tg-possible-duplicates');dup.replaceChildren();if(data.possibleDuplicates?.length){dup.append(text('div','Возможные совпадения по телефону:'));for(const item of data.possibleDuplicates){const b=text('button',(item.kind==='telegram'?'Telegram · ':'Карточка · ')+(item.name||'Без имени'),'badge');b.type='button';b.onclick=()=>window.crmOpenPatientRef(item.id);dup.append(b);}}
    window.crmRenderRelatedTasks?.('tg-linked-tasks','tg_'+data.id);
  }
  window.tgTaskForChat=()=>{if(currentChat&&patientLoaded)window.crmTaskForReference('tg_'+currentChat);};
  window.tgOpenLink=function(){if(!currentChat||!patientLoaded||isSavingLink)return;linkEditChat=currentChat;linkEditVersion=selectedLinkVersion;const select=el('tg-link-select');select.replaceChildren(new Option('Нет связи',''));for(const p of window.crmGetManualPatientOptions?.()||[])select.add(new Option(p.name+' · '+p.phone,p.id));if(selectedLinkId&&!Array.from(select.options).some(o=>o.value===selectedLinkId))select.add(new Option('Карточка недоступна',selectedLinkId));select.value=selectedLinkId;el('tg-link-error').textContent='';el('tg-link-modal').classList.add('open');};
  window.tgCloseLink=()=>{linkEditChat=null;el('tg-link-select').replaceChildren();el('tg-link-modal').classList.remove('open');};
  window.tgSaveLink=async function(){if(!linkEditChat||linkEditChat!==currentChat||isSavingLink)return;const chat=linkEditChat;isSavingLink=true;el('tg-link-save').disabled=true;try{await api('/api/telegram/conversations/'+encodeURIComponent(chat)+'/link','POST',{patientId:el('tg-link-select').value,expectedVersion:linkEditVersion});if(chat===currentChat&&chat===linkEditChat){++patientRevision;window.tgCloseLink();await window.crmRefreshManual();await tgRefresh(true);toast('Связь сохранена');}}catch(e){if(e.message!=='session_changed'&&chat===currentChat&&chat===linkEditChat)el('tg-link-error').textContent=e.message;}finally{isSavingLink=false;el('tg-link-save').disabled=false;updateButtons();}};
  window.tgSetCaseStatus=async function(){if(!currentChat||!patientLoaded||isSavingStatus)return;const chat=currentChat,value=el('tg-case-status').value,version=selectedCaseVersion;isSavingStatus=true;updateButtons();try{await api('/api/telegram/conversations/'+encodeURIComponent(chat)+'/status','POST',{status:value,expectedVersion:version});if(chat===currentChat){++patientRevision;await tgRefresh(true);}}catch(e){if(e.message!=='session_changed'&&chat===currentChat){status(e.message);toast(e.message);await tgRefresh(true);}}finally{isSavingStatus=false;updateButtons();if(chat===currentChat)await tgRefresh(true);}};
  window.tgAssign=async function(){if(!currentChat||!patientLoaded)return;try{await api('/api/telegram/conversations/'+encodeURIComponent(currentChat)+'/assign','POST',{assigneeUserId:el('tg-assignee-user').value});toast('Ответственный сохранён');}catch(e){toast(e.message);await tgRefresh(true);}};
  window.tgTake = async function(){
    if(!currentChat || !patientLoaded)return;try{await api('/api/telegram/conversations/'+encodeURIComponent(currentChat)+'/take','POST',{});status('Диалог в работе сотрудника. ИИ поставлен на паузу.');await tgRefresh(true);}catch(e){status(e.message);toast(e.message);}
  };
  window.tgResume = async function(){
    if(!currentChat){toast('Сначала выберите диалог');return;}if(!patientLoaded || isResuming || isSending)return;
    const chat=currentChat;isResuming=true;updateButtons();
    try{await api('/api/telegram/conversations/'+encodeURIComponent(chat)+'/resume','POST',{});if(chat===currentChat)status('Диалог передан ИИ.');await tgRefresh(true);}
    catch(e){if(e.message!=='session_changed'){if(chat===currentChat)status(e.message);toast(e.message);}}
    finally{isResuming=false;updateButtons();}
  };
  let selectedPatient=null, selectedSources={}, selectedVisibility={}, selectedPatientVersion=0, patientEditChat=null, patientEditVersion=0, isSavingPatient=false;
  function renderTgPatient(patient,sources={},version=0,visibility={}) {
    selectedPatient=patient;selectedSources=sources;selectedPatientVersion=version;selectedVisibility=visibility;
    for(const [key,empty] of [['name','Не указано'],['phone','Не указан'],['admin','Не указан'],['doctor','Не указан']])el('tg-patient-'+key).textContent=patient?.[key] || empty;
    for(const key of ['name','phone','admin','doctor'])el('tg-patient-'+key).closest('.profile-row').style.display=visibility[key]===false||!window.crmFieldAllowed(key)?'none':'';
    for(const key of ['name','phone']) {
      el('tg-patient-'+key+'-source').style.display=visibility[key]===false||!window.crmFieldAllowed(key)?'none':'';
      const source=selectedSources[key]?.source;
      el('tg-patient-'+key+'-source').textContent=!patient?.[key] ? '' : source==='telegram' ? 'Из Telegram · не проверено' : source==='staff' ? 'Указано сотрудником' : 'Источник не указан';
    }
  }
  window.tgEditPatient=function(){
    if(!currentChat || el('tg-patient-edit').disabled || isSavingPatient)return;
    patientEditChat=currentChat;patientEditVersion=selectedPatientVersion;
    for(const key of ['name','phone','admin','doctor']){el('tg-pf-'+key).value=selectedPatient?.[key] || '';el('tg-pf-show-'+key).checked=selectedVisibility[key]!==false;}
    el('tg-patient-error').textContent='';el('tg-patient-duplicates').replaceChildren();el('tg-patient-modal').classList.add('open');el('tg-pf-name').focus();
  };
  window.tgClosePatient=function(){patientEditChat=null;el('tg-patient-duplicates').replaceChildren();el('tg-patient-modal').classList.remove('open');};
  window.tgSavePatient=async function(acknowledgedDuplicates=[]){
    if(!patientEditChat || patientEditChat!==currentChat || isSavingPatient)return;
    const chat=patientEditChat, payload={expectedVersion:patientEditVersion,visibility:{},acknowledgedDuplicates};for(const key of ['name','phone','admin','doctor']){payload[key]=el('tg-pf-'+key).value.trim();payload.visibility[key]=el('tg-pf-show-'+key).checked;}
    isSavingPatient=true;el('tg-patient-save').disabled=true;el('tg-patient-error').textContent='';
    try{
      const result=await api('/api/telegram/conversations/'+encodeURIComponent(chat)+'/patient','POST',payload);
      if(chat===currentChat && patientEditChat===chat){++patientRevision;renderTgPatient(result.patient,result.patientSources,result.patientVersion,result.patientVisibility || {});window.tgClosePatient();toast('Карточка сохранена');}
    }catch(e){if(e.message!=='session_changed' && chat===currentChat && patientEditChat===chat){el('tg-patient-error').textContent=e.message;if(e.code==='possible_duplicate'){const reviewed=payload.phone;window.crmShowDuplicates('tg-patient-duplicates',e.details.matches,ids=>{if(el('tg-pf-phone').value.trim()!==reviewed){el('tg-patient-error').textContent='Телефон изменён. Проверьте совпадения заново.';el('tg-patient-duplicates').replaceChildren();return;}window.tgSavePatient(ids);});}if(e.message.startsWith('Карточка изменилась'))await tgRefresh(true);}}
    finally{isSavingPatient=false;el('tg-patient-save').disabled=false;}
  };
  window.tgSend = async function(){
    if(!currentChat){toast('Сначала выберите диалог');return;}if(!patientLoaded || isSending || isResuming)return;
    const input=el('tg-input'), original=input.value, message=original.trim();if(!message){toast('Введите сообщение');return;}
    const chat=currentChat;
    let requestId;try{requestId=uniqueRequestId();}catch(e){status(e.message);toast(e.message);return;}
    isSending=true;updateButtons();
    try{
      await api('/api/telegram/conversations/'+encodeURIComponent(chat)+'/send','POST',{text:message,requestId});
      if(chat===currentChat){if(input.value===original)input.value='';status('Сообщение отправлено через Telegram.');}
      await tgRefresh(true);
    } catch(e){if(e.message!=='session_changed'){if(chat===currentChat)status(e.message);toast(e.message);}}
    finally{isSending=false;updateButtons();}
  };
  const labels={name:'Имя',phone:'Телефон',age:'Возраст',gender:'Пол',channel:'Канал',admin:'Ответственный',doctor:'Врач',stage:'Этап',bonuses:'Бонусы',nps:'NPS',nospam:'Отказ от рассылок',inclinic:'В клинике',plan:'План лечения',note:'Заметка'};
  window.crmOpenPreferences=function(){const box=el('crm-prefs-fields');box.replaceChildren();for(const [key,label] of Object.entries(labels)){if(window.crmUser?.role==='administrator'&&['plan','bonuses'].includes(key))continue;const row=document.createElement('label');row.className='form-check';const c=document.createElement('input');c.type='checkbox';c.dataset.pref=key;c.checked=window.crmFieldAllowed(key);row.append(c,document.createTextNode(label));box.append(row);}el('crm-prefs-error').textContent='';el('crm-prefs-modal').classList.add('open');};
  window.crmClosePreferences=()=>{el('crm-old-password').value='';el('crm-new-password').value='';el('crm-prefs-modal').classList.remove('open');};
  window.crmChangePassword=async function(){const currentPassword=el('crm-old-password').value,newPassword=el('crm-new-password').value;try{await api('/api/auth/password','POST',{currentPassword,newPassword});window.crmClosePreferences();window.tgLogout();el('crm-login-error').textContent='Пароль изменён. Войдите снова.';}catch(e){el('crm-prefs-error').textContent=e.message;}finally{el('crm-old-password').value='';el('crm-new-password').value='';}};
  window.crmSavePreferences=async function(){const prefs={};el('crm-prefs-fields').querySelectorAll('input').forEach(c=>prefs[c.dataset.pref]=c.checked);try{const r=await api('/api/auth/preferences','POST',prefs);window.crmSetUser(r.user);window.crmClosePreferences();await window.crmRefreshManual();await tgRefresh(true);}catch(e){el('crm-prefs-error').textContent=e.message;}};
  window.crmCloseStaff=()=>{el('staff-password').value='';el('crm-staff-modal').classList.remove('open');};
  window.crmOpenStaff=async function(){el('crm-staff-modal').classList.add('open');el('staff-error').textContent='';el('crm-audit-list').textContent='';try{const data=await api('/api/manage/staff');const box=el('crm-staff-list');box.replaceChildren();data.users.forEach(user=>{const row=document.createElement('div');row.style.cssText='display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap';row.append(text('span',user.name+' · '+user.login));const role=document.createElement('select');for(const [v,l] of [['administrator','Администратор'],['curator','Куратор'],['manager','Управляющий']])role.add(new Option(l,v));role.value=user.role;const button=text('button',user.active?'Отключить':'Включить','badge'),save=text('button','Изменить роль','badge');button.onclick=async()=>{try{await api('/api/manage/staff/'+user.id,'POST',{active:!user.active});await window.crmOpenStaff();}catch(e){el('staff-error').textContent=e.message;}};save.onclick=async()=>{try{await api('/api/manage/staff/'+user.id,'POST',{role:role.value});await window.crmOpenStaff();}catch(e){el('staff-error').textContent=e.message;}};const pass=document.createElement('input');pass.type='password';pass.placeholder='Новый пароль';pass.autocomplete='new-password';pass.style.cssText='width:150px;padding:5px';const reset=text('button','Сменить пароль','badge');reset.onclick=async()=>{try{await api('/api/manage/staff/'+user.id,'POST',{password:pass.value});pass.value='';await window.crmOpenStaff();}catch(e){pass.value='';el('staff-error').textContent=e.message;}};row.append(role,save,button,pass,reset);box.append(row);});}catch(e){el('staff-error').textContent=e.message;}};
  window.crmCreateStaff=async function(){try{await api('/api/manage/staff','POST',{name:el('staff-name').value.trim(),login:el('staff-login').value.trim(),password:el('staff-password').value,role:el('staff-role').value});el('staff-password').value='';el('staff-login').value='';el('staff-name').value='';await window.crmOpenStaff();}catch(e){el('staff-error').textContent=e.message;}};
  window.crmShowAudit=async function(){try{const data=await api('/api/manage/audit');el('crm-audit-list').textContent=data.items.map(x=>new Date(x.at).toLocaleString('ru-RU')+' · '+x.actorName+' · '+({account_created:'создал сотрудника',account_updated:'изменил сотрудника',password_changed:'сменил пароль',preferences_updated:'изменил настройки полей',record_created:'создал запись',record_updated:'изменил запись',automatic_stage_task_created:'создал задачу при смене этапа',telegram_patient_updated:'изменил карточку Telegram',conversation_assigned:'назначил ответственного',conversation_taken:'взял диалог',conversation_resumed:'вернул диалог ИИ',telegram_send_requested:'запросил отправку сообщения',webhook_setup:'настроил webhook',ai_settings_published:'опубликовал настройки ИИ',ai_settings_restored:'восстановил настройки ИИ',ai_auto_assigned:'автоматически назначил диалог',case_status_changed:'изменил статус обращения',conversation_patient_link_changed:'изменил связь с карточкой',staff_assistant_context_requested:'запросил обработку диалога помощником',staff_assistant_proposal_prepared:'подготовил предложение задачи',staff_assistant_task_confirmed:'подтвердил задачу помощника',login_success:'вошёл в систему',login_failed:'неудачная попытка входа',logout:'вышел из системы'}[x.action]||x.action)+' · '+x.type+' '+x.resourceId+(x.status?' · '+x.previousStatus+' → '+x.status:'')+(x.action==='conversation_patient_link_changed'?' · '+(x.previousPatientId||'нет')+' → '+(x.patientId||'нет'):'')).join('\n')||'Пока нет событий';}catch(e){el('staff-error').textContent=e.message;}};
  el('tg-pf-phone').addEventListener('input',()=>el('tg-patient-duplicates').replaceChildren());
  // One shared CRM entry point; Telegram does not need a separate login.
  showLogin();
})();
