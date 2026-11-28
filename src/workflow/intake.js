'use strict';
// Conservative, test-only scripted intake. It never books appointments or sets prices.
// Free-text recognition is intentionally limited: uncertainty goes to a person.
const price = /(сколько\s+(?:это\s+)?(?:будет\s+)?стоить|сколько\s+(?:стоит|стоят)|стоимост|цен[аыуеу]|прайс|поч[её]м|во сколько обойд[её]тся)/i;
const booking = /(запис(?:ать|аться|ываться|ал(?:ся|ась)?|ываюсь|ь)|запиш(?:ите|и|усь)|хочу\s+на\s+(?:при[её]м|консультаци|осмотр)|свободн.{0,20}(?:время|окн)|расписание|слот)/i;
const service = /(консультаци|осмотр|чистк|гигиен|пломб|имплант|брекет|ортодонт|хирург|терапевт|стоматолог|удален|отбеливан|протез|коронк|диагностик|рентген|лечение|лечить|канал|элайнер|винир)/i;
const time = /(сегодня|завтра|послезавтра|утром|вечером|дн[её]м|будни|выходн|понедельник|вторник|сред[ауые]|четверг|пятниц|суббот|воскресень|январ|феврал|март|апрел|ма[йяе]|июн|июл|август|сентябр|октябр|ноябр|декабр|недел|месяц|\b\d{1,2}[:.]\d{2}\b|\b\d{1,2}\s*(?:час|числа|число)|\b\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?\b)/i;
const refusal = /(не\s*(?:знаю|могу|хочу|уверен|определил)|неважно|не важно|любо[ей]|без разницы|пока не|позже|затрудняюсь|передай|передайте|связаться)/i;
const irrelevant = /^(?:привет|здравствуйте|здравствуй|добрый день|спасибо|хорошо|ок|да|нет|ага|ну|что\??|\?+)\s*[.!?]*$/i;
function hasInformation(text) { const t=text.trim();return t.length>=2 && !irrelevant.test(t); }
function routeIntake(c, text, wording='standard') {
  const t=String(text||'').trim();
  let flow=c.intake;
  if(!flow) {
    const kind=price.test(t) ? 'price' : booking.test(t) ? 'booking' : '';
    if(!kind)return null;
    flow=c.intake={kind,serviceKnown:service.test(t),timeKnown:time.test(t),question:null,turns:0,initialText:t.slice(0,400)};
    if(refusal.test(t))return {handoff:kind==='price'?'Цена: требуется помощь сотрудника':'Запись: требуется помощь сотрудника'};
  } else {
    // A refusal is a valid reason to stop asking and pass the existing context on.
    if(refusal.test(t))return {handoff:flow.kind==='price'?'Цена: требуется помощь сотрудника':'Запись: требуется помощь сотрудника'};
    if(service.test(t))flow.serviceKnown=true;
    if(time.test(t))flow.timeKnown=true;
    if(flow.question==='service' && hasInformation(t) && !time.test(t) && !booking.test(t) && !price.test(t) && !t.includes('?'))flow.serviceKnown=true;
    if(flow.question==='time' && time.test(t))flow.timeKnown=true;
    flow.turns++;
    if(flow.turns>=3 && (!flow.serviceKnown || (flow.kind==='booking' && !flow.timeKnown)))return {handoff:'Не удалось уточнить пожелания — нужен сотрудник'};
  }
  if(!flow.serviceKnown) {
    flow.question='service';
    return {reply:wording==='brief'?(flow.kind==='price'?'Какая услуга вас интересует? Вопрос о стоимости передам сотруднику.':'На какой приём вы хотите записаться?'):(flow.kind==='price'?'Подскажите, пожалуйста, какая услуга вас интересует? Передам вопрос о стоимости сотруднику.':'Подскажите, пожалуйста, на какой приём или услугу вы хотели бы записаться?')};
  }
  if(flow.kind==='booking' && !flow.timeKnown) {
    flow.question='time';
    return {reply:wording==='brief'?'В какой день и время вам удобно? Сотрудник проверит возможность записи.':'В какой день и время вам было бы удобно? Сотрудник проверит расписание и подтвердит возможность записи.'};
  }
  return {handoff:flow.kind==='price'?'Запрос стоимости услуги — ответ сотрудника':'Запись: пожелания собеседника — проверка сотрудника'};
}
module.exports={routeIntake};
