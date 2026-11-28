/* Telegram view uses the server serving this page. Credentials stay in tab memory. */
(() => {
  let adminToken = '', currentChat = null, poller = null, isSending = false, isResuming = false, telegramItems = [], sessionVersion = 0, isLoggingIn = false, patientLoaded = false, patientRevision = 0;
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
      throw new Error(data.error || 'Ошибка сервера');
    } return data;
  }
  window.crmApi=api;
  window.getTelegramPatientOptions=()=>telegramItems.map(c=>({id:c.id,name:c.name}));
  function status(message) { el('tg-status').textContent=message; }
  function updateButtons() { el('tg-send-btn').disabled=!currentChat || !patientLoaded || isSending || isResuming;el('tg-resume').disabled=!currentChat || !patientLoaded || isSending || isResuming;el('tg-patient-edit').disabled=!currentChat || !patientLoaded; }
  function showLogin() {el('crm-login-error').textContent='';el('tg-login-modal').classList.add('open');setTimeout(()=>el('tg-admin-token').focus(),30);}
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
  window.renderTelegramInboxItems = function(list) {
    telegramItems.forEach(c=>{
      const item=document.createElement('div');item.className='sidebar-item'+(c.id===currentChat?' active':'');item.dataset.source='telegram';
      const row=document.createElement('div');row.className='sidebar-item-row';row.append(text('div','✈️','ch-icon'));
      const box=document.createElement('div');box.className='ch-body';box.append(text('div',c.name,'ch-name'));
      if(c.mode==='waiting')box.append(text('div','🚩 Нужен человек','ch-preview'));else if(c.mode==='assigned')box.append(text('div','У сотрудника','ch-preview'));
      box.append(text('div',c.preview,'ch-preview'));row.append(box);item.append(row);
      item.onclick=()=>tgSelect(c.id);list.append(item);
    });
  };
  window.tgLogin = async function(){
    if(isLoggingIn)return;
    const supplied=el('tg-admin-token').value;el('tg-admin-token').value='';
    if(!supplied){el('crm-login-error').textContent='Введите ключ администратора.';return;}
    isLoggingIn=true;el('crm-login-submit').disabled=true;el('crm-login-error').textContent='';
    const version=++sessionVersion;adminToken=supplied;
    try {
      const data=await api('/api/telegram/conversations');
      if(version!==sessionVersion)return;
      await window.crmRefreshManual();
      if(version!==sessionVersion)return;
      el('tg-login-modal').classList.remove('open');el('crm-session-btn').textContent='Выйти';
      status('Подключено к тестовому серверу. Карточки Telegram привязаны к отдельным тестовым чатам.');showInbox(data.items);
      if(!poller)poller=setInterval(()=>{if(adminToken){tgRefresh(true);window.crmRefreshManual().catch(()=>{});}},10000);
    } catch(e) {
      if(version===sessionVersion){adminToken='';el('crm-login-error').textContent=e.message;}
    } finally {isLoggingIn=false;el('crm-login-submit').disabled=false;}
  };
  window.tgShowDemo = function(){
    currentChat=null;patientLoaded=false;++patientRevision;window.tgClosePatient();renderTgPatient(null);el('demo-patient-col').style.display='none';el('comms-empty').style.display='';el('tg-patient-col').style.display='none';updateButtons();
  };
  window.tgLogout = function(){
    ++sessionVersion;adminToken='';window.crmClearManual();window.tgShowDemo();el('tg-input').value='';el('tg-messages').replaceChildren();
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
  window.tgSelect = async function(id){window.tgClosePatient();currentChat=id;patientLoaded=false;++patientRevision;renderTgPatient(null);el('tg-chat-name').textContent='Загрузка диалога…';el('tg-messages').replaceChildren();el('tg-handoff-status').textContent='Загрузка…';el('tg-handoff-reason').textContent='';el('tg-handoff-summary').textContent='';el('tg-take').style.display='none';el('tg-resume').style.display='none';el('comms-empty').style.display='none';el('demo-patient-col').style.display='none';el('tg-patient-col').style.display='';el('tg-input').value='';updateButtons();renderInbox();await tgRefresh();};
  async function tgLoadMessages(){
    if(!currentChat)return;const chatId=currentChat, revision=patientRevision, data=await api('/api/telegram/conversations/'+encodeURIComponent(chatId));if(chatId!==currentChat || revision!==patientRevision)return;
    renderTgPatient(data.patient || null,data.patientSources || {},data.patientVersion || 0,data.patientVisibility || {});patientLoaded=true;updateButtons();el('tg-chat-name').textContent=data.name;const labels={ai:'ИИ ведёт диалог',waiting:data.waitingAiActive?'🚩 Нужен человек · ИИ может отвечать':'🚩 Нужен человек',assigned:'В работе сотрудника'};el('tg-handoff-status').textContent=labels[data.mode] || 'Неизвестно';el('tg-handoff-reason').textContent=data.handoff?.reason || (data.autoEnabled ? 'Новые сообщения обрабатывает ИИ.' : 'Автоответ ИИ выключен.');el('tg-handoff-summary').textContent=data.handoff?.summary || '';el('tg-take').style.display=data.mode==='waiting'?'':'none';el('tg-resume').style.display=data.mode==='assigned'?'':'none';const feed=el('tg-messages'); const nearBottom=feed.scrollHeight-feed.scrollTop-feed.clientHeight < 80;feed.replaceChildren();
    data.messages.forEach(m=>{
      const item=document.createElement('div');item.className='hist-item'; const top=document.createElement('div');top.className='hist-top';
      top.append(text('span',m.direction==='in'?'✈️':'👤','hist-icon'),text('span',m.direction==='in'?'Входящее · Telegram':m.author==='ai'?'ИИ · Telegram':m.author==='system'?'Система · Telegram':'Администратор · Telegram','hist-title'),text('span',new Date(m.at).toLocaleString('ru-RU'),'hist-date'));
      const content=text('div',m.text,'hist-body');content.style.whiteSpace='pre-wrap';item.append(top,content);feed.append(item);
    });if(nearBottom)feed.scrollTop=feed.scrollHeight;
  }
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
    for(const key of ['name','phone','admin','doctor'])el('tg-patient-'+key).closest('.profile-row').style.display=visibility[key]===false?'none':'';
    for(const key of ['name','phone']) {
      el('tg-patient-'+key+'-source').style.display=visibility[key]===false?'none':'';
      const source=selectedSources[key]?.source;
      el('tg-patient-'+key+'-source').textContent=!patient?.[key] ? '' : source==='telegram' ? 'Из Telegram · не проверено' : source==='staff' ? 'Указано сотрудником' : 'Источник не указан';
    }
  }
  window.tgEditPatient=function(){
    if(!currentChat || el('tg-patient-edit').disabled || isSavingPatient)return;
    patientEditChat=currentChat;patientEditVersion=selectedPatientVersion;
    for(const key of ['name','phone','admin','doctor']){el('tg-pf-'+key).value=selectedPatient?.[key] || '';el('tg-pf-show-'+key).checked=selectedVisibility[key]!==false;}
    el('tg-patient-error').textContent='';el('tg-patient-modal').classList.add('open');el('tg-pf-name').focus();
  };
  window.tgClosePatient=function(){patientEditChat=null;el('tg-patient-modal').classList.remove('open');};
  window.tgSavePatient=async function(){
    if(!patientEditChat || patientEditChat!==currentChat || isSavingPatient)return;
    const chat=patientEditChat, payload={expectedVersion:patientEditVersion,visibility:{}};for(const key of ['name','phone','admin','doctor']){payload[key]=el('tg-pf-'+key).value.trim();payload.visibility[key]=el('tg-pf-show-'+key).checked;}
    isSavingPatient=true;el('tg-patient-save').disabled=true;el('tg-patient-error').textContent='';
    try{
      const result=await api('/api/telegram/conversations/'+encodeURIComponent(chat)+'/patient','POST',payload);
      if(chat===currentChat && patientEditChat===chat){++patientRevision;renderTgPatient(result.patient,result.patientSources,result.patientVersion,result.patientVisibility || {});window.tgClosePatient();toast('Карточка сохранена');}
    }catch(e){if(e.message!=='session_changed' && chat===currentChat && patientEditChat===chat){el('tg-patient-error').textContent=e.message;if(e.message.startsWith('Карточка изменилась'))await tgRefresh(true);}}
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
  // One shared CRM entry point; Telegram does not need a separate login.
  showLogin();
})();
