'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {trigger,aiFailureReason}=require('../src/workflow/triage');
const {createAI}=require('../src/integrations/ai');
const {createExternalClient}=require('../src/integrations/http-client');
const {readConfig}=require('../src/config');

test('Маршрутизация: обычное приветствие и триггеры для сотрудника',()=>{
  assert.equal(trigger('Здравствуйте!'),null);
  assert.equal(trigger('Хочу записаться на приём'),null);assert.equal(trigger('Сколько стоит чистка?'),null);
  for (const [message,reason] of [
    ['Позовите администратора',/сотрудника/], ['У меня жалоба',/Жалоба/],
    ['Хочу кредит',/Финансовые/], ['Мне 16 лет',/Несовершеннолетний/],
    ['Болит зуб',/Медицинский/], ['Перенести запись',/Изменение/]
  ]) assert.match(trigger(message),reason,message);
});

test('Gemini 3.8 использует 60-секундный тайм-аут и минимальный поддерживаемый уровень размышления',async()=>{
  let request;const external=async(url,payload,headers,timeout)=>{request={url,payload,headers,timeout};return {candidates:[{finishReason:'STOP',content:{parts:[{text:'скрытые мысли',thought:true},{text:JSON.stringify({action:'reply',reply:'Здравствуйте!',reason:'',summary:''})}]}}]};};
  const ai=createAI(readConfig({GEMINI_API_KEY:'test',GEMINI_MODEL:'gemini-3.8-flash'}),external,()=>{});
  assert.equal((await ai.decide('Привет')).reply,'Здравствуйте!');
  assert.equal(request.timeout,60000);assert.equal(request.payload.generationConfig.thinkingConfig.thinkingLevel,'low');assert.equal(request.payload.generationConfig.maxOutputTokens,2048);
});

test('Другие модели Gemini не получают параметр уровня размышления 3.8',async()=>{
  let payload;const external=async(_url,body)=>{payload=body;return {candidates:[{content:{parts:[{text:JSON.stringify({action:'reply',reply:'Тестовый ответ',reason:'',summary:''})}]}}]};};
  const ai=createAI(readConfig({GEMINI_API_KEY:'test',GEMINI_MODEL:'gemini-2.5-flash',AI_TIMEOUT_MS:'90000'}),external,()=>{});
  assert.equal((await ai.decide('Привет')).reply,'Тестовый ответ');assert.equal(payload.generationConfig.thinkingConfig,undefined);
  assert.equal(readConfig({AI_TIMEOUT_MS:'90000'}).aiTimeoutMs,90000);assert.equal(readConfig({AI_TIMEOUT_MS:'999999'}).aiTimeoutMs,60000);
});

test('Прерванный или усечённый ответ не отправляется, диагностируется без текста',async()=>{
  const truncated=async()=>({candidates:[{finishReason:'MAX_TOKENS',content:{parts:[{text:'private'}]}}]});
  const ai=createAI(readConfig({GEMINI_API_KEY:'test'}),truncated,()=>{});
  await assert.rejects(ai.decide('test'),{message:'invalid_response'});
  const aborted=new DOMException('sensitive','TimeoutError');
  const external=createExternalClient(async()=>({ok:true,json:async()=>{throw aborted;}}));
  await assert.rejects(external('https://example.test',{}, {}, 60000),{name:'TimeoutError'});
  assert.match(aiFailureReason(aborted),/время ожидания/);assert.doesNotMatch(aiFailureReason(aborted),/sensitive/);
});
