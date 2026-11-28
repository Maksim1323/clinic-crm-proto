/* The staff assistant never sends messages to patients and cannot write without confirmation. */
(() => {
 const el=id=>document.getElementById(id);let revision=0,busy=false;
 function say(value,who='Помощник'){const p=document.createElement('div');p.style.cssText='margin:8px 0;overflow-wrap:anywhere';const head=document.createElement('strong');head.textContent=who+': ';p.append(head,document.createTextNode(value));el('assistant-feed').append(p);el('assistant-feed').scrollTop=el('assistant-feed').scrollHeight;return p;}
 function contextLabel(){const chat=window.crmSelectedChat?.();el('assistant-context').textContent=chat?'Выбранный Telegram-диалог: '+chat.name+' (ID '+chat.id+')':'Для задачи и пересказа сначала откройте Telegram-диалог. Поиск и задачи доступны без выбранного чата.';return chat;}
 function resultList(items,type){if(!items.length){say(type==='tasks'?'У вас нет открытых задач, назначенных вашей учётной записи.':'Совпадений не найдено. Укажите не менее двух букв или трёх цифр.');return;}const box=document.createElement('div');box.style.cssText='display:flex;flex-direction:column;align-items:flex-start;gap:5px;margin:8px 0';
  for(const item of items){const b=document.createElement('button');b.type='button';b.className='badge';b.style.whiteSpace='normal';b.textContent=type==='tasks'?item.title+' · '+(item.patient||'без пациента')+(item.dueAt?' · '+new Date(item.dueAt).toLocaleString('ru-RU'):''):(item.kind==='telegram'?'Telegram · ':'Карточка · ')+(item.name||'Без имени')+(item.phone?' · '+item.phone:'')+(item.source==='telegram'?' · телефон не проверен':'');b.onclick=()=>{window.crmCloseAssistant();if(type==='tasks')window.crmOpenTaskById(item.id);else window.crmOpenPatientRef(item.id);};box.append(b);}el('assistant-feed').append(box);
 }
 function proposalCard(p){
  const card=document.createElement('div');card.style.cssText='border:1px solid #e2e8f0;border-radius:10px;padding:10px;margin:8px 0';const info=document.createElement('p');info.textContent='Предложение: новая задача для Telegram-диалога «'+p.chatName+'» (ID '+p.chatId+'). Пока ничего не создано. Сверьте с перепиской.';card.append(info);
  const form=document.createElement('div');form.className='form-grid';
  const field=(label,input)=>{const box=document.createElement('div');box.className='form-field';const l=document.createElement('label');l.textContent=label;box.append(l,input);form.append(box);};
  const title=document.createElement('input');title.maxLength=160;title.value=p.title;title.setAttribute('aria-label','Название предлагаемой задачи');field('Название задачи',title);
  const staff=document.createElement('select');staff.setAttribute('aria-label','Ответственный предлагаемой задачи');window.crmFillStaff(staff,p.defaultAssignee);field('Ответственный',staff);
  const due=document.createElement('input');due.type='datetime-local';due.setAttribute('aria-label','Срок предлагаемой задачи');field('Срок — необязательно',due);card.append(form);
  const err=document.createElement('p');err.style.cssText='color:#e11d48;font-size:12px';err.setAttribute('role','alert');card.append(err);const actions=document.createElement('div');actions.className='modal-actions';const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Отменить предложение';const confirm=document.createElement('button');confirm.type='button';confirm.className='ok';confirm.textContent='Подтвердить и создать задачу';actions.append(cancel,confirm);card.append(actions);el('assistant-feed').append(card);
  cancel.onclick=()=>{confirm.disabled=true;cancel.disabled=true;err.textContent='Предложение отменено, задача не создана.';};
  confirm.onclick=async()=>{const current=window.crmSelectedChat?.();if(!current||current.id!==p.chatId){err.textContent='Сначала снова откройте исходный Telegram-диалог.';return;}const value=title.value.trim(),date=due.value?new Date(due.value):null;if(!value||value.length>160||(date&&Number.isNaN(date.getTime()))){err.textContent='Проверьте название и срок.';return;}const actingUser=window.crmUser?.id;confirm.disabled=true;cancel.disabled=true;err.textContent='';try{const result=await window.crmApi('/api/assistant/proposals/confirm','POST',{proposalId:p.proposalId,title:value,assigneeUserId:staff.value,dueAt:date?date.toISOString():null,reviewed:true});if(window.crmUser?.id!==actingUser||!card.isConnected)return;info.textContent='Задача создана: '+result.task.title+' · Telegram: '+p.chatName;form.remove();actions.remove();await window.crmRefreshManual();}catch(e){if(window.crmUser?.id!==actingUser||!card.isConnected)return;err.textContent=e.message;if(e.code==='already_created'){info.textContent='Задача уже создана. Проверьте список задач.';form.remove();actions.remove();}else{confirm.disabled=false;cancel.disabled=false;}}};
 }
 window.crmOpenAssistant=()=>{if(!window.crmUser)return;el('crm-assistant-modal').classList.add('open');contextLabel();el('assistant-error').textContent='';el('assistant-input').focus();};
 window.crmCloseAssistant=()=>{++revision;el('crm-assistant-modal').classList.remove('open');};
 window.crmAssistantReset=()=>{window.crmCloseAssistant();el('assistant-feed').replaceChildren();el('assistant-input').value='';el('assistant-error').textContent='';};
 window.crmAssistantExample=value=>{el('assistant-input').value=value;el('assistant-input').focus();};
 window.crmAssistantSend=async function(){if(busy)return;const input=el('assistant-input'),query=input.value.trim();if(!query)return;const chat=contextLabel(),currentRevision=revision;say(query,'Вы');input.value='';el('assistant-error').textContent='';busy=true;el('assistant-send').disabled=true;
  try{const data=await window.crmApi('/api/assistant/command','POST',{text:query,chatId:chat?.id||''});if(currentRevision!==revision)return;
   if(data.type==='search'){say('Результаты поиска:');resultList(data.items,'search');}
   else if(data.type==='tasks'){say('Открытые задачи, назначенные вам:');resultList(data.items,'tasks');}
   else if(data.type==='summary'){say('ИИ пересказал '+data.messageCount+' последних сообщений диалога «'+data.chatName+'»'+(data.truncated?' (история сокращена)':'')+'. Проверьте по оригиналу:\n'+data.summary);}
   else if(data.type==='proposal'){say('Подготовлено предложение по '+data.messageCount+' последним сообщениям'+(data.truncated?' (история сокращена)':'')+'.');proposalCard(data);}
   else say(data.message||'Команда не распознана.');
  }catch(e){if(currentRevision===revision)el('assistant-error').textContent=e.message;}finally{busy=false;el('assistant-send').disabled=false;}
 };
})();
