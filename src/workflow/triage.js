'use strict';
// Preliminary routing rules; not a clinical safety mechanism.
  function initial(c) { if (!c.mode) c.mode='ai'; if(!c.handoff)c.handoff=null; return c; }
  function context(c) {
    return c.messages.slice(-12).map(m=>`${m.direction==='in'?'Собеседник':m.author==='ai'?'ИИ':'Администратор'}: ${m.text}`).join('\n').slice(-12000);
  }
  function shortContext(c) {
    const incoming=c.messages.filter(m=>m.direction==='in').slice(-3).map(m=>m.text.slice(0,400));
    return incoming.length ? 'Последние сообщения собеседника: ' + incoming.join(' | ') : 'Сообщений пока нет.';
  }
  function trigger(text) {
    const t=String(text).toLowerCase().replaceAll('ё','е');
    const rules=[
      [/(оператор|администратор|жив(ой|ого|ым) (человек|сотрудник)|человеком|сотрудник(а|ом)?|связать с человеком)/,'Собеседник просит сотрудника'],
      [/(жалоб|претензи|верните деньги|возврат денег|суд|плохое обслуживан)/,'Жалоба или конфликт'],
      [/(рассроч|кредит|займ|заем|стоимост|сколько стоит|сколько будет стоить|цен(а|у|ы|е)|прайс|дорого|оплат|финанс)/,'Стоимость или финансовые условия'],
      [/(ребен|детск|несовершеннолет|подрост|мо(й|его|ему) сын|моя дочь|дочк|опекун|представител|(?:^|\D)(?:1[0-7]|[1-9])\s*(?:лет|года|год)(?:\s|$|[.,!?]))/,'Несовершеннолетний или представитель'],
      [/(болит|болят|боль|кровотеч|отек|отекл|аллерги|симптом|лекарств|таблет|антибиот|диагноз|лечени|противопоказан|беремен|температур|болезн|медицинск(ий|ая|ое) вопрос)/,'Медицинский вопрос — нужен специалист'],
      [/(запис(ан|али|ать|аться)|свободн.*(время|окн)|перенести|отменить запись|расписание|слот)/,'Запись или изменение визита — нужна проверка сотрудника']
    ];
    for (const [pattern,reason] of rules) if(pattern.test(t))return reason;
    return null;
  }
  // Guards are conservative and do not replace clinical validation.
  function riskyOutput(text) {
    return /(диагноз|принимайте|вам необходимо лечить|принимат[ья] препарат|антибиотик|дозировк|у вас (кариес|воспаление)|вы записан|мы записали|ваш прием подтвержден|гарантир|стоимость составит)/i.test(text);
  }

// Do not include provider response bodies or request headers: they can contain secrets or personal data.
function aiFailureReason(error, provider = 'gemini') {
  const name = {gemini:'Gemini', gigachat:'GigaChat', openai:'OpenAI-совместимого API'}[provider] || 'ИИ';
  // Node fetch wraps TLS/network errors in TypeError.cause. Only classify a fixed allowlist;
  // never expose arbitrary upstream messages, URLs, headers or response bodies.
  const codes = new Set();
  for (let cause=error, depth=0; cause && depth<4; cause=cause.cause, depth++) {
    if (typeof cause.code === 'string') codes.add(cause.code);
  }
  if (['SELF_SIGNED_CERT_IN_CHAIN','DEPTH_ZERO_SELF_SIGNED_CERT','UNABLE_TO_GET_ISSUER_CERT_LOCALLY','UNABLE_TO_VERIFY_LEAF_SIGNATURE','CERT_HAS_EXPIRED','ERR_TLS_CERT_ALTNAME_INVALID'].some(code=>codes.has(code))) {
    return provider === 'gigachat'
      ? 'ИИ не ответил: ошибка проверки TLS-сертификата GigaChat. Проверьте сертификат НУЦ Минцифры на сервере.'
      : `ИИ не ответил: ошибка проверки TLS-сертификата ${name}.`;
  }
  if (['ENOTFOUND','EAI_AGAIN'].some(code=>codes.has(code))) return `ИИ не ответил: сервер не смог определить адрес ${name} (DNS).`;
  if (['ECONNREFUSED','ECONNRESET','ENETUNREACH','EHOSTUNREACH'].some(code=>codes.has(code))) return `ИИ не ответил: соединение с ${name} недоступно или прервано.`;
  if (['ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT'].some(code=>codes.has(code))) return `ИИ не ответил: истекло время ожидания ${name}.`;
  const descriptions = {
    400: 'неверный запрос или настройки модели',
    401: `ключ ${name} отклонён`,
    403: `доступ к ${name} запрещён; проверьте ключ, проект и регион`,
    404: `модель ${name} недоступна для этого ключа`,
    429: `исчерпан лимит или квота ${name}`
  };
  if (descriptions[error?.status]) return 'ИИ не ответил: ' + descriptions[error.status] + ' (HTTP ' + error.status + ').';
  if (error?.status >= 500 && error?.status <= 599) return `ИИ не ответил: ошибка сервиса ${name} (HTTP ${error.status}).`;
  if (error instanceof SyntaxError || error?.message === 'invalid_response') return `ИИ не ответил: ${name} вернул пустой или некорректный формат.`;
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return `ИИ не ответил: истекло время ожидания ${name}.`;
  return `ИИ не ответил: ошибка сети, настроек или сервиса ${name}.`;
}
module.exports = {initial, context, shortContext, trigger, riskyOutput, aiFailureReason};
