const STAGES = [
      { num: 1, label: '1 · Первичный приём' },
      { num: 2, label: '2 · Продажа плана лечения' },
      { num: 3, label: '3 · Лечение' },
      { num: 4, label: '4 · Профосмотр' },
      { num: 5, label: '5 · Потенциальный клиент' }
    ];

    // Server-backed manual cards; legacy browser data is read only on explicit import.
    const DB = {patients:{}, inboxOrder:[]};
    // Fingerprints only; edits to old examples are retained as user data.
    const oldPatientHashes={ivanov:'678ce3fc',smirnova:'5a4abae3',alexey:'dfcc47b3',site:'7ba6aa2e',mis:'396d6011'};
    const oldTaskHashes={t1:'4dcee95',t2:'6927ebd4',t3:'7fb0ffdb',t4:'fc7d9b50',t5:'512e16ff',t6:'40f30a8c'};
    function fingerprint(obj){let h=2166136261;const text=JSON.stringify(obj);for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619);}return (h>>>0).toString(16);}
    let currentPatientId = null;
    let pendingStage = null;
    const localVisibilityFields=['name','phone','age','gender','channel','admin','doctor','stage','bonuses','nps','nospam','inclinic','plan','note'];
    const localDefaultHidden=new Set(['gender','channel','nps','inclinic','note']);
    function cardFieldVisible(p,key){return typeof p?.visibility?.[key]==='boolean'?p.visibility[key]:!localDefaultHidden.has(key);}
    function localFieldVisible(p,key){return (window.crmFieldAllowed?window.crmFieldAllowed(key):true) && cardFieldVisible(p,key);}
    function readLocalVisibility(){return Object.fromEntries(localVisibilityFields.map(key=>[key,document.getElementById('pf-show-'+key).checked]));}


    const STORAGE_KEY = 'cliniccrm_v13';

    const taskKey='cliniccrm_journey_tasks_v1';
    let manualReady=false, patientEditVersion=null, patientSaving=false, taskEditVersion=null, taskSaving=false, manualRevision=0,patientDraftId=null,taskDraftId=null,manualFetchSeq=0,manualAppliedSeq=0;
    function newId(prefix){const bytes=new Uint8Array(16);crypto.getRandomValues(bytes);return prefix+'_'+Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');}
    function localInputValue(value){if(!value)return '';const d=new Date(value);if(Number.isNaN(d.getTime()))return '';return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);}
    function showManualError(id,message){document.getElementById(id).textContent=message;}
    function requireManual(){if(manualReady)return true;toast('Войдите в CRM, чтобы работать с серверными карточками и задачами');return false;}
    window.crmClearManual=function(){manualReady=false;++manualRevision;DB.patients={};DB.inboxOrder=[];TASKS=[];currentPatientId=null;closePatientModal();closeTaskModal();document.getElementById('import-local-btn').style.display='none';document.getElementById('import-result').textContent='';document.getElementById('history-feed').replaceChildren();document.getElementById('task-staff-options').replaceChildren();document.getElementById('demo-patient-col').style.display='none';document.getElementById('comms-empty').style.display='';renderInbox();renderTasks();renderKanban();};
    window.crmRefreshManual=async function(){
      const revision=manualRevision,seq=++manualFetchSeq,data=await window.crmApi('/api/manual');if(revision!==manualRevision||seq<manualAppliedSeq)return;manualAppliedSeq=seq;
      window.crmStaff=data.staff||[];const staff=document.getElementById('task-staff-options');staff.replaceChildren();(data.employees||[]).forEach(e=>staff.append(new Option(e.name,e.name)));
      DB.patients=Object.fromEntries(data.patients.map(p=>[p.id,p]));DB.inboxOrder=data.patients.map(p=>p.id).reverse();TASKS=data.tasks.slice().reverse();manualReady=true;
      document.getElementById('import-local-btn').style.display=hasLegacyData()&&window.crmUser?.role!=='administrator'?'':'none';renderInbox();renderTasks();renderKanban();
      if(currentPatientId && DB.patients[currentPatientId] && !(window.tgHasSelectedChat&&window.tgHasSelectedChat()))renderPatient(currentPatientId,false);
    };
    function hasLegacyData(){try{return !!(localStorage.getItem(STORAGE_KEY)||localStorage.getItem(taskKey));}catch(_){return false;}}
    function legacySnapshot(){
      let patients=[],tasks=[];const a=localStorage.getItem(STORAGE_KEY),b=localStorage.getItem(taskKey);
      if(a){const d=JSON.parse(a);if(!d||!d.patients||typeof d.patients!=='object'||Array.isArray(d.patients))throw Error('Старые карточки имеют неизвестный формат. Данные в браузере не изменены.');patients=Object.entries(d.patients).filter(([id,p])=>!oldPatientHashes[id]||fingerprint(p)!==oldPatientHashes[id]);}
      if(b){const data=JSON.parse(b);if(!Array.isArray(data))throw Error('Старые задачи имеют неизвестный формат. Данные в браузере не изменены.');tasks=data.filter(t=>t&&(!oldTaskHashes[t.id]||fingerprint(t)!==oldTaskHashes[t.id])).map(t=>[String(t.id||''),t]);}
      return {patients,tasks};
    }
    let importing=false;
    window.crmImportLegacy=async function(){
      if(!requireManual()||importing)return;let snapshot,scope;
      try{snapshot=legacySnapshot();scope=localStorage.getItem('cliniccrm_import_scope_v1');if(!scope){scope=newId('x').slice(2);localStorage.setItem('cliniccrm_import_scope_v1',scope);}if(!/^[a-f0-9]{32}$/.test(scope))throw Error('Не удалось определить источник импорта.');}catch(e){toast(e.message||'Не удалось прочитать данные браузера');return;}
      const button=document.getElementById('import-local-btn');importing=true;button.disabled=true;let added=0,exists=0,failed=0;const errors=[];
      try{
        for(const [kind,items] of [['patient',snapshot.patients],['task',snapshot.tasks]])for(const [legacyId,original] of items){
          let record=JSON.parse(JSON.stringify(original));
          if(kind==='task'&&record.dueAt&&!/(?:Z|[+-]\d\d:\d\d)$/.test(record.dueAt)){const date=new Date(record.dueAt);if(!Number.isNaN(date.getTime()))record.dueAt=date.toISOString();}
          try{const result=await window.crmApi('/api/manual/import','POST',{scope,kind,legacyId,record});if(result.status==='exists')exists++;else added++;}catch(e){if(e.message==='session_changed')throw e;failed++;errors.push((kind==='patient'?'Карточка ':'Задача ')+legacyId+': '+e.message);}
        }
        await window.crmRefreshManual();
        const message='Импорт: добавлено '+added+', уже было '+exists+', не удалось '+failed+'. Данные в браузере не удалены.';
        document.getElementById('import-result').textContent=message+(errors.length?' '+errors.join(' | '):'');toast(message);
      }catch(e){if(e.message!=='session_changed')toast('Импорт прерван. Повторите: уже перенесённые записи не дублируются.');}
      finally{importing=false;button.disabled=false;}
    };

    const CHANNEL_META = {
      call:  { icon: '📞', label: 'Звонок' },
      tg:    { icon: '✈️', label: 'Telegram' },
      vk:    { icon: '🌐', label: 'ВКонтакте' },
      email: { icon: '📧', label: 'Сайт · Форма' },
      mis:   { icon: '✔️', label: 'МИС' }
    };

    let patientModalMode = 'edit';

    function openPatientModal(mode) {
      if(!requireManual())return;
      patientModalMode = mode || 'edit';
      patientEditVersion=mode==='create'?null:DB.patients[currentPatientId]?.version;patientDraftId=mode==='create'?newId('p'):null;
      showManualError('patient-save-error','');
      const modal = document.getElementById('patient-modal');
      const title = document.getElementById('patient-modal-title');
      const sub = document.getElementById('patient-modal-sub');

      if (mode === 'create') {
        title.textContent = 'Новый пациент';
        sub.textContent = 'Создание карточки пациента';
        document.getElementById('pf-id').value = '';
        document.getElementById('pf-name').value = '';
        document.getElementById('pf-phone').value = '';
        document.getElementById('pf-age').value = '';
        document.getElementById('pf-gender').value = 'male';
        document.getElementById('pf-channel').value = 'tg';
        document.getElementById('pf-admin').value = '';
        document.getElementById('pf-doctor').value = '';
        document.getElementById('pf-stage').value = '1';
        document.getElementById('pf-bonuses').value = '0';
        document.getElementById('pf-nps').value = '';
        document.getElementById('pf-nospam').checked = false;
        document.getElementById('pf-inclinic').checked = false;
        document.getElementById('pf-plan').value = '';
        document.getElementById('pf-note').value = '';
      } else {
        const p = DB.patients[currentPatientId];
        if (!p) { toast('Пациент не выбран'); return; }
        title.textContent = 'Редактирование карточки';
        sub.textContent = p.name;
        document.getElementById('pf-id').value = p.id;
        document.getElementById('pf-name').value = p.name || '';
        document.getElementById('pf-phone').value = p.phone || '';
        document.getElementById('pf-age').value = p.age || '';
        document.getElementById('pf-gender').value = p.gender || '';
        // detect channel from icon
        let ch = 'call';
        if (p.channelIcon === '✈️') ch = 'tg';
        else if (p.channelIcon === '🌐') ch = 'vk';
        else if (p.channelIcon === '📧') ch = 'email';
        else if (p.channelIcon === '✔️') ch = 'mis';
        document.getElementById('pf-channel').value = ch;
        document.getElementById('pf-admin').value = p.admin || '';
        document.getElementById('pf-doctor').value = p.doctor || '';
        document.getElementById('pf-stage').value = String(p.stageNum || 1);
        document.getElementById('pf-bonuses').value = p.bonuses || 0;
        document.getElementById('pf-nps').value = p.nps != null ? p.nps : '';
        document.getElementById('pf-nospam').checked = !!p.noSpam;
        document.getElementById('pf-inclinic').checked = !!p.statusInClinic;
        document.getElementById('pf-plan').value = p.plan || '';
        document.getElementById('pf-note').value = p.note || '';
      }
      const shownPatient=patientModalMode==='edit'?DB.patients[currentPatientId]:null;
      window.crmFillStaff(document.getElementById('pf-assignee-user'),shownPatient?.assigneeUserId||'');
      localVisibilityFields.forEach(key=>{document.getElementById('pf-show-'+key).checked=cardFieldVisible(shownPatient,key);});
      modal.classList.add('open');
      setTimeout(() => document.getElementById('pf-name').focus(), 50);
    }

    function closePatientModal() {
      document.getElementById('patient-modal').classList.remove('open');
    }

    async function savePatientCard() {
      if(!requireManual()||patientSaving)return;
      const name=document.getElementById('pf-name').value.trim(),phone=document.getElementById('pf-phone').value.trim();
      if(!name||!phone){showManualError('patient-save-error','Укажите ФИО и телефон');return;}
      const creating=patientModalMode==='create',id=creating?patientDraftId:document.getElementById('pf-id').value;
      const old=creating?null:DB.patients[id];if(!creating&&!old){showManualError('patient-save-error','Карточка недоступна.');return;}
      const ch=document.getElementById('pf-channel').value,meta=CHANNEL_META[ch]||CHANNEL_META.call,gender=document.getElementById('pf-gender').value,npsRaw=document.getElementById('pf-nps').value;
      const p={...(old||{}),id,name,phone,visibility:readLocalVisibility(),age:document.getElementById('pf-age').value.trim()||'—',gender:gender||'',emoji:gender==='female'?'👩':gender==='male'?'👨':'👤',channelIcon:meta.icon,channelLabel:meta.label,timeLabel:old?.timeLabel||'сейчас',unread:old?.unread||0,statusInClinic:document.getElementById('pf-inclinic').checked,admin:document.getElementById('pf-admin').value.trim()||'—',doctor:document.getElementById('pf-doctor').value.trim()||'—',stageNum:parseInt(document.getElementById('pf-stage').value,10)||1,stageTotal:5,noSpam:document.getElementById('pf-nospam').checked,bonuses:parseInt(document.getElementById('pf-bonuses').value,10)||0,nps:npsRaw===''?null:parseInt(npsRaw,10),preview:old?.preview||'Новая карточка',createdAt:old?.createdAt||new Date().toLocaleDateString('ru-RU'),plan:document.getElementById('pf-plan').value.trim(),note:document.getElementById('pf-note').value.trim(),history:[...(old?.history||[])]};
      p.assigneeUserId=document.getElementById('pf-assignee-user').value;
      if(window.crmUser?.role==='administrator'){delete p.plan;delete p.bonuses;}
      p.history.unshift({type:'system',icon:creating?'📋':'✏️',title:creating?'Карточка создана':'Карточка обновлена',date:nowLabel(),body:creating?'Пациент добавлен в CRM':'Данные пациента изменены'});
      if(creating&&p.note)p.history.unshift({type:'note',icon:'📝',title:'Заметка',date:nowLabel(),body:escapeHtml(p.note)});
      patientSaving=true;document.getElementById('patient-save-button').disabled=true;showManualError('patient-save-error','');
      try{await window.crmApi('/api/manual/patients/'+id,'PUT',{record:p,expectedVersion:patientEditVersion});await window.crmRefreshManual();closePatientModal();showView('comms');selectPatient(id);toast('Карточка сохранена');}
      catch(e){if(e.message!=='session_changed')showManualError('patient-save-error',e.message);}
      finally{patientSaving=false;document.getElementById('patient-save-button').disabled=false;}
    }

    async function sendMessage() {
      if(!requireManual())return;const input=document.getElementById('msg-input'),p=DB.patients[currentPatientId],text=input.value.trim();if(!p||!text)return;
      const next={...p,history:[{type:'action',icon:'💬',title:'Заметка · сообщение не отправлено',date:nowLabel(),body:escapeHtml(text)},...p.history],preview:'Заметка: '+text.slice(0,40),unread:0};
      try{await window.crmApi('/api/manual/patients/'+p.id,'PUT',{record:next,expectedVersion:p.version});if(input.value.trim()===text)input.value='';await window.crmRefreshManual();toast('Сохранено как заметка; сообщение не отправлено');}catch(e){if(e.message!=='session_changed')toast(e.message);}
    }

    function escapeHtml(s) {
      return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }



    function nowLabel() {
      const d = new Date();
      return 'сегодня ' + String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
    }

    // ===== ACTIONS =====
    function actionBookMIS() { toast('Запись в МИС недоступна в демо.'); }
    function actionPlan() { toast('План лечения в демо недоступен; проверьте данные в МИС'); }
    function actionReminder() { openTaskEditor(); }
    function demoEscalation() { openTaskEditor(); toast('Создайте задачу для передачи сотруднику'); }

    function openStageModal() {
      const p = DB.patients[currentPatientId];
      if (pendingStage == null) pendingStage = p.stageNum;
      const box = document.getElementById('stage-options');
      box.innerHTML = STAGES.map(s => `
        <div class="stage-option ${s.num === pendingStage ? 'selected' : ''}" onclick="pendingStage=${s.num}; openStageModal()">
          <div class="font-medium text-[14px] text-slate-800">${s.label}</div>
        </div>
      `).join('');
      document.getElementById('stage-modal').classList.add('open');
    }

    function closeStageModal() {
      document.getElementById('stage-modal').classList.remove('open');
      pendingStage = null;
    }

    async function confirmStage() {if(pendingStage==null)return;const id=currentPatientId,stage=pendingStage;await movePatientStage(id,stage);closeStageModal();}

    // ===== RENDER =====
    function updateInboxCount() {
      const telegramCount = window.getTelegramInboxCount ? window.getTelegramInboxCount() : 0;
      document.getElementById('inbox-count').textContent = String(DB.inboxOrder.length + (Number.isFinite(telegramCount) ? telegramCount : 0));
    }
    function renderInbox() {
      const list = document.getElementById('inbox-list');
      list.innerHTML = '';
      if (window.renderTelegramInboxItems) window.renderTelegramInboxItems(list);
      DB.inboxOrder.forEach(id => {
        const p = DB.patients[id];
        const el = document.createElement('div');
        el.className = 'sidebar-item px-4 py-3.5' + (id === currentPatientId && !(window.tgHasSelectedChat && window.tgHasSelectedChat()) ? ' active' : '');
        el.onclick = () => selectPatient(id);
        const title = p.channelIcon === '📞' ? p.phone : p.name;
        el.innerHTML = `
          <div class="sidebar-item-row">
            <div class="ch-icon">${p.channelIcon}</div>
            <div class="ch-body">
              <div class="ch-top">
                <span class="ch-name">${title}</span>
                ${p.unread ? `<span class="unread">${p.unread}</span>` : `<span class="ch-time">${p.timeLabel}</span>`}
              </div>
              <div class="ch-preview">Демо · ${p.preview}</div>
            </div>
          </div>`;
        list.appendChild(el);
      });
      updateInboxCount();
    }


    function renderPatient(id, showToast = true) {
      const p = DB.patients[id];
      if (!p) return;
      currentPatientId = id;
      document.getElementById('comms-empty').style.display='none';
      document.getElementById('demo-patient-col').style.display='';
      const stage = STAGES.find(s => s.num === p.stageNum);

      document.getElementById('p-emoji').textContent = p.emoji;
      document.getElementById('p-name').textContent = p.name;
      document.getElementById('p-age').textContent = p.age;
      document.getElementById('p-admin').textContent = p.admin;
      document.getElementById('p-doctor').textContent = p.doctor;
      const stageEl = document.getElementById('p-stage'); stageEl.textContent = stage ? stage.label : '—'; stageEl.className = 'badge indigo';
      document.getElementById('p-progress').style.width = ((p.stageNum / p.stageTotal) * 100) + '%';
      document.getElementById('p-progress-label').textContent = p.stageNum + ' из ' + p.stageTotal;

      const statusEl = document.getElementById('p-status-badge');
      if (p.statusInClinic) {
        statusEl.className = 'badge green';
        statusEl.textContent = '● В клинике';
      } else {
        statusEl.className = 'badge';
        statusEl.textContent = 'не в клинике';
      }

      const badges = document.getElementById('p-badges');
      let bhtml = '';
      if (p.noSpam) bhtml += '<div class="flag-pulse badge rose">🚩 Отказ от рассылок</div>';
      if (p.bonuses > 0) bhtml += `<div class="badge amber">💰 ${p.bonuses.toLocaleString('ru-RU')} ₽</div>`;
      if (p.nps != null) bhtml += `<div class="badge sky">⭐ NPS ${p.nps}</div>`;
      badges.innerHTML = bhtml || '<span style="font-size:12px;color:#cbd5e1">нет меток</span>';

      const feed = document.getElementById('history-feed');
      document.getElementById('history-count').textContent = p.history.length + ' событий';
      feed.innerHTML = p.history.map(h => `
        <div class="hist-item">
          <div class="hist-top">
            <span class="hist-icon">${escapeHtml(String(h.icon||""))}</span>
            <span class="hist-title">${escapeHtml(String(h.title||""))}</span>
            <span class="hist-date">${escapeHtml(String(h.date||""))}</span>
          </div>
          <div class="hist-body" style="white-space:pre-wrap">${escapeHtml(historyText(h.body))}</div>
        </div>
      `).join('');

      // Profile card (design)
      renderProfileCard(p);
      renderInbox();
      if (showToast) toast('Карточка: ' + p.name);
    }

    function historyText(html){const parsed=new DOMParser().parseFromString(String(html||''),'text/html');parsed.querySelectorAll('script,style,iframe,object,svg,math').forEach(n=>n.remove());parsed.querySelectorAll('br').forEach(n=>n.replaceWith('\n'));parsed.querySelectorAll('div,p').forEach(n=>n.append('\n'));return (parsed.body.textContent||'').trim();}
    function initials(name) {
      const parts = (name || '').trim().split(/\s+/).filter(Boolean);
      if (!parts.length) return '?';
      if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }

    function renderProfileCard(p) {
      const av = document.getElementById('pr-avatar');
      av.textContent = initials(p.name);
      av.className = 'profile-avatar ' + (p.gender === 'male' ? 'male' : (p.gender === 'female' ? 'female' : ''));
      document.getElementById('pr-name').textContent = p.name;
      document.getElementById('pr-name').style.display=localFieldVisible(p,'name')?'':'none';
      av.textContent=localFieldVisible(p,'name')?initials(p.name):'👤';
      const since = p.createdAt || '';
      document.getElementById('pr-since').textContent = since ? 'Пациент с ' + since : 'Дата создания не указана';

      const tags = document.getElementById('pr-tags');
      const ageTag = !p.age || !/\d+/.test(p.age) ? 'Возраст не указан' : (parseInt(p.age) < 18 ? 'Ребёнок' : 'Взрослый');
      let tagHtml = localFieldVisible(p,'age') ? '<span class="tag muted">' + ageTag + '</span>' : '';
      if (p.plan && localFieldVisible(p,'plan')) {
        const short = p.plan.split('·')[0].trim().slice(0, 24);
        tagHtml += '<span class="tag">' + escapeHtml(short) + '</span>';
      } else if (p.stageNum === 1 && localFieldVisible(p,'stage')) {
        tagHtml += '<span class="tag">Первичный</span>';
      }
      tags.innerHTML = tagHtml;

      const spam = document.getElementById('pr-spam');
      spam.style.display = p.noSpam && localFieldVisible(p,'nospam') ? 'flex' : 'none';

      document.getElementById('pr-phone').textContent = p.phone || '—';
      const adminName = p.admin && p.admin !== '—' ? p.admin : 'Не назначен';
      document.getElementById('pr-admin-name').textContent = adminName;
      document.getElementById('pr-admin-av').textContent = initials(adminName);
      const doc = p.doctor && p.doctor !== '—' ? p.doctor : 'Не назначен';
      const docEl = document.getElementById('pr-doctor');
      docEl.textContent = doc;
      docEl.className = 'value' + (doc === 'Не назначен' ? ' muted' : '');
      document.getElementById('pr-bonuses').textContent =
        (p.bonuses > 0 ? p.bonuses.toLocaleString('ru-RU') + ' ₽' : '— ₽');

      const stage = STAGES.find(s => s.num === p.stageNum);
      document.getElementById('pr-process').textContent = stage ? stage.label.replace(/^\d+ · /, '') : '—';
      const statusMap = {
        1: 'Новое обращение',
        2: 'Согласование плана',
        3: 'Лечение в процессе',
        4: 'Плановый контроль',
        5: 'В базе прогрева'
      };
      document.getElementById('pr-process-status').textContent = statusMap[p.stageNum] || '—';
      for(const key of ['phone','admin','doctor','bonuses'])document.getElementById('pr-'+key).closest('.profile-row').style.display=localFieldVisible(p,key)?'':'none';
      document.querySelector('#profile-card .process-box').style.display=localFieldVisible(p,'stage')?'':'none';
      const extras={gender:p.gender==='male'?'Мужской':p.gender==='female'?'Женский':'Не указан',channel:p.channelLabel||'Не указан',nps:p.nps==null?'Не указан':String(p.nps),inclinic:p.statusInClinic?'Да':'Нет',note:p.note||'Не указана'};
      for(const [key,value] of Object.entries(extras)){document.getElementById('pr-'+key).textContent=value;document.querySelector('[data-profile-extra="'+key+'"]').style.display=localFieldVisible(p,key)?'':'none';}
      document.getElementById('pr-extra-fields').style.display=Object.keys(extras).some(key=>localFieldVisible(p,key))?'':'none';

    }

    function selectPatient(id) { if (window.tgShowDemo) window.tgShowDemo(); renderPatient(id); }

    function renderKanban() {
      const byStage = { 1: [], 2: [], 3: [], 4: [], 5: [] };
      Object.values(DB.patients).forEach(p => {
        if (byStage[p.stageNum]) byStage[p.stageNum].push(p);
      });
      const headBg = {
        1: '#f0f9ff', 2: '#eef2ff', 3: '#f5f3ff', 4: '#ecfdf5', 5: '#fffbeb'
      };
      const board = document.getElementById('kanban-board');
      if (!board) return;
      board.innerHTML = STAGES.map(s => {
        const cards = (byStage[s.num] || []).map(p => `
          <div class="kanban-card" draggable="true"
               data-id="${p.id}" data-stage="${s.num}"
               ondragstart="kanbanDragStart(event)"
               ondragend="kanbanDragEnd(event)"
               onclick="if(!window._kanbanDragged){showView('comms');selectPatient('${p.id}')}">
            <div style="font-size:13px;font-weight:500">${escapeHtml(String(p.name || ""))}</div>
            <div style="font-size:11px;color:#94a3b8;margin-top:4px">${escapeHtml(String(p.channelLabel || ""))}</div>
            <div style="font-size:11px;color:#64748b;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(String(p.preview || ""))}</div>
            ${p.noSpam ? '<div style="margin-top:6px"><span class="badge rose">🚩</span></div>' : ''}
            <div class="move-btns" onclick="event.stopPropagation()">
              <button type="button" ${s.num <= 1 ? 'disabled' : ''} onclick="movePatientStage('${p.id}', ${s.num - 1})" title="На этап назад">←</button>
              <button type="button" ${s.num >= 5 ? 'disabled' : ''} onclick="movePatientStage('${p.id}', ${s.num + 1})" title="На этап вперёд">→</button>
            </div>
          </div>`).join('');
        return `<div class="kanban-col" data-stage="${s.num}"
          style="flex:0 0 240px;width:240px;min-width:240px;display:flex;flex-direction:column;background:#fff;border-radius:16px;border:1px solid #e2e8f0;overflow:hidden;height:100%"
          ondragover="kanbanDragOver(event)" ondragleave="kanbanDragLeave(event)" ondrop="kanbanDrop(event)">
          <div class="kanban-col-head" style="background:${headBg[s.num]};padding:12px 16px;border-bottom:1px solid #f1f5f9;display:flex;justify-content:space-between;align-items:center;font-size:13px;font-weight:600">
            <span>${s.label}</span>
            <span class="badge">${(byStage[s.num]||[]).length}</span>
          </div>
          <div class="kanban-col-body" style="flex:1;overflow-y:auto;padding:10px;display:flex;flex-direction:column;gap:8px">${cards || '<div style="font-size:12px;color:#cbd5e1;text-align:center;padding:24px 0">перетащите карточку</div>'}</div>
        </div>`;
      }).join('');
    }

    let _dragPatientId = null;
    window._kanbanDragged = false;

    function kanbanDragStart(e) {
      const card = e.target.closest('.kanban-card');
      if (!card) return;
      _dragPatientId = card.getAttribute('data-id');
      window._kanbanDragged = false;
      card.classList.add('dragging');
      e.dataTransfer.setData('text/plain', _dragPatientId);
      e.dataTransfer.effectAllowed = 'move';
    }
    function kanbanDragEnd(e) {
      const card = e.target.closest('.kanban-card');
      if (card) card.classList.remove('dragging');
      document.querySelectorAll('.kanban-col.drag-over').forEach(c => c.classList.remove('drag-over'));
      setTimeout(() => { window._kanbanDragged = false; }, 50);
    }
    function kanbanDragOver(e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const col = e.target.closest('.kanban-col');
      if (col) col.classList.add('drag-over');
    }
    function kanbanDragLeave(e) {
      const col = e.target.closest('.kanban-col');
      if (col && !col.contains(e.relatedTarget)) col.classList.remove('drag-over');
    }
    function kanbanDrop(e) {
      e.preventDefault();
      window._kanbanDragged = true;
      const col = e.target.closest('.kanban-col');
      if (!col) return;
      col.classList.remove('drag-over');
      const stage = parseInt(col.getAttribute('data-stage'), 10);
      const id = e.dataTransfer.getData('text/plain') || _dragPatientId;
      if (!id || !stage) return;
      movePatientStage(id, stage);
    }

    async function movePatientStage(id,newStage) {
      if(!requireManual())return;newStage=parseInt(newStage,10);const p=DB.patients[id];if(!p||newStage<1||newStage>5||p.stageNum===newStage)return;
      const old=STAGES.find(x=>x.num===p.stageNum),neu=STAGES.find(x=>x.num===newStage);
      const next={...p,stageNum:newStage,history:[{type:'system',icon:'🔄',title:'Смена этапа',date:nowLabel(),body:'Этап: '+(old?.label||'—')+' → '+neu.label},...p.history]};
      try{await window.crmApi('/api/manual/patients/'+id,'PUT',{record:next,expectedVersion:p.version,createStageTask:true});await window.crmRefreshManual();toast('Этап изменён');}catch(e){if(e.message!=='session_changed')toast(e.message);}
    }

    let TASKS = [];
    let taskFilter = 'all';

    function filterTasks(f) {
      taskFilter = f;
      ['all','overdue','done'].forEach(x => {
        const el = document.getElementById('tf-' + x);
        if (el) el.className = 'badge' + (x === f ? ' teal' : '');
      });
      renderTasks();
    }

    function renderTasks() {
      const list = document.getElementById('tasks-list');
      const stats = document.getElementById('tasks-stats');
      if (!list) return;
      let items = TASKS.slice();
      if (taskFilter === 'overdue') items = items.filter(t => t.overdue && !t.done);
      else if (taskFilter === 'done') items = items.filter(t => t.done);
      else items = items.filter(t => !t.done).concat(items.filter(t => t.done));

      const open = TASKS.filter(t => !t.done).length;
      const od = TASKS.filter(t => t.overdue && !t.done).length;
      const done = TASKS.filter(t => t.done).length;
      if (stats) {
        stats.innerHTML = `
          <div class="tasks-stat"><div class="n">${open}</div><div class="l">Открытых</div></div>
          <div class="tasks-stat"><div class="n" style="color:#e11d48">${od}</div><div class="l">Просрочено</div></div>
          <div class="tasks-stat"><div class="n" style="color:#0d9488">${done}</div><div class="l">Выполнено</div></div>`;
      }

      list.innerHTML = items.map(t => `
        <div class="task-card ${t.done ? 'done' : ''} ${t.overdue && !t.done ? 'overdue' : ''}">
          <div class="task-check ${t.done ? 'on' : ''}" onclick="event.stopPropagation(); toggleTask(decodeURIComponent('${encodeURIComponent(String(t.id)).replace(/'/g,'%27')}'))">${t.done ? '✓' : ''}</div>
          <div class="task-body" onclick="openTaskEditor(decodeURIComponent('${encodeURIComponent(String(t.id)).replace(/'/g,'%27')}'))">
            <div class="task-title">${escapeHtml(String(t.title || ""))}</div>
            <div class="task-meta">
              <span>👤 ${escapeHtml(String(t.patient || ""))}</span>
              <span>👷 ${escapeHtml(String(t.assignee || ""))}</span>
              <span>🏷 ${escapeHtml(String(t.source || ""))}</span>
            </div>
          </div>
          <div class="task-right">
            <div class="badge ${t.overdue && !t.done ? 'rose' : ''}">${escapeHtml(String(t.due || ""))}</div><button type="button" class="badge" onclick="openTaskEditor(decodeURIComponent('${encodeURIComponent(String(t.id)).replace(/'/g,'%27')}'))">Редактировать</button>
          </div>
        </div>
      `).join('') || '<div style="padding:24px;color:#94a3b8;text-align:center">Нет задач в этом фильтре</div>';
    }

    async function toggleTask(id) {
      if(!requireManual())return;const t=TASKS.find(x=>x.id===id);if(!t)return;
      try{await window.crmApi('/api/manual/tasks/'+id,'PUT',{record:{...t,done:!t.done,overdue:t.done?t.overdue:false},expectedVersion:t.version});await window.crmRefreshManual();}catch(e){if(e.message!=='session_changed')toast(e.message);}
    }
    function openTaskPatient(pid) {
      if(!pid)return;if(pid.startsWith('tg_')){showView('comms');window.tgSelect(pid.slice(3));return;}
      if(!DB.patients[pid]){toast('Пациент не найден');return;}showView('comms');selectPatient(pid);
    }
    let editingTaskId=null;
    function addDemoTask(){openTaskEditor();}
    function openTaskEditor(id){
      if(!requireManual())return;const task=id?TASKS.find(t=>t.id===id):null;if(id&&!task)return;editingTaskId=task?task.id:null;taskEditVersion=task?.version??null;taskDraftId=task?null:newId('t');showManualError('task-save-error','');
      document.getElementById('task-modal-title').textContent=task?'Редактирование задачи':'Новая задача';window.crmFillStaff(document.getElementById('task-assignee-user'),task?.assigneeUserId||'');document.getElementById('task-title').value=task?.title||'';document.getElementById('task-assignee').value=task?.assignee==='—'?'':task?.assignee||'';document.getElementById('task-due').value=localInputValue(task?.dueAt);
      const legacy=task&&!task.dueAt&&task.due&&task.due!=='без срока'?task.due:'';document.getElementById('task-legacy-due').textContent=legacy?'Прежний срок: '+legacy+' (без точной даты)':'';document.getElementById('task-clear-legacy-wrap').style.display=legacy?'':'none';document.getElementById('task-clear-legacy').checked=false;
      document.getElementById('task-open-patient').style.display=task?.patientId?'':'none';const select=document.getElementById('task-patient');select.replaceChildren(new Option('Без пациента',''));
      Object.values(DB.patients).forEach(p=>select.add(new Option(p.name+' · карточка',p.id)));(window.getTelegramPatientOptions?.()||[]).forEach(p=>select.add(new Option(p.name+' · Telegram','tg_'+p.id)));
      select.value=task?.patientId||'';document.getElementById('task-modal').classList.add('open');document.getElementById('task-title').focus();
    }
    function openTaskLinkedPatient(){const task=TASKS.find(t=>t.id===editingTaskId);if(!task?.patientId)return;const id=task.patientId;closeTaskModal();openTaskPatient(id);}
    function closeTaskModal(){document.getElementById('task-modal').classList.remove('open');editingTaskId=null;}
    async function saveTask(){
      if(!requireManual()||taskSaving)return;const title=document.getElementById('task-title').value.trim();if(!title){showManualError('task-save-error','Укажите задачу');return;}
      const dateValue=document.getElementById('task-due').value,date=dateValue?new Date(dateValue):null;if(date&&Number.isNaN(date.getTime())){showManualError('task-save-error','Проверьте срок');return;}
      const task=editingTaskId&&TASKS.find(t=>t.id===editingTaskId);if(editingTaskId&&!task){showManualError('task-save-error','Задача недоступна');return;}
      const keepLegacy=task&&!task.dueAt&&task.due&&task.due!=='без срока'&&!date&&!document.getElementById('task-clear-legacy').checked;
      const record={...task,title,assigneeUserId:document.getElementById('task-assignee-user').value,assignee:document.getElementById('task-assignee').value.trim()||'—',patientId:document.getElementById('task-patient').value,dueAt:date?date.toISOString():null,due:date?date.toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}):keepLegacy?task.due:'без срока',overdue:keepLegacy?task.overdue:!!(date&&date.getTime()<Date.now()),done:task?.done||false,source:task?.source||'Вручную'};
      const id=editingTaskId||taskDraftId;taskSaving=true;document.getElementById('task-save-button').disabled=true;showManualError('task-save-error','');
      try{await window.crmApi('/api/manual/tasks/'+id,'PUT',{record,expectedVersion:taskEditVersion});await window.crmRefreshManual();closeTaskModal();filterTasks('all');toast('Задача сохранена');}
      catch(e){if(e.message!=='session_changed')showManualError('task-save-error',e.message);}
      finally{taskSaving=false;document.getElementById('task-save-button').disabled=false;}
    }
    const oldRenderTasks=renderTasks;renderTasks=function(){TASKS.forEach(t=>{if(t.dueAt&&!t.done){const d=new Date(t.dueAt);t.overdue=d.getTime()<Date.now();t.due=d.toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});}});oldRenderTasks();};

    function showView(name) {
      if (!document.getElementById('view-' + name)) return;
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      const view = document.getElementById('view-' + name);
      if (view) view.classList.add('active');
      const nav = document.getElementById('nav-' + name);
      if (nav) nav.classList.add('active');
      if (name === 'kanban') renderKanban();
      if (name === 'tasks') renderTasks();
    }

    function toast(msg) {
      const el = document.getElementById('toast');
      el.textContent = msg;
      el.classList.add('show');
      clearTimeout(window._toastTimer);
      window._toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
    }

    renderInbox = function() {
      const list=document.getElementById('inbox-list');list.innerHTML='';
      if(window.renderTelegramInboxItems)window.renderTelegramInboxItems(list);
      DB.inboxOrder.forEach(id=>{const p=DB.patients[id];if(!p)return;const node=document.createElement('div');
        node.className='sidebar-item px-4 py-3.5'+(id===currentPatientId && !(window.tgHasSelectedChat && window.tgHasSelectedChat())?' active':'');node.onclick=()=>selectPatient(id);
        const safe=v=>escapeHtml(String(v ?? ''));const title=p.channelIcon==='📞'?p.phone:p.name;
        node.innerHTML=`<div class="sidebar-item-row"><div class="ch-icon">${safe(p.channelIcon)}</div><div class="ch-body"><div class="ch-top"><span class="ch-name">${safe(title)}</span>${p.unread ? `<span class="unread">${safe(p.unread)}</span>` : `<span class="ch-time">${safe(p.timeLabel)}</span>`}</div><div class="ch-preview">Карточка · ${safe(p.preview)}</div></div></div>`;list.appendChild(node);
      });updateInboxCount();
    };
    renderInbox();
