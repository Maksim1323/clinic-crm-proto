const STAGES = [
      { num: 1, label: '1 · Первичный приём' },
      { num: 2, label: '2 · Продажа плана лечения' },
      { num: 3, label: '3 · Лечение' },
      { num: 4, label: '4 · Профосмотр' },
      { num: 5, label: '5 · Потенциальный клиент' }
    ];

    const TEMPLATES = {
      address: {
        title: 'Шаблон · Адрес клиники',
        text: 'Наш адрес: ул. Примерная, 12, 3 этаж. Парковка во дворе. Работаем пн–сб 9:00–21:00.'
      },
      price: {
        title: 'Шаблон · Прайс',
        text: 'Проф. чистка — от 4 500 ₽\nПервичный осмотр — бесплатно\nКонсультация ортодонта — 2 000 ₽\nПолный прайс пришлём по запросу.'
      }
    };

    const DB = {
      patients: {
        ivanov: {
          id: 'ivanov', name: 'Иванов Иван Иванович', age: '35 лет', emoji: '👨', createdAt: '12.05.2024', gender: 'male',
          phone: '+7 999 123-45-67', channelIcon: '📞', channelLabel: 'UIS · Первичный',
          timeLabel: '00:15', unread: 0, statusInClinic: true,
          admin: 'Анна Петрова', doctor: 'Смирнов А.А.',
          stageNum: 2, stageTotal: 5, noSpam: true, bonuses: 1500, nps: 9,
          preview: 'Идёт разговор...',
          plan: 'Ортодонтия · брекет-система · ориентир 85 000 ₽',
          history: [
            { type:'visit', icon:'🩺', title:'Приём · Первичная консультация', date:'14.05.2024',
              body:'Врач: Смирнов А.А. · NPS 9/10<br><span class="text-indigo-600 font-medium">Назначен план «Ортодонтия»</span>' },
            { type:'msg', icon:'✈️', title:'Telegram', date:'13.05.2024',
              body:'<div class="text-slate-400 italic">Пациент: «А как подготовиться?» <span class="text-[11px]">(удалено)</span></div><div class="text-slate-700 mt-1">Анна: «Специальной подготовки не требуется...»</div>' },
            { type:'call', icon:'📞', title:'Звонок UIS · Первичный', date:'12.05.2024',
              body:'<button onclick="toast(\'Воспроизведение записи...\')" class="text-[12px] text-teal-600 font-medium mb-2 hover:underline">▶ Прослушать</button><div class="bg-white rounded-lg border border-slate-100 p-3 text-[13px]"><div class="text-slate-500 mb-1 font-medium text-[12px]">🤖 ИИ-транскрибация</div><div class="text-slate-700">«Алло, здравствуйте, я хочу записаться на осмотр...»</div><div class="mt-2 flex items-start gap-2 bg-teal-50 rounded-lg px-3 py-2 border border-teal-100"><span>💡</span><span class="text-[12px] text-teal-800">Скрипт «Запись на первичный осмотр»</span></div></div>' }
          ]
        },
        smirnova: {
          id: 'smirnova', name: 'Мария Смирнова', age: '28 лет', emoji: '👩', createdAt: '06.11.2026', gender: 'female',
          phone: '+7 916 444-55-66', channelIcon: '✈️', channelLabel: 'Telegram',
          timeLabel: 'сейчас', unread: 1, statusInClinic: false,
          admin: 'Анна Петрова', doctor: '—',
          stageNum: 1, stageTotal: 5, noSpam: false, bonuses: 0, nps: null,
          preview: 'Хочу записаться на чистку...',
          plan: null,
          history: [
            { type:'msg', icon:'✈️', title:'Telegram', date:'сегодня 15:42',
              body:'<div class="text-slate-700">Пациент: «Здравствуйте! Хочу записаться на профессиональную чистку. Есть окна на этой неделе?»</div>' },
            { type:'msg', icon:'✈️', title:'Telegram', date:'сегодня 15:40',
              body:'<div class="text-slate-400 italic">Пациент начал диалог</div>' }
          ]
        },
        alexey: {
          id: 'alexey', name: 'Алексей Воронов', age: '41 год', emoji: '👨', createdAt: '05.11.2026', gender: 'male',
          phone: '+7 903 777-88-99', channelIcon: '🌐', channelLabel: 'ВКонтакте',
          timeLabel: '12:40', unread: 0, statusInClinic: false,
          admin: 'Мария Ковалёва', doctor: '—',
          stageNum: 1, stageTotal: 5, noSpam: false, bonuses: 200, nps: null,
          preview: 'Сколько стоит проф. чистка?',
          plan: null,
          history: [
            { type:'msg', icon:'🌐', title:'ВКонтакте', date:'сегодня 12:40',
              body:'<div class="text-slate-700">Пациент: «Добрый день. Сколько стоит профессиональная чистка? Есть скидки для первичных?»</div>' }
          ]
        },
        site: {
          id: 'site', name: 'Неизвестный (сайт)', age: '—', emoji: '📧', createdAt: '06.11.2026', gender: null,
          phone: '+7 926 111-22-33', channelIcon: '📧', channelLabel: 'Сайт · Форма',
          timeLabel: '11:05', unread: 0, statusInClinic: false,
          admin: '—', doctor: '—',
          stageNum: 1, stageTotal: 5, noSpam: false, bonuses: 0, nps: null,
          preview: '«Перезвоните мне»',
          plan: null,
          history: [
            { type:'email', icon:'📧', title:'Обращение с сайта', date:'сегодня 11:05',
              body:'<div class="text-slate-700">Телефон: +7 926 111-22-33<br>Сообщение: «Перезвоните мне, хочу записаться к ортодонту»</div><div class="mt-2 text-[12px] text-slate-400">Источник: форма на сайте</div>' }
          ]
        },
        mis: {
          id: 'mis', name: 'Козлова Елена', age: '32 года', emoji: '👩', createdAt: '20.04.2024', gender: 'female',
          phone: '+7 905 333-44-55', channelIcon: '✔️', channelLabel: 'МИС · Подтверждение',
          timeLabel: 'авто', unread: 0, statusInClinic: false,
          admin: 'Анна Петрова', doctor: 'Кузнецова О.В.',
          stageNum: 3, stageTotal: 5, noSpam: false, bonuses: 800, nps: 8,
          preview: 'Визит сегодня 14:30',
          plan: 'Терапия · этап 2 из 4',
          history: [
            { type:'mis', icon:'✔️', title:'МИС · Авто-подтверждение', date:'сегодня 09:00',
              body:'<div class="text-slate-700">Пациент подтвердил визит на <b>сегодня 14:30</b><br>Врач: Кузнецова О.В. · Терапия</div>' },
            { type:'visit', icon:'🩺', title:'Приём · Терапия (этап 2)', date:'20.04.2024',
              body:'Врач: Кузнецова О.В. · NPS 8/10<br><span class="text-indigo-600 font-medium">Следующий этап: 03.05.2024</span>' }
          ]
        }
      },
      inboxOrder: ['ivanov', 'smirnova', 'alexey', 'site', 'mis']
    };

    let currentPatientId = 'ivanov';
    let pendingStage = null;

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
          // merge: keep defaults for missing, overwrite with saved
          Object.keys(data.patients).forEach(id => {
            DB.patients[id] = Object.assign({}, DB.patients[id] || {}, data.patients[id]);
          });
        }
        if (Array.isArray(data.inboxOrder) && data.inboxOrder.length) {
          DB.inboxOrder = data.inboxOrder;
        }
        if (data.currentPatientId && DB.patients[data.currentPatientId]) {
          currentPatientId = data.currentPatientId;
        }
      } catch (e) { console.warn('load failed', e); }
    }

    const CHANNEL_META = {
      call:  { icon: '📞', label: 'UIS · Звонок' },
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
        document.getElementById('pf-admin').value = 'Анна Петрова';
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
          id, name, age: document.getElementById('pf-age').value.trim() || '—',
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
      const input = document.getElementById('msg-input');
      if (!input) return;
      const text = (input.value || '').trim();
      if (!text) return;
      const p = DB.patients[currentPatientId];
      if (!p) return;
      if (p.noSpam) {
        // still allow 1:1 reply, only block marketing templates
      }
      addHistory('💬', 'Исходящее сообщение',
        `<div class="text-slate-700" style="white-space:pre-wrap">${escapeHtml(text)}</div>
         <div style="margin-top:8px;font-size:12px;color:#0d9488">Отправлено · ${nowLabel()}</div>`);
      p.preview = 'Вы: ' + text.slice(0, 40);
      p.unread = 0;
      input.value = '';
      saveDB();
      toast('✓ Сообщение сохранено в истории');
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
    function actionBookMIS() {
      const p = DB.patients[currentPatientId];
      addHistory('📝', 'Запись в МИС',
        `<div class="text-slate-700">Администратор создал запись на приём в МИС.<br>
        Пациент: <b>${p.name}</b><br>
        Статус в МИС: <span class="text-teal-600 font-medium">ожидает подтверждения</span></div>
        <div class="mt-2 text-[12px] text-slate-400">Синхронизация с IDENT / МИС выполнена (демо)</div>`);
      if (p.stageNum === 1) {
        p.stageNum = 1;
        p.preview = 'Запись в МИС создана';
      }
      toast('✓ Запись создана в МИС');
    }

    function actionTemplate(key) {
      const t = TEMPLATES[key];
      if (!t) return;
      const p = DB.patients[currentPatientId];
      if (p.noSpam && key === 'price') {
        toast('⚠ У пациента отказ от рассылок — шаблон не отправлен');
        addHistory('🚫', 'Блок рассылки',
          `<div class="text-rose-600">Попытка отправить «${escapeHtml(String(t.title || ""))}» заблокирована: у пациента стоит отказ от рассылок.</div>`);
        return;
      }
      addHistory('💬', t.title + ' · отправлено',
        `<div class="text-slate-700 whitespace-pre-line">${t.text}</div>
         <div class="mt-2 text-[12px] text-teal-600">Отправлено пациенту · ${nowLabel()}</div>`);
      toast('✓ ' + t.title + ' отправлен');
    }

    function actionPlan() {
      const p = DB.patients[currentPatientId];
      if (p.plan) {
        addHistory('📄', 'План лечения',
          `<div class="text-slate-700"><b>Текущий план:</b><br>${p.plan}</div>
           <div class="mt-2 text-[12px] text-slate-400">Открыт для просмотра / отправки пациенту</div>`);
        toast('✓ План лечения: ' + p.plan.slice(0, 40) + '…');
      } else {
        addHistory('📄', 'План лечения',
          `<div class="text-slate-500">План лечения ещё не назначен. После первичного приёма врач сформирует план в МИС — он появится здесь.</div>`);
        toast('План лечения пока не назначен');
      }
    }

    function actionReminder() {
      const p = DB.patients[currentPatientId];
      addHistory('🔔', 'Напоминание создано',
        `<div class="text-slate-700">Задача: связаться с пациентом <b>${p.name}</b><br>
        Срок: завтра, 11:00<br>
        Ответственный: ${p.admin !== '—' ? p.admin : 'Анна Петрова'}</div>
        <div class="mt-2 text-[12px] text-amber-600">Задача добавлена в список задач</div>`);
      toast('✓ Напоминание создано на завтра 11:00');
    }

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


    const AI_RECS = {
      1: {
        title: 'Сценарий: запись на приём',
        body: 'По регламенту первичного приёма: уточнить специализацию, предложить 2 реальных слота из МИС, не создавать запись без подтверждения администратора.',
        actions: [
          { label: '✓ Подтвердить предложение слотов', fn: 'aiConfirmSlots' },
          { label: '✎ Править черновик сообщения', fn: 'aiEditDraft' },
          { label: 'Передать человеку', fn: 'demoEscalation' }
        ],
        process: 2
      },
      2: {
        title: 'Сценарий: сопровождение после консультации',
        body: 'План лечения в МИС есть, оплата частичная, следующий визит не назначен. По регламенту курации: связаться в течение 48 часов, предложить поэтапную оплату, не закрывать в отказ без предложения рассрочки.',
        actions: [
          { label: '✓ Подтвердить задачу куратору', fn: 'aiConfirmCurator' },
          { label: 'Открыть шпаргалку звонка', fn: 'aiShowBrief' },
          { label: 'Передать куратору', fn: 'demoEscalation' }
        ],
        process: 2
      },
      3: {
        title: 'Контроль лечения',
        body: 'ИИ отслеживает явки и оплаты по плану. Отклонений по регламенту не обнаружено. Следующий шаг — напоминание о визите за 24 часа.',
        actions: [
          { label: '✓ Поставить напоминание', fn: 'actionReminder' },
          { label: 'Без изменений', fn: 'aiDismiss' }
        ],
        process: 3
      },
      4: {
        title: 'Профосмотр / recall',
        body: 'По регламенту гарантии: через 6 месяцев после имплантации/коронок нужна профгигиена. ИИ подобрал окна у гигиениста.',
        actions: [
          { label: '✓ Отправить приглашение', fn: 'aiConfirmSlots' },
          { label: 'Отложить', fn: 'aiDismiss' }
        ],
        process: 2
      },
      5: {
        title: 'Потенциальный / прогрев',
        body: 'Пациент в базе прогрева. Проверка D1: если есть отказ от рассылок — не звонить автоматически. Человек решает, допустим ли контакт.',
        actions: [
          { label: 'Разрешить один контакт', fn: 'aiConfirmCurator' },
          { label: 'Оставить в покое', fn: 'aiDismiss' }
        ],
        process: 1
      }
    };

    function renderAIRec(p) {
      const rec = AI_RECS[p.stageNum] || AI_RECS[1];
      const title = document.getElementById('ai-rec-title');
      const body = document.getElementById('ai-rec-body');
      const acts = document.getElementById('ai-rec-actions');
      const strip = document.getElementById('ai-process-strip');
      if (!title) return;
      title.textContent = rec.title;
      let extra = '';
      if (p.noSpam) extra = ' ⚠ У пациента отказ от рассылок — маркетинг заблокирован.';
      body.textContent = rec.body + extra;
      acts.innerHTML = rec.actions.map(a => {
        const cls = a.label.indexOf('✓') === 0 ? 'confirm' : '';
        return `<button type="button" class="${cls}" onclick="${a.fn}()">${a.label}</button>`;
      }).join('');
      if (strip) {
        const steps = strip.querySelectorAll('.step');
        steps.forEach((s, i) => s.classList.toggle('active', i === (rec.process || 1)));
      }
      // auto show escalation visual if noSpam + stage 5 or conflict markers in history
      const esc = document.getElementById('esc-banner');
      if (esc && p._escalation) {
        esc.classList.add('show');
        document.getElementById('esc-title').textContent = p._escalation.title;
        document.getElementById('esc-body').textContent = p._escalation.body;
        document.getElementById('esc-sla').textContent = 'SLA: ' + p._escalation.sla;
      } else if (esc) {
        esc.classList.remove('show');
      }
    }

    function aiConfirmSlots() {
      const p = DB.patients[currentPatientId];
      if (!p) return;
      addHistory('🤖', 'ИИ · подтверждены слоты',
        '<div>Администратор подтвердил предложение ИИ: 2 окна из МИС. Запись <b>не создана автоматически</b> — требуется финальный клик «Записать в МИС».</div>');
      p.preview = 'ИИ: слоты подтверждены';
      toast('✓ Предложение принято · запись ждёт подтверждения в МИС');
      setProcessStep(3);
    }
    function aiEditDraft() {
      const input = document.getElementById('msg-input');
      if (input) {
        input.value = 'Добрый день! Могу предложить приём: завтра 14:00 или послезавтра 11:30 к стоматологу. Какой вариант удобнее?';
        showPatientHistory();
        input.focus();
      }
      toast('Черновик подставлен · отправьте вручную');
    }
    function aiConfirmCurator() {
      const p = DB.patients[currentPatientId];
      if (!p) return;
      addHistory('🤖', 'ИИ · задача куратору',
        '<div>Сформирован Action Package: связаться в 48 ч, предложить поэтапную оплату, не закрывать в отказ без рассрочки.</div>');
      toast('✓ Задача куратору поставлена (демо)');
      setProcessStep(3);
    }
    function aiShowBrief() {
      const p = DB.patients[currentPatientId];
      const html = `
        <div style="margin-bottom:12px"><b>Причина:</b> план лечения без следующего визита</div>
        <div style="margin-bottom:12px"><b>Контекст МИС:</b> план · оплата частичная · врач ${p && p.doctor || '—'}</div>
        <div style="margin-bottom:12px"><b>Суть:</b> пациент «подумает» · по регламенту нельзя закрывать без предложения рассрочки</div>
        <div style="background:#f0fdfa;border:1px solid #99f6e4;border-radius:10px;padding:10px">
          <b>Рекомендуемое первое действие:</b><br>
          Позвонить, напомнить про временную фиксацию (до 3 недель), предложить этап 1 и 2 окна на этой неделе.
        </div>`;
      document.getElementById('handoff-content').innerHTML = html;
      document.getElementById('handoff-modal').classList.add('open');
    }
    function aiDismiss() {
      toast('Рекомендация отложена');
      setProcessStep(0);
    }
    function setProcessStep(n) {
      const strip = document.getElementById('ai-process-strip');
      if (!strip) return;
      strip.querySelectorAll('.step').forEach((s, i) => s.classList.toggle('active', i === n));
    }
    function demoEscalation() {
      const p = DB.patients[currentPatientId];
      if (!p) return;
      p._escalation = {
        title: '🚩 Регламент №2 · Конфликт / претензия (демо)',
        body: 'Обнаружены маркеры негатива или запрос «верните деньги». Авто-рассылки заморожены. Нужен человек.',
        sla: '≤ 15 мин · Директор / Главврач / Сервис'
      };
      const handoff = `
        <div style="margin-bottom:10px;padding:8px 10px;background:#fff1f2;border-radius:8px;color:#be123c;font-weight:600">
          Причина: Регламент №2 · Юридический и репутационный щит
        </div>
        <div style="margin-bottom:10px"><b>Клинический контекст (IDENT):</b> последний визит и план подтягиваются из МИС (в прототипе — демо).</div>
        <div style="margin-bottom:10px"><b>Суть диалога:</b> ${(p.preview || '—')}</div>
        <div style="margin-bottom:10px"><b>Пациент:</b> ${p.name} · ${p.phone || ''}</div>
        <div style="background:#f8fafc;border-radius:10px;padding:10px">
          <b>Рекомендуемое действие:</b> перехватить диалог живым сотрудником, не отправлять шаблоны, зафиксировать претензию.
        </div>`;
      document.getElementById('handoff-content').innerHTML = handoff;
      document.getElementById('handoff-modal').classList.add('open');
      renderAIRec(p);
      addHistory('🚩', 'Эскалация · handoff',
        '<div>ИИ передал карточку человеку. Авто-сценарии остановлены. SLA ≤ 15 мин.</div>');
      toast('Эскалация: человек вызван');
    }
    function closeHandoff() {
      document.getElementById('handoff-modal').classList.remove('open');
    }
    function acceptHandoff() {
      addHistory('👤', 'Человек принял handoff',
        '<div>Сотрудник подтвердил приём в работу. ИИ остаётся в режиме ассистента.</div>');
      closeHandoff();
      toast('✓ В работе у сотрудника');
      setProcessStep(3);
    }

    function renderPatient(id, showToast = true) {
      const p = DB.patients[id];
      if (!p) return;
      currentPatientId = id;
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
      renderAIRec(p);

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
      const since = p.createdAt || '06.11.2026';
      document.getElementById('pr-since').textContent = 'Пациент с ' + since;

      const tags = document.getElementById('pr-tags');
      const ageTag = (p.age && /\d+/.test(p.age) && parseInt(p.age) < 18) ? 'Ребёнок' : 'Взрослый';
      let tagHtml = '<span class="tag muted">' + ageTag + '</span>';
      if (p.plan) {
        const short = p.plan.split('·')[0].trim().slice(0, 24);
        tagHtml += '<span class="tag">' + escapeHtml(short) + '</span>';
      } else if (p.stageNum === 1) {
        tagHtml += '<span class="tag">Первичный</span>';
      }
      tags.innerHTML = tagHtml;

      const spam = document.getElementById('pr-spam');
      spam.style.display = p.noSpam ? 'flex' : 'none';

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

      // show profile card mode
      document.querySelector('.patient-col')?.classList.add('profile-mode');
    }

    function showPatientHistory() {
      document.querySelector('.patient-col')?.classList.remove('profile-mode');
      toast('Чат');
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



    let TASKS = [
      { id: 't1', title: 'Подтвердить запись на чистку', patientId: 'smirnova', patient: 'Мария Смирнова', assignee: 'Анна Петрова', due: 'сегодня 18:00', overdue: false, done: false, source: 'ИИ · запись' },
      { id: 't2', title: 'Перезвонить по цене проф. чистки', patientId: 'alexey', patient: 'Алексей Воронов', assignee: 'Анна Петрова', due: 'сегодня 14:00', overdue: true, done: false, source: 'ВКонтакте' },
      { id: 't3', title: 'Уточнить следующий шаг после консультации', patientId: 'ivanov', patient: 'Иванов Иван Иванович', assignee: 'Мария Ковалёва', due: 'завтра 12:00', overdue: false, done: false, source: 'ИИ · курация' },
      { id: 't4', title: 'Проверить визит и NPS', patientId: 'mis', patient: 'Козлова Елена', assignee: 'Анна Петрова', due: 'сегодня 16:30', overdue: false, done: false, source: 'МИС' },
      { id: 't5', title: 'Связаться: форма с сайта', patientId: 'site', patient: 'Неизвестный (сайт)', assignee: 'Анна Петрова', due: 'вчера 17:00', overdue: true, done: false, source: 'Сайт' },
      { id: 't6', title: 'Отправить памятку после удаления', patientId: 'ivanov', patient: 'Иванов Иван Иванович', assignee: 'Дмитрий Соколов', due: '06.11', overdue: false, done: true, source: 'Регламент' }
    ];
    let taskFilter = 'all';

    function filterTasks(f) {
      taskFilter = f;
      ['all','mine','overdue','done'].forEach(x => {
        const el = document.getElementById('tf-' + x);
        if (el) el.className = 'badge' + (x === f ? ' teal' : '');
      });
      renderTasks();
    }

    function renderTasks() {
      const list = document.getElementById('tasks-list');
      const stats = document.getElementById('tasks-stats');
      if (!list) return;
      const mine = 'Анна Петрова';
      let items = TASKS.slice();
      if (taskFilter === 'mine') items = items.filter(t => t.assignee === mine && !t.done);
      else if (taskFilter === 'overdue') items = items.filter(t => t.overdue && !t.done);
      else if (taskFilter === 'done') items = items.filter(t => t.done);
      else items = items.filter(t => !t.done).concat(items.filter(t => t.done));

      const open = TASKS.filter(t => !t.done).length;
      const od = TASKS.filter(t => t.overdue && !t.done).length;
      const my = TASKS.filter(t => t.assignee === mine && !t.done).length;
      const done = TASKS.filter(t => t.done).length;
      if (stats) {
        stats.innerHTML = `
          <div class="tasks-stat"><div class="n">${open}</div><div class="l">Открытых</div></div>
          <div class="tasks-stat"><div class="n" style="color:#e11d48">${od}</div><div class="l">Просрочено</div></div>
          <div class="tasks-stat"><div class="n">${my}</div><div class="l">Мои</div></div>
          <div class="tasks-stat"><div class="n" style="color:#0d9488">${done}</div><div class="l">Выполнено</div></div>`;
      }

      list.innerHTML = items.map(t => `
        <div class="task-card ${t.done ? 'done' : ''} ${t.overdue && !t.done ? 'overdue' : ''}">
          <div class="task-check ${t.done ? 'on' : ''}" onclick="event.stopPropagation(); toggleTask('${t.id}')">${t.done ? '✓' : ''}</div>
          <div class="task-body" onclick="openTaskPatient('${t.patientId}')">
            <div class="task-title">${escapeHtml(String(t.title || ""))}</div>
            <div class="task-meta">
              <span>👤 ${escapeHtml(String(t.patient || ""))}</span>
              <span>👷 ${escapeHtml(String(t.assignee || ""))}</span>
              <span>🏷 ${escapeHtml(String(t.source || ""))}</span>
            </div>
          </div>
          <div class="task-right">
            <div class="badge ${t.overdue && !t.done ? 'rose' : ''}">${escapeHtml(String(t.due || ""))}</div>
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

    function addDemoTask() {
      const id = 't' + Date.now();
      TASKS.unshift({
        id, title: 'Новая задача администратора',
        patientId: currentPatientId, patient: (DB.patients[currentPatientId] || {}).name || '—',
        assignee: 'Анна Петрова', due: 'сегодня 19:00', overdue: false, done: false, source: 'Вручную'
      });
      taskFilter = 'all';
      filterTasks('all');
      toast('✓ Задача создана');
    }


    // Notification panel is retained independently of the removed demo pages.
    let NOTIFS = [];

    function renderNotifBadge() {
      const b = document.getElementById('notif-badge');
      if (!b) return;
      const n = NOTIFS.filter(x => !x.read).length;
      b.style.display = n ? 'flex' : 'none';
      b.textContent = n > 9 ? '9+' : String(n);
    }

    function renderNotifList() {
      const el = document.getElementById('notif-list');
      if (!el) return;
      if (!NOTIFS.length) {
        el.innerHTML = '<div style="padding:20px;text-align:center;color:#94a3b8;font-size:13px">Пока нет уведомлений</div>';
        return;
      }
      el.innerHTML = NOTIFS.map(n => `
        <div class="notif-item" onclick="openNotif('${n.id}')">
          <div class="n-title">${n.title}</div>
          <div class="n-body">${n.body}</div>
          <div class="n-time">${n.time}</div>
        </div>`).join('');
    }

    function toggleNotifPanel(e) {
      if (e) e.stopPropagation();
      const p = document.getElementById('notif-panel');
      if (!p) return;
      p.classList.toggle('open');
      if (p.classList.contains('open')) {
        NOTIFS.forEach(n => n.read = true);
        renderNotifBadge();
      }
    }

    function clearNotifs() {
      NOTIFS = [];
      renderNotifBadge();
      renderNotifList();
    }

    function openNotif(id) {
      const n = NOTIFS.find(x => x.id === id);
      if (n && n.patientId && DB.patients[n.patientId]) {
        showView('comms');
        selectPatient(n.patientId);
      }
      document.getElementById('notif-panel')?.classList.remove('open');
    }

    document.addEventListener('click', () => {
      document.getElementById('notif-panel')?.classList.remove('open');
    });

    function onStageChanged(patientId, oldStage, newStage) {
      const p = DB.patients[patientId];
      if (typeof TASKS !== 'undefined' && p) {
        TASKS.unshift({
          id: 't_auto_' + Date.now(),
          title: 'Проверить этап: ' + (STAGES.find(s => s.num === newStage) || {}).label,
          patientId, patient: p.name,
          assignee: p.admin || 'Анна Петрова',
          due: 'сегодня', overdue: false, done: false, source: 'Смена этапа · демо'
        });
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

    loadDB();
    renderInbox();
    renderPatient(currentPatientId, false);
