'use strict';
// Test-only extraction, deliberately conservative and unverified. Never infer
// from Telegram display names, medical data, or a model's generated output.
const words = /^[А-ЯЁA-Z][А-ЯЁA-Zа-яёa-z'’-]*(?:[ -][А-ЯЁA-Z][А-ЯЁA-Zа-яёa-z'’-]*){0,2}$/u;
const stop = /^(?:спасибо|пожалуйста|хорошо|здравствуйте|привет|да|нет|запись|чистка|консультация|доктор|вопрос|ответ|помощь|позвоните|хочу|не знаю|не хочу|не могу|мой|моя|меня|мне|а|и|позже|завтра|сегодня|сотрудник|администратор|врач|прием|приём)$/i;
function validName(value, allowLower=false) {
  const text=String(value||'').trim().replace(/\s+/g,' ');
  if(text.length<2 || text.length>100 || !(allowLower ? /^[А-ЯЁA-Zа-яёa-z][А-ЯЁA-Zа-яёa-z'’-]*(?:[ -][А-ЯЁA-Zа-яёa-z][А-ЯЁA-Zа-яёa-z'’-]*){0,2}$/u : words).test(text))return '';
  if(text.split(/[ -]+/).some(w=>stop.test(w)))return '';
  return text;
}
// A short bare response is ambiguous. Recognise only common first names;
// any other name can be supplied explicitly as «меня зовут ...».
const commonNames=new Set(('александр александра алексей анастасия анатолий андрей анна антон артем артём артур валентина валерий валерия варвара вера виктор виктория владимир владислав галина георгий даниил дарья денис дмитрий ева евгений екатерина елена елизавета игорь иван илья инна ирина кирилл константин ксения людмила максим маргарита марина мария матвей михаил надежда наталья никита николай олег ольга павел полина роман светлана семен семён сергей софия станислав степан тамара татьяна тимофей федор фёдор юлия юрий яна anna maria ivan alex john').split(' '));
function bareName(value) {
  const result=validName(value);return result && commonNames.has(result.split(/[ -]+/)[0].toLowerCase()) ? result : '';
}
function validPhone(value) {
  const t=String(value||'').trim().replace(/[.,;!?]+$/,'').trim();
  if(!/^\+?[\d ()-]+$/.test(t) || t.length>32)return '';
  const count=t.replace(/\D/g,'').length;
  return count>=10 && count<=15 ? t : '';
}
function extractPatientInfo(text, askedForContact=false) {
  const input=String(text||'').trim(), out={};
  // Only affirmative first-person statements, not third-person contacts.
  const names=input.match(/(?:^|[\n,;.!?]\s*)(?:меня зовут|мо[её] имя)\s*[:—-]?\s*([^\n,;.!?]+)/iu);
  if(names && !/(?:\bне\b|\bбывшее\b|\bстарое\b)/iu.test(names[0]))out.name=validName(names[1],true);
  const phone=input.match(/(?:^|[\n,;.!?]\s*)(?:мой (?:номер(?: телефона)?|телефон|мобильный)|мой контактный номер|телефон для связи)\s*[:—-]?\s*(\+?[\d ()-]{10,32})/iu);
  if(phone)out.phone=validPhone(phone[1]);
  if(askedForContact) {
    // Bare answers are accepted only shortly after a matching explicit question.
    const askName=askedForContact===true || askedForContact.name;
    const askPhone=askedForContact===true || askedForContact.phone;
    if(askName && !out.name)out.name=bareName(input);
    if(askPhone && !out.phone)out.phone=validPhone(input);
    const pair=input.match(/^([^,;\n]+)[,;]\s*(\+?[\d ()-]{10,32})$/u);
    if(pair){if(askName && !out.name)out.name=bareName(pair[1]);if(askPhone && !out.phone)out.phone=validPhone(pair[2]);}
  }
  if(!out.name)delete out.name;if(!out.phone)delete out.phone;
  return out;
}
function contactQuestion(text) {
  const t=String(text||'');
  if(/не\s+(?:указывайте|указывать|пишите|писать|сообщайте|сообщать|называйте|называть)/i.test(t))return null;
  const name=/(?:как вас зовут|как к вам обращаться|представьтесь|(?:укажите|указать|напишите|написать|скажите|сообщите|сообщить|назовите).{0,16}(?:имя|фио))/i.test(t);
  const phone=/(?:укажите|указать|напишите|написать|скажите|сообщите|сообщить|назовите).{0,30}(?:телефон|номер)/i.test(t);
  return name || phone ? {name,phone,left:2} : null;
}
function applyPatientInfo(c, info, message) {
  const fields=Object.entries(info);if(!fields.length)return false;
  c.patient ||= {name:'',phone:'',admin:'',doctor:''};
  c.patientSources ||= {};
  let changed=false;
  for(const [key,value] of fields) {
    if(!['name','phone'].includes(key) || c.patient[key]===value)continue;
    c.patient[key]=value;
    c.patientSources[key]={source:'telegram',messageId:String(message.id),at:message.at};
    changed=true;
  }
  if(changed)c.patientVersion=(Number.isSafeInteger(c.patientVersion)?c.patientVersion:0)+1;
  return changed;
}
module.exports={extractPatientInfo,applyPatientInfo,contactQuestion};
