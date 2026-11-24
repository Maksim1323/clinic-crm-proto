/* Telegram view uses the server serving this page. Credentials stay in tab memory. */
(() => {
  let adminToken = '', currentChat = null, poller = null, isSending = false, isDrafting = false, telegramItems = [], sessionVersion = 0, isLoggingIn = false;
  const el = id => document.getElementById(id);
  let pendingConfirmation = null;
  function askConfirmation(message) {
    if (pendingConfirmation) return Promise.resolve(false);
    el('tg-confirm-message').textContent = message;
    el('tg-confirm-modal').classList.add('open');
    return new Promise(resolve => {
      pendingConfirmation = resolve;
      el('tg-confirm-accept').focus();
    });
  }
  window.tgConfirmAnswer = function(accepted) {
    if (!pendingConfirmation) return;
    const resolve = pendingConfirmation;
    pendingConfirmation = null;
    el('tg-confirm-modal').classList.remove('open');
    resolve(Boolean(accepted));
  };
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && pendingConfirmation) window.tgConfirmAnswer(false);
  });
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
  function status(message) { el('tg-status').textContent=message; }
  function updateButtons() { el('tg-send-btn').disabled=!currentChat || isSending;el('tg-draft-btn').disabled=!currentChat || isDrafting; }
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
      el('tg-login-modal').classList.remove('open');el('crm-session-btn').textContent='Выйти';el('crm-integration-controls').style.display='flex';
      status('Подключено к тестовому серверу. Сообщения не объединяются с карточками пациентов.');showInbox(data.items);
      if(!poller)poller=setInterval(()=>{if(adminToken)tgRefresh(true);},10000);
    } catch(e) {
      if(version===sessionVersion){adminToken='';el('crm-login-error').textContent=e.message;}
    } finally {isLoggingIn=false;el('crm-login-submit').disabled=false;}
  };
  window.tgShowDemo = function(){
    currentChat=null;el('demo-patient-col').style.display='';el('tg-patient-col').style.display='none';updateButtons();
  };
  window.tgLogout = function(){
    ++sessionVersion;adminToken='';if(pendingConfirmation)window.tgConfirmAnswer(false);window.tgShowDemo();el('tg-input').value='';el('tg-messages').replaceChildren();
    telegramItems=[];el('tg-chat-name').textContent='Выберите диалог';el('tg-alert-count').style.display='none';
    el('tg-handoff-status').textContent='Выберите чат';el('tg-handoff-reason').textContent='';el('tg-handoff-summary').textContent='';
    el('tg-take').style.display='none';el('tg-resume').style.display='none';el('crm-session-btn').textContent='Войти';el('crm-integration-controls').style.display='none';
    if(poller){clearInterval(poller);poller=null;}renderInbox();showView('comms');showLogin();
  };
  window.tgSetupWebhook = async function(){
    if(!adminToken)return showLogin();
    const version=sessionVersion;
    if(!await askConfirmation('Подключить бота к этому серверу? У Telegram-бота может быть только один webhook: прежнее подключение будет заменено.'))return;
    if(version!==sessionVersion || !adminToken)return;
    try{await api('/api/setup-webhook','POST',{});status('Webhook настроен. Напишите тестовое сообщение боту в личном чате Telegram.');toast('Бот подключён');}
    catch(e){if(e.message!=='session_changed'){status(e.message);toast(e.message);}}
  };
  window.tgRefresh = async function(silent=false){
    if(!adminToken)return;
    try {
      const data=await api('/api/telegram/conversations');showInbox(data.items);
      if(currentChat)await tgLoadMessages();
    }catch(e){if(e.message==='session_changed')return;if(!adminToken){window.tgLogout();el('crm-login-error').textContent='Сессия завершена. Войдите снова.';return;}if(!silent){status(e.message);toast(e.message);}}
  };
  window.tgSelect = async function(id){currentChat=id;el('demo-patient-col').style.display='none';el('tg-patient-col').style.display='';el('tg-input').value='';updateButtons();renderInbox();await tgRefresh();};
  async function tgLoadMessages(){
    if(!currentChat)return;const chatId=currentChat, data=await api('/api/telegram/conversations/'+encodeURIComponent(chatId));if(chatId!==currentChat)return;
    el('tg-chat-name').textContent=data.name;const labels={ai:'ИИ ведёт диалог',waiting:'🚩 Нужен человек',assigned:'В работе сотрудника'};el('tg-handoff-status').textContent=labels[data.mode] || 'Неизвестно';el('tg-handoff-reason').textContent=data.handoff?.reason || (data.autoEnabled ? 'Новые сообщения обрабатывает ИИ.' : 'Автоответ ИИ выключен.');el('tg-handoff-summary').textContent=data.handoff?.summary || '';el('tg-take').style.display=data.mode==='waiting'?'':'none';el('tg-resume').style.display=data.mode==='assigned'?'':'none';const feed=el('tg-messages'); const nearBottom=feed.scrollHeight-feed.scrollTop-feed.clientHeight < 80;feed.replaceChildren();
    data.messages.forEach(m=>{
      const item=document.createElement('div');item.className='hist-item'; const top=document.createElement('div');top.className='hist-top';
      top.append(text('span',m.direction==='in'?'✈️':'👤','hist-icon'),text('span',m.direction==='in'?'Входящее · Telegram':m.author==='ai'?'ИИ · Telegram':m.author==='system'?'Система · Telegram':'Администратор · Telegram','hist-title'),text('span',new Date(m.at).toLocaleString('ru-RU'),'hist-date'));
      const content=text('div',m.text,'hist-body');content.style.whiteSpace='pre-wrap';item.append(top,content);feed.append(item);
    });if(nearBottom)feed.scrollTop=feed.scrollHeight;
  }
  window.tgTake = async function(){
    if(!currentChat)return;try{await api('/api/telegram/conversations/'+encodeURIComponent(currentChat)+'/take','POST',{});status('Диалог в работе сотрудника. ИИ поставлен на паузу.');await tgRefresh(true);}catch(e){status(e.message);toast(e.message);}
  };
  window.tgResume = async function(){
    if(!currentChat){toast('Сначала выберите диалог');return;}const chat=currentChat;
    if(!await askConfirmation('Вернуть диалог ИИ? Он начнёт отвечать на следующие сообщения; уже полученные сообщения повторно обрабатываться не будут.'))return;
    if(chat!==currentChat){status('Чат изменился, повторите действие.');return;}
    try{await api('/api/telegram/conversations/'+encodeURIComponent(chat)+'/resume','POST',{});status('Диалог передан ИИ.');await tgRefresh(true);}catch(e){status(e.message);toast(e.message);}
  };
  window.tgDraft = async function(){
    if(!currentChat||isDrafting)return;
    const chat=currentChat;
    if(!await askConfirmation('Последние сообщения этого тестового чата будут отправлены выбранному сервису ИИ для создания черновика. Продолжить?'))return;
    if(chat!==currentChat){status('Чат изменился, повторите действие.');return;}
    isDrafting=true;updateButtons();status('ИИ готовит черновик…');
    try{const data=await api('/api/telegram/conversations/'+encodeURIComponent(chat)+'/draft','POST',{});if(chat!==currentChat){status('Чат изменился: черновик не вставлен.');return;}el('tg-input').value=data.draft;status('Черновик готов. Проверьте текст: он ещё не отправлен.');}
    catch(e){status(e.message);toast(e.message);}finally{isDrafting=false;updateButtons();}
  };
  window.tgSend = async function(){
    if(!currentChat){toast('Сначала выберите диалог');return;}if(isSending)return;const message=el('tg-input').value.trim();if(!message){toast('Введите сообщение');return;}
    const chat=currentChat;
    if(!await askConfirmation('Отправить проверенный текст в Telegram этому собеседнику?'))return;
    if(chat!==currentChat){status('Чат изменился, сообщение не отправлено.');return;}
    let requestId;try{requestId=uniqueRequestId();}catch(e){status(e.message);toast(e.message);return;}
    isSending=true;updateButtons();
    try{await api('/api/telegram/conversations/'+encodeURIComponent(chat)+'/send','POST',{text:message,requestId});if(chat===currentChat)el('tg-input').value='';status('Сообщение отправлено через Telegram.');await tgRefresh(true);}
    catch(e){status(e.message);toast(e.message);}finally{isSending=false;updateButtons();}
  };
  // One shared CRM entry point; Telegram does not need a separate login.
  showLogin();
})();
