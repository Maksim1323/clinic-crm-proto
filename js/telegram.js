/* Telegram view uses the server serving this page. Credentials stay in tab memory. */
(() => {
  let adminToken = '', currentChat = null, poller = null, isSending = false, isDrafting = false;
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
    let response;
    try {
      response=await fetch(url,{method,headers:{'Authorization':'Bearer '+adminToken,...(payload?{'Content-Type':'application/json'}:{})},...(payload?{body:JSON.stringify(payload)}:{}),cache:'no-store'});
    } catch (_) { throw new Error('Сервер недоступен. Откройте адрес Web Service на Render.'); }
    let data; try{data=await response.json();}catch(_){throw new Error('API не найден. Откройте адрес Web Service на Render, а не GitHub Pages.');}
    if(!response.ok) { if(response.status===401)adminToken='';throw new Error(data.error || 'Ошибка сервера'); } return data;
  }
  function status(message) { el('tg-status').textContent=message; }
  function updateButtons() { el('tg-send-btn').disabled=!currentChat || isSending;el('tg-draft-btn').disabled=!currentChat || isDrafting; }
  window.openTelegramView = function() {
    showView('telegram');
    if(!adminToken){el('tg-login-modal').classList.add('open');setTimeout(()=>el('tg-admin-token').focus(),30);return;}
    tgRefresh();if(!poller)poller=setInterval(()=>{if(adminToken)tgRefresh(true);},10000);
  };
  window.closeTelegramLogin = function(){el('tg-admin-token').value='';el('tg-login-modal').classList.remove('open');showView('comms');};
  window.tgLogin = async function(){
    adminToken=el('tg-admin-token').value;el('tg-admin-token').value='';
    try {await api('/api/telegram/conversations');el('tg-login-modal').classList.remove('open');status('Подключено к тестовому серверу. Сообщения не объединяются с карточками пациентов.');openTelegramView();}
    catch(e){adminToken='';status(e.message);toast(e.message);}
  };
  window.tgLogout = function(){adminToken='';currentChat=null;el('tg-input').value='';el('tg-messages').replaceChildren();el('tg-conversations').replaceChildren();el('tg-chat-name').textContent='Выберите диалог';el('tg-alert-count').style.display='none';el('tg-handoff-status').textContent='Выберите чат';el('tg-handoff-reason').textContent='';el('tg-handoff-summary').textContent='';el('tg-take').style.display='none';el('tg-resume').style.display='none';updateButtons();if(poller){clearInterval(poller);poller=null;}showView('comms');};
  window.tgSetupWebhook = async function(){
    if(!adminToken)return openTelegramView();
    if(!await askConfirmation('Подключить бота к этому серверу? У Telegram-бота может быть только один webhook: прежнее подключение будет заменено.'))return;
    try{await api('/api/setup-webhook','POST',{});status('Webhook настроен. Напишите тестовое сообщение боту в личном чате Telegram.');toast('Бот подключён');}
    catch(e){status(e.message);toast(e.message);}
  };
  window.tgRefresh = async function(silent=false){
    if(!adminToken)return;
    try {
      const data=await api('/api/telegram/conversations'); const list=el('tg-conversations');list.replaceChildren();el('tg-count').textContent=String(data.items.length); const waiting=data.items.filter(c=>c.mode==='waiting').length;el('tg-alert-count').textContent=String(waiting);el('tg-alert-count').style.display=waiting?'inline-flex':'none';data.items.sort((a,b)=>(a.mode==='waiting'?0:1)-(b.mode==='waiting'?0:1));
      if(!data.items.length)list.append(text('div','Пока нет диалогов. Напишите боту в личном чате.','ch-preview'));
      data.items.forEach(c=>{
        const item=document.createElement('div');item.className='sidebar-item'+(c.id===currentChat?' active':'');
        const row=document.createElement('div');row.className='sidebar-item-row';row.append(text('div','✈️','ch-icon'));
        const box=document.createElement('div');box.className='ch-body';box.append(text('div',c.name,'ch-name'));if(c.mode==='waiting')box.append(text('div','🚩 Нужен человек','ch-preview'));else if(c.mode==='assigned')box.append(text('div','У сотрудника','ch-preview'));box.append(text('div',c.preview,'ch-preview'));row.append(box);item.append(row);
        item.onclick=()=>tgSelect(c.id); list.append(item);
      });
      if(currentChat)await tgLoadMessages();
    }catch(e){if(!silent){status(e.message);toast(e.message);}}
  };
  window.tgSelect = async function(id){currentChat=id;el('tg-input').value='';updateButtons();await tgRefresh();};
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
    if(!await askConfirmation('Последние сообщения этого тестового чата будут отправлены в Gemini для создания черновика. Продолжить?'))return;
    if(chat!==currentChat){status('Чат изменился, повторите действие.');return;}
    isDrafting=true;updateButtons();status('Gemini готовит черновик…');
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
})();
