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

module.exports = {initial, context, shortContext, trigger, riskyOutput};
