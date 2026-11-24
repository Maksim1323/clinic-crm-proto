const STAGES = [
      { num: 1, label: '1 · Первичный приём' },
      { num: 2, label: '2 · Продажа плана лечения' },
      { num: 3, label: '3 · Лечение' },
      { num: 4, label: '4 · Профосмотр' },
      { num: 5, label: '5 · Потенциальный клиент' }
    ];

    // Only user-created local cards are shown; old bundled examples stay hidden.
    const DB = {patients:{}, inboxOrder:[]};
    // Fingerprints only; edits to old examples are retained as user data.
    const oldPatientHashes={ivanov:'678ce3fc',smirnova:'5a4abae3',alexey:'dfcc47b3',site:'7ba6aa2e',mis:'396d6011'};
    const oldTaskHashes={t1:'4dcee95',t2:'6927ebd4',t3:'7fb0ffdb',t4:'fc7d9b50',t5:'512e16ff',t6:'40f30a8c'};
    function fingerprint(obj){let h=2166136261;const text=JSON.stringify(obj);for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619);}return (h>>>0).toString(16);}
    let currentPatientId = null;
    let pendingStage = null;
    const localVisibilityFields=['name','phone','age','gender','channel','admin','doctor','stage','bonuses','nps','nospam','inclinic','plan','note'];
    const localDefaultHidden=new Set(['gender','channel','nps','inclinic','note']);
    function localFieldVisible(p,key){return typeof p?.visibility?.[key]==='boolean'?p.visibility[key]:!localDefaultHidden.has(key);}
    function readLocalVisibility(){return Object.fromEntries(localVisibilityFields.map(key=>[key,document.getElementById('pf-show-'+key).checked]));}


    const STORAGE_KEY = 'cliniccrm_v13';

    function saveDB() {
      try {
        const payload = {
          patients: DB.patients,
          inboxOrder: DB.inboxOrder,
          currentPatientId
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      } catch (e) { console.warn('save failed', e); }
    }

    function loadDB() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const data = JSON.parse(raw);
        if (data.patients && typeof data.patients === 'object') {
          Object.keys(data.patients).filter(id=>!oldPatientHashes[id]||fingerprint(data.patients[id])!==oldPatientHashes[id]).forEach(id=>{DB.patients[id]=data.patients[id];});
        }
        if (Array.isArray(data.inboxOrder) && data.inboxOrder.length) {
          DB.inboxOrder = data.inboxOrder.filter(id=>DB.patients[id]);
        }
        if (data.currentPatientId && DB.patients[data.currentPatientId]) {
          currentPatientId = data.currentPatientId;
        }
      } catch (e) { console.warn('load failed', e); }
    }

    const CHANNEL_META = {
      call:  { icon: '📞', label: 'Звонок' },
      tg:    { icon: '✈️', label: 'Telegram' },
      vk:    { icon: '🌐', label: 'ВКонтакте' },
      email: { icon: '📧', label: 'Сайт · Форма' },
      mis:   { icon: '✔️', label: 'МИС' }
    };

    let patientModalMode = 'edit';

    function openPatientModal(mode) {
      patientModalMode = mode || 'edit';
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
      localVisibilityFields.forEach(key=>{document.getElementById('pf-show-'+key).checked=localFieldVisible(shownPatient,key);});
      modal.classList.add('open');
      setTimeout(() => document.getElementById('pf-name').focus(), 50);
    }

    function closePatientModal() {
      document.getElementById('patient-modal').classList.remove('open');
    }

    function savePatientCard() {
      const name = document.getElementById('pf-name').value.trim();
      const phone = document.getElementById('pf-phone').value.trim();
      if (!name) { toast('Укажите ФИО'); return; }
      if (!phone) { toast('Укажите телефон'); return; }

      const ch = document.getElementById('pf-channel').value;
      const meta = CHANNEL_META[ch] || CHANNEL_META.call;
      const gender = document.getElementById('pf-gender').value;
      const emoji = gender === 'female' ? '👩' : (gender === 'male' ? '👨' : '👤');
      const stageNum = parseInt(document.getElementById('pf-stage').value, 10) || 1;
      const npsRaw = document.getElementById('pf-nps').value;
      const nps = npsRaw === '' ? null : parseInt(npsRaw, 10);

      if (patientModalMode === 'create') {
        const id = 'p_' + Date.now();
        const patient = {
          id, name, visibility:readLocalVisibility(), age: document.getElementById('pf-age').value.trim() || '—',
          emoji, gender: gender || null, phone,
          channelIcon: meta.icon, channelLabel: meta.label,
          timeLabel: 'сейчас', unread: 0, statusInClinic: document.getElementById('pf-inclinic').checked,
          admin: document.getElementById('pf-admin').value.trim() || '—',
          doctor: document.getElementById('pf-doctor').value.trim() || '—',
          stageNum, stageTotal: 5,
          noSpam: document.getElementById('pf-nospam').checked,
          bonuses: parseInt(document.getElementById('pf-bonuses').value, 10) || 0,
          nps,
          preview: 'Новая карточка',
          createdAt: new Date().toLocaleDateString('ru-RU'),
          plan: document.getElementById('pf-plan').value.trim() || null,
          note: document.getElementById('pf-note').value.trim() || '',
          history: [{
            type: 'system', icon: '📋', title: 'Карточка создана',
            date: nowLabel(),
            body: '<div class="text-slate-700">Пациент добавлен в CRM · канал: ' + meta.label + '</div>'
          }]
        };
        const note = document.getElementById('pf-note').value.trim();
        if (note) {
          patient.history.unshift({
            type: 'note', icon: '📝', title: 'Заметка',
            date: nowLabel(),
            body: '<div class="text-slate-700" style="white-space:pre-wrap">' + escapeHtml(note) + '</div>'
          });
        }
        DB.patients[id] = patient;
        DB.inboxOrder.unshift(id);
        closePatientModal();
        saveDB();
        showView('comms');
        selectPatient(id);
        toast('✓ Карточка создана: ' + name);
      } else {
        const id = document.getElementById('pf-id').value || currentPatientId;
        const p = DB.patients[id];
        if (!p) { toast('Пациент не найден'); return; }
        const oldName = p.name;
        p.visibility = readLocalVisibility();
        p.name = name;
        p.phone = phone;
        p.age = document.getElementById('pf-age').value.trim() || '—';
        p.gender = gender || null;
        p.emoji = emoji;
        p.channelIcon = meta.icon;
        p.channelLabel = meta.label;
        p.admin = document.getElementById('pf-admin').value.trim() || '—';
        p.doctor = document.getElementById('pf-doctor').value.trim() || '—';
        p.stageNum = stageNum;
        p.bonuses = parseInt(document.getElementById('pf-bonuses').value, 10) || 0;
        p.nps = nps;
        p.noSpam = document.getElementById('pf-nospam').checked;
        p.statusInClinic = document.getElementById('pf-inclinic').checked;
        p.plan = document.getElementById('pf-plan').value.trim() || null;
        p.note = document.getElementById('pf-note').value.trim() || '';
        p.history.unshift({
          type: 'system', icon: '✏️', title: 'Карточка обновлена',
          date: nowLabel(),
          body: '<div class="text-slate-700">Данные пациента изменены' + (oldName !== name ? ' (ФИО: ' + escapeHtml(oldName) + ' → ' + escapeHtml(name) + ')' : '') + '</div>'
        });
        closePatientModal();
        saveDB();
        renderPatient(id, false);
        toast('✓ Карточка сохранена');
      }
    }

    function sendMessage() {
      const input=document.getElementById('msg-input'), p=DB.patients[currentPatientId];
      if(!p || !input.value.trim())return;
      const text=input.value.trim();input.value='';p.preview='Демо: '+text.slice(0,40);p.unread=0;
      addHistory('💬','Сообщение · демо, не отправлено','<div style="white-space:pre-wrap">'+escapeHtml(text)+'</div>');
      toast('Сохранено локально · сообщение не отправлено');
    }

    function escapeHtml(s) {
      return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }



    function nowLabel() {
      const d = new Date();
      return 'сегодня ' + String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
    }

    function addHistory(icon, title, body) {
      const p = DB.patients[currentPatientId];
      p.history.unshift({ type: 'action', icon, title, date: nowLabel(), body });
      saveDB();
      renderPatient(currentPatientId, false);
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

    function confirmStage() {
      if (pendingStage == null) return;
      const p = DB.patients[currentPatientId];
      const old = STAGES.find(s => s.num === p.stageNum);
      const neu = STAGES.find(s => s.num === pendingStage);
      p.stageNum = pendingStage;
      addHistory('🔄', 'Смена статуса',
        `<div class="text-slate-700">Этап изменён:<br>
        <span class="text-slate-400">${old ? old.label : '—'}</span>
        → <span class="text-indigo-600 font-medium">${neu.label}</span></div>`);
      closeStageModal();
      toast('✓ Статус: ' + neu.label);
      renderPatient(currentPatientId, false);
    }

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
            <span class="hist-icon">${h.icon}</span>
            <span class="hist-title">${h.title}</span>
            <span class="hist-date">${h.date}</span>
          </div>
          <div class="hist-body">${h.body}</div>
        </div>
      `).join('');

      // Profile card (design)
      renderProfileCard(p);
      renderInbox();
      if (showToast) toast('Карточка: ' + p.name);
    }

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

    function movePatientStage(id, newStage) {
      newStage = parseInt(newStage, 10);
      if (newStage < 1 || newStage > 5) return;
      const p = DB.patients[id];
      if (!p) return;
      if (p.stageNum === newStage) return;
      const old = STAGES.find(s => s.num === p.stageNum);
      const neu = STAGES.find(s => s.num === newStage);
      p.stageNum = newStage;
      p.history.unshift({
        type: 'system', icon: '🔄',
        title: 'Смена этапа',
        date: nowLabel(),
        body: `<div>Этап: <b>${old ? old.label : '—'}</b> → <b>${neu ? neu.label : '—'}</b> (канбан)</div>`
      });
      const prevNum = old ? old.num : null;
      if (typeof saveDB === 'function') saveDB();
      renderKanban();
      if (currentPatientId === id) renderPatient(id, false);
      if (typeof onStageChanged === 'function') onStageChanged(id, prevNum, newStage);
      toast('→ ' + (neu ? neu.label : newStage));
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

    function toggleTask(id) {
      const t = TASKS.find(x => x.id === id);
      if (!t) return;
      t.done = !t.done;
      if (t.done) t.overdue = false;
      renderTasks();
      toast(t.done ? '✓ Задача выполнена' : 'Задача снова открыта');
    }

    function openTaskPatient(pid) {
      if (!pid || !DB.patients[pid]) { toast('Пациент не найден'); return; }
      showView('comms');
      selectPatient(pid);
    }

    let editingTaskId = null;
    function addDemoTask() { openTaskEditor(); }
    function openTaskEditor(id) {
      const task=id ? TASKS.find(t=>t.id===id) : null; if(id && !task)return;
      editingTaskId=task ? task.id : null;
      document.getElementById('task-modal-title').textContent=task ? 'Редактирование задачи' : 'Новая задача';
      document.getElementById('task-title').value=task?.title || '';
      document.getElementById('task-assignee').value=task?.assignee || '';
      document.getElementById('task-due').value=task?.dueAt || '';
      const legacy=task && !task.dueAt && task.due && task.due!=='без срока' ? task.due : '';
      document.getElementById('task-legacy-due').textContent=legacy ? 'Прежний срок: '+legacy+' (без точной даты)' : '';
      document.getElementById('task-clear-legacy-wrap').style.display=legacy ? '' : 'none';document.getElementById('task-clear-legacy').checked=false;
      document.getElementById('task-open-patient').style.display=task?.patientId && DB.patients[task.patientId] ? '' : 'none';
      const select=document.getElementById('task-patient');select.replaceChildren(new Option('Без пациента',''));
      Object.values(DB.patients).forEach(p=>select.add(new Option(p.name,p.id)));
      select.value=task?.patientId || '';
      document.getElementById('task-modal').classList.add('open');document.getElementById('task-title').focus();
    }
    function openTaskLinkedPatient() { const task=TASKS.find(t=>t.id===editingTaskId); if(!task || !DB.patients[task.patientId])return;const id=task.patientId;closeTaskModal();openTaskPatient(id); }
    function closeTaskModal() { document.getElementById('task-modal').classList.remove('open');editingTaskId=null; }
    function saveTask() {
      const title=document.getElementById('task-title').value.trim(); if(!title){toast('Укажите задачу');return;}
      const dueAt=document.getElementById('task-due').value, date=dueAt ? new Date(dueAt) : null;
      if(date && Number.isNaN(date.getTime())){toast('Проверьте срок');return;}
      const patientId=document.getElementById('task-patient').value, patient=DB.patients[patientId];
      let task=editingTaskId && TASKS.find(t=>t.id===editingTaskId);
      const keepLegacy=task && !task.dueAt && task.due && task.due!=='без срока' && !date && !document.getElementById('task-clear-legacy').checked;
      const fields={title,assignee:document.getElementById('task-assignee').value.trim() || '—',patientId:patient ? patient.id : '',patient:patient ? patient.name : '—',dueAt:dueAt || null,due:date ? date.toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}) : (keepLegacy ? task.due : 'без срока'),overdue:keepLegacy ? task.overdue : !!(date && date.getTime()<Date.now())};
      if(task)Object.assign(task,fields);else TASKS.unshift({...fields,id:'t_'+Date.now()+'_'+Math.random().toString(36).slice(2),done:false,source:'Вручную'});
      const saved=persistTasks();closeTaskModal();filterTasks('all');toast(saved ? '✓ Задача сохранена' : 'Задача не сохранена в браузере');
    }
    const taskKey='cliniccrm_journey_tasks_v1';
    function persistTasks() { try { localStorage.setItem(taskKey,JSON.stringify(TASKS)); return true; } catch (_) { toast('Не удалось сохранить задачи в браузере'); return false; } }
    try { const saved=JSON.parse(localStorage.getItem(taskKey));if(Array.isArray(saved))TASKS=saved.filter(t=>!oldTaskHashes[t.id]||fingerprint(t)!==oldTaskHashes[t.id]);  } catch (_) {}
    const oldToggleTask=toggleTask; toggleTask=function(id){oldToggleTask(id);persistTasks();};
    const oldRenderTasks=renderTasks; renderTasks=function(){TASKS.forEach(t=>{if(t.dueAt && !t.done)t.overdue=new Date(t.dueAt).getTime()<Date.now();});oldRenderTasks();};

    function onStageChanged(patientId, oldStage, newStage) {
      const p = DB.patients[patientId];
      if (typeof TASKS !== 'undefined' && p) {
        TASKS.unshift({
          id: 't_auto_' + Date.now(),
          title: 'Проверить этап: ' + (STAGES.find(s => s.num === newStage) || {}).label,
          patientId, patient: p.name,
          assignee: p.admin && p.admin!=='—' ? p.admin : '—',
          due: 'сегодня', overdue: false, done: false, source: 'Смена этапа · демо'
        });
        persistTasks();
      }
    }

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
        node.innerHTML=`<div class="sidebar-item-row"><div class="ch-icon">${safe(p.channelIcon)}</div><div class="ch-body"><div class="ch-top"><span class="ch-name">${safe(title)}</span>${p.unread ? `<span class="unread">${safe(p.unread)}</span>` : `<span class="ch-time">${safe(p.timeLabel)}</span>`}</div><div class="ch-preview">Локально · ${safe(p.preview)}</div></div></div>`;list.appendChild(node);
      });updateInboxCount();
    };
    loadDB();
    renderInbox();
    renderPatient(currentPatientId, false);
