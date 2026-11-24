/* Путь администратора — локальная демонстрация, не медицинская система. */
(() => {
  const taskKey = 'cliniccrm_journey_tasks_v1';
  const names = {
    new: 'Новое', awaiting_staff: 'Ожидает сотрудника', in_progress: 'В работе сотрудника',
    booking_pending: 'Запись согласуется', booked: 'Записан · вручную, демо',
    visited: 'Визит отмечен', no_show: 'Неявка / перенос', completed: 'Завершено'
  };
  let data;
  try { data = JSON.parse(localStorage.getItem(taskKey)); } catch (_) {}
  if (Array.isArray(data)) TASKS = data;
  const persistTasks = () => { try { localStorage.setItem(taskKey, JSON.stringify(TASKS)); } catch (_) { toast('Не удалось сохранить задачи в браузере'); } };
  const oldToggleTask = toggleTask;
  toggleTask = function(id) { oldToggleTask(id); persistTasks(); };
  const oldAddDemoTask = addDemoTask;
  addDemoTask = function() { oldAddDemoTask(); persistTasks(); };
  const oldStageChanged = onStageChanged;
  onStageChanged = function(...args) { oldStageChanged(...args); persistTasks(); };

  const safe = value => escapeHtml(String(value ?? ''));
  const getPatient = () => DB.patients[currentPatientId];
  function journey(p) {
    if (!Array.isArray(p.journeys)) p.journeys = [];
    if (!p.journeys.length) p.journeys.push({id: 'case_' + Date.now() + '_' + Math.random().toString(36).slice(2,7), status:'new', createdAt:new Date().toISOString()});
    return p.journeys[p.journeys.length - 1];
  }
  function datetime(value) {
    if (!value) return 'не указано';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'не указано' : date.toLocaleString('ru-RU', {day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit'});
  }
  function addEvent(title, text) {
    const p = getPatient();
    if (!p) return;
    p.history.unshift({type:'system', icon:'◌', title, date:nowLabel(), body:'<div style="white-space:pre-wrap">' + safe(text) + '</div>'});
    saveDB();
  }
  function createTask(p, title, source, dueDate, caseId) {
    const id = 't_j_' + Date.now() + '_' + Math.random().toString(36).slice(2,7);
    TASKS.unshift({id, title, patientId:p.id, patient:p.name, assignee:p.admin && p.admin !== '—' ? p.admin : 'Анна Петрова', due:dueDate ? datetime(dueDate) : 'без срока', dueAt:dueDate || null, overdue:!!(dueDate && new Date(dueDate).getTime() < Date.now()), done:false, source, caseId});
    persistTasks();
    return id;
  }
  const oldRenderTasks = renderTasks;
  renderTasks = function() {
    TASKS.forEach(t => { if (t.dueAt && !t.done) t.overdue = new Date(t.dueAt).getTime() < Date.now(); });
    oldRenderTasks();
  };
  // Existing template was rendering user-provided task fields as HTML. Display text safely.
  const oldRenderInbox = renderInbox;
  renderInbox = function() {
    const list = document.getElementById('inbox-list');
    list.innerHTML = '';
    DB.inboxOrder.forEach(id => {
      const p = DB.patients[id]; if (!p) return;
      const el = document.createElement('div');
      el.className = 'sidebar-item px-4 py-3.5' + (id === currentPatientId ? ' active' : '');
      el.onclick = () => selectPatient(id);
      const title = p.channelIcon === '📞' ? p.phone : p.name;
      el.innerHTML = `<div class="sidebar-item-row"><div class="ch-icon">${safe(p.channelIcon)}</div><div class="ch-body"><div class="ch-top"><span class="ch-name">${safe(title)}</span>${p.unread ? `<span class="unread">${safe(p.unread)}</span>` : `<span class="ch-time">${safe(p.timeLabel)}</span>`}</div><div class="ch-preview">${safe(p.preview)}</div></div></div>`;
      list.appendChild(el);
    });
    updateInboxCount();
  };
  function btn(label, fn, primary = false) { return `<button type="button" ${primary ? 'class="ok"' : ''} onclick="${fn}">${label}</button>`; }
  function actions(...items) { return `<div class="modal-actions" style="flex-wrap:wrap;margin-top:10px">${items.join('')}</div>`; }
  function field(label, control) { return `<div class="form-field" style="margin-top:12px"><label>${label}</label>${control}</div>`; }
  function section(title, body) { return `<div class="tpl-item" style="margin-top:10px"><div class="t-name">${title}</div><div class="t-body">${body}</div></div>`; }

  window.openJourney = function() {
    const p = getPatient(); if (!p) return;
    const j = journey(p); saveDB();
    document.getElementById('journey-subtitle').textContent = p.name + ' · демо, без связи с МИС и каналами';
    let html = section('Текущее обращение',
      `<b>Статус:</b> ${safe(names[j.status] || 'Новое')}<br><b>Источник:</b> ${safe(p.channelLabel || 'не указан')}<br><b>Контекст:</b> ${safe(p.preview || 'не указан')}<br><b>Ответственный:</b> ${safe(j.assignee || p.admin || 'не назначен')}` +
      (j.reason ? `<br><b>Причина передачи:</b> ${safe(j.reason)}` : '') +
      (j.appointment ? `<br><b>Время:</b> ${safe(datetime(j.appointment))} · введено вручную` : '') +
      (j.confirmation ? `<br><b>Подтверждение:</b> отметка сотрудника в демо; подключение к МИС не проверялось` : '') +
      (j.outcome ? `<br><b>Результат:</b> ${safe(j.outcome)}` : ''));
    if (j.status === 'new') {
      html += section('1. Передача администратору', 'Причина и текущий контекст сохраняются в истории. ИИ в этой версии не подключён.' +
        field('Причина передачи', `<select id="journey-reason"><option>Необходима помощь сотрудника</option><option>Пациент просит человека</option><option>ИИ не уверен в ответе</option><option>Стоимость или условия оплаты</option><option>Несовершеннолетний / представитель</option><option>Медицинский вопрос — передать специалисту</option><option>Жалоба или нестандартная ситуация</option><option>Ошибка или недоступность МИС</option></select>`) + actions(btn('Передать сотруднику', 'journeyHandoff()', true)));
      html += actions(btn('Взять сразу в работу', 'journeyAccept()'));
    }
    if (j.status === 'awaiting_staff') {
      html += section('2. Принять обращение', 'Проверьте контекст и исходную переписку. Медицинские вопросы передаются специалисту по правилам клиники.' + actions(btn('Взять в работу', 'journeyAccept()', true)));
    }
    if (['in_progress','booking_pending','no_show'].includes(j.status)) {
      html += section('3. Согласовать запись', 'Время вводится вручную. Это не создаёт запись в МИС и не отправляет сообщение пациенту.' +
        field('Предполагаемые дата и время', `<input id="journey-date" type="datetime-local" value="${safe(j.appointment || '')}">`) +
        actions(btn('Сохранить согласуемое время', 'journeyPropose()', true)));
      if (j.status === 'booking_pending') html += section('4. Проверить запись', 'Сначала внесите и проверьте запись в МИС вручную. В демо нет технической проверки.' +
        '<label class="form-check" style="padding-top:8px"><input id="journey-checked" type="checkbox"> Я проверил(а) запись в МИС вручную</label>' +
        actions(btn('Отметить проверку в демо', 'journeyConfirm()', true)));
      html += section('Передача вопроса', 'Медицинские и другие вопросы вне полномочий передаются ответственному сотруднику.' + field('Кому передать', '<select id="journey-transfer"><option>Медицинскому специалисту</option><option>Ответственному за финансы</option><option>Руководителю</option></select>') + actions(btn('Создать задачу на передачу', 'journeyTransfer()')));
      html += section('Другой результат', 'Можно закрыть обращение без записи или передать вопрос ответственному.' +
        field('Результат', '<select id="journey-outcome"><option value="Вопрос решён без записи">Вопрос решён без записи</option><option value="Пациент отказался">Пациент отказался</option><option value="Связаться не удалось">Связаться не удалось</option><option value="Передано ответственному сотруднику">Передано ответственному сотруднику</option></select>') +
        actions(btn('Завершить обращение', 'journeyFinish()')));
    }
    if (j.status === 'booked') {
      html += section('5. Напоминание', 'Создаётся задача сотруднику на 24 часа до визита. Автоматической отправки или голосового звонка нет.' +
        (j.reminderTaskId ? '<br><b>Задача уже создана.</b>' : actions(btn('Создать задачу-напоминание', 'journeyReminder()', true))));
      html += section('6. Результат визита', 'После проверки в МИС сотрудник отмечает результат вручную в демонстрационном сценарии.' +
        actions(btn('Визит состоялся', "journeyVisit('visited')", true), btn('Неявка / перенос', "journeyVisit('no_show')")));
    }
    if (j.status === 'visited') {
      html += section('7. Последующее действие', 'При необходимости создайте задачу. Её содержание не является медицинским назначением.' +
        field('Текст задачи', '<input id="journey-followup" type="text" maxlength="160" placeholder="Например: согласовать следующий визит">') +
        actions(btn('Создать задачу', 'journeyFollowup()', true), btn('Завершить обращение', 'journeyFinishVisited()')));
    }
    if (j.status === 'completed') html += section('Обращение завершено', 'История и задачи сохранены в этом браузере. Новое обращение не заменяет предыдущее.' + actions(btn('Создать новое обращение', 'journeyNew()', true)));
    document.getElementById('journey-content').innerHTML = html;
    document.getElementById('journey-modal').classList.add('open');
  };
  window.closeJourney = () => document.getElementById('journey-modal').classList.remove('open');
  function refresh() { renderPatient(currentPatientId, false); openJourney(); }
  window.journeyHandoff = function() {
    const p = getPatient(), j = journey(p); if (j.status !== 'new') return;
    j.reason = document.getElementById('journey-reason').value;
    j.status = 'awaiting_staff';
    createTask(p, 'Принять обращение: ' + j.reason, 'Передача сотруднику', null, j.id);
    addEvent('Передача сотруднику · демо', 'Причина: ' + j.reason + '. Контекст: ' + (p.preview || 'не указан'));
    refresh(); toast('Обращение передано в очередь · демо');
  };
  window.journeyAccept = function() {
    const p = getPatient(), j = journey(p); if (!['new','awaiting_staff'].includes(j.status)) return;
    j.status = 'in_progress'; j.assignee = 'Анна Петрова'; p.admin = j.assignee;
    TASKS.filter(t => t.caseId === j.id && t.source === 'Передача сотруднику').forEach(t => t.done = true);
    persistTasks(); addEvent('Обращение принято', 'Ответственный: ' + j.assignee + '. Демо: пациенту сообщение не отправлено.');
    refresh(); toast('Обращение в работе');
  };
  window.journeyPropose = function() {
    const p = getPatient(), j = journey(p); if (!['in_progress','booking_pending','no_show'].includes(j.status)) return;
    const value = document.getElementById('journey-date').value, date = new Date(value);
    if (!value || Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) { toast('Выберите будущие дату и время'); return; }
    j.appointment = value; j.confirmation = false; j.reminderTaskId = null; j.status = 'booking_pending';
    addEvent('Время согласуется · демо', datetime(value) + '. Запись в МИС не создана.');
    refresh(); toast('Время сохранено без записи в МИС');
  };
  window.journeyConfirm = function() {
    const p = getPatient(), j = journey(p); if (j.status !== 'booking_pending' || !j.appointment) return;
    if (!document.getElementById('journey-checked').checked) { toast('Сначала отметьте ручную проверку в МИС'); return; }
    if (new Date(j.appointment).getTime() <= Date.now()) { toast('Время прошло — выберите другое'); return; }
    j.status = 'booked'; j.confirmation = true;
    addEvent('Запись отмечена сотрудником · демо', datetime(j.appointment) + '. Отметка введена вручную; реального соединения с МИС нет.');
    refresh(); toast('Ручная отметка сохранена · демо');
  };
  window.journeyReminder = function() {
    const p = getPatient(), j = journey(p); if (j.status !== 'booked' || !j.appointment || j.reminderTaskId) return;
    const when = new Date(new Date(j.appointment).getTime() - 24*60*60*1000).toISOString();
    j.reminderTaskId = createTask(p, 'Подтвердить визит ' + datetime(j.appointment), 'Напоминание · вручную', when, j.id);
    addEvent('Задача на подтверждение', 'Срок: ' + datetime(when) + ' (за 24 часа). Сообщение не отправлено.');
    refresh(); toast('Задача создана в списке задач');
  };
  window.journeyVisit = function(status) {
    const p = getPatient(), j = journey(p); if (j.status !== 'booked' || !['visited','no_show'].includes(status)) return;
    if (!window.confirm('Отметить результат вручную? В демо нет проверки по МИС.')) return;
    j.status = status;
    TASKS.filter(t => t.id === j.reminderTaskId && !t.done).forEach(t => { t.done = true; }); persistTasks();
    if (status === 'no_show') createTask(p, 'Уточнить перенос или причину неявки', 'После визита', null, j.id);
    addEvent('Результат визита · демо', status === 'visited' ? 'Визит отмечен сотрудником. Проверка по МИС не выполнялась.' : 'Неявка или перенос отмечены сотрудником. Создана задача на уточнение.');
    refresh(); toast('Результат сохранён');
  };
  window.journeyFollowup = function() {
    const p = getPatient(), j = journey(p); if (j.status !== 'visited') return;
    const title = document.getElementById('journey-followup').value.trim(); if (!title) { toast('Укажите текст задачи'); return; }
    createTask(p, title, 'После визита', null, j.id); addEvent('Последующая задача', title); refresh(); toast('Задача создана');
  };
  window.journeyTransfer = function() {
    const p = getPatient(), j = journey(p); if (!['in_progress','booking_pending','no_show'].includes(j.status)) return;
    const target = document.getElementById('journey-transfer').value;
    createTask(p, 'Передать вопрос: ' + target, 'Передача вопроса', null, j.id);
    addEvent('Передача вопроса · задача', target + '. Передача создаёт только локальную задачу; уведомление не отправлено.');
    refresh(); toast('Задача на передачу создана · демо');
  };
  window.journeyFinish = function() {
    const p = getPatient(), j = journey(p); if (!['in_progress','booking_pending','no_show'].includes(j.status)) return;
    j.outcome = document.getElementById('journey-outcome').value; j.status = 'completed';
    addEvent('Обращение завершено', j.outcome); refresh(); toast('Обращение завершено');
  };
  window.journeyFinishVisited = function() {
    const p = getPatient(), j = journey(p); if (j.status !== 'visited') return;
    j.outcome = 'Визит отмечен, обращение завершено'; j.status = 'completed';
    addEvent('Обращение завершено', j.outcome); refresh(); toast('Обращение завершено');
  };
  window.journeyNew = function() {
    const p = getPatient(), j = journey(p); if (j.status !== 'completed') return;
    p.journeys.push({id:'case_' + Date.now() + '_' + Math.random().toString(36).slice(2,7),status:'new',createdAt:new Date().toISOString()});
    addEvent('Новое обращение', 'Отдельное обращение связано с существующим профилем пациента.'); refresh();
  };
  // Replace misleading pre-existing demonstration actions without changing the visual language.
  actionBookMIS = openJourney;
  actionReminder = function() { const p = getPatient(), j = journey(p); if (j.status === 'booked') journeyReminder(); else { openJourney(); toast('Сначала отметьте подтверждённое время'); } };
  demoEscalation = openJourney;
  renderAIRec = function(p) {
    const j = journey(p);
    document.getElementById('ai-rec-title').textContent = 'Путь обращения · ' + (names[j.status] || 'Новое');
    document.getElementById('ai-rec-body').textContent = 'Демо-подсказка: проверьте контекст, ответственного и следующий шаг. Реальный ИИ и МИС не подключены.';
    document.getElementById('ai-rec-actions').innerHTML = '<button type="button" class="confirm" onclick="openJourney()">Открыть путь обращения</button>';
    document.getElementById('esc-banner').classList.remove('show');
  };
  sendMessage = function() {
    const input = document.getElementById('msg-input'), p = getPatient(); if (!p || !input || !input.value.trim()) return;
    const text = input.value.trim(); input.value = ''; p.preview = 'Демо: ' + text.slice(0,40); p.unread = 0;
    addEvent('Сообщение · демо, не отправлено', text); renderPatient(currentPatientId,false); toast('Сохранено локально · сообщение не отправлено');
  };
  actionTemplate = function(key) {
    const t = TEMPLATES[key]; if (!t) return;
    const input = document.getElementById('msg-input'); input.value = t.text; input.focus();
    toast('Шаблон добавлен в черновик · не отправлен');
  };
  actionPlan = function() { toast('План лечения в демо недоступен; проверьте данные в МИС'); };
  useTemplate = function(id) {
    const t = MSG_TEMPLATES.find(x => x.id === id); if (!t) return;
    showView('comms'); showPatientHistory();
    const input = document.getElementById('msg-input'); input.value = t.body; input.focus(); toast('Черновик · сообщение не отправлено');
  };
  // Unknown age is not automatically an adult.
  const oldProfile = renderProfileCard;
  renderProfileCard = function(p) {
    oldProfile(p);
    if (!p.age || !/\d+/.test(p.age)) {
      const tag = document.querySelector('#pr-tags .tag'); if (tag) tag.textContent = 'Возраст не указан';
    }
    const j = journey(p);
    document.getElementById('pr-process-status').textContent = names[j.status] || 'Новое';
  };
  renderPatient(currentPatientId, false);
})();
