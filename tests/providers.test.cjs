'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readConfig} = require('../src/config');
const {createAI} = require('../src/integrations/ai');
const {createExternalClient} = require('../src/integrations/http-client');
const {aiFailureReason} = require('../src/workflow/triage');
const decision = {action:'reply',reply:'Здравствуйте!',reason:'',summary:''};
const ok = data => ({ok:true,status:200,json:async()=>data});

test('OpenAI-совместимый API: адрес, авторизация, формат',async()=>{
  const calls=[]; const fetch = async (url,opt) => {calls.push({url,opt,body:JSON.parse(opt.body)});return ok({choices:[{message:{content: calls.length === 1 ? JSON.stringify(decision) : 'Черновик'}}]});};
  const config=readConfig({AI_PROVIDER:'openai',OPENAI_API_KEY:'test-key',OPENAI_MODEL:'vendor/model-1',OPENAI_BASE_URL:'https://example.test/v1/'});
  const ai=createAI(config,createExternalClient(fetch),fetch);
  assert.equal(ai.configError,''); assert.deepEqual(await ai.decide('Здравствуйте'),decision);
  assert.equal(calls[0].url,'https://example.test/v1/chat/completions');assert.equal(calls[0].opt.headers.Authorization,'Bearer test-key');
  assert.equal(calls[0].body.model,'vendor/model-1');assert.equal(calls[0].body.messages[0].role,'system');assert.match(calls[0].body.messages[0].content,/нет проверенного прайса/);
});

test('GigaChat: OAuth, повторное использование и обновление токена после 401',async()=>{
  const calls=[]; let oauth=0, failNext=false;
  const fetch=async(url,opt)=>{
    calls.push({url,opt});
    if(url.includes('/oauth')) {oauth++;return ok({access_token:'token'+oauth,expires_at:Date.now()+1800000});}
    if(failNext){failNext=false;return {ok:false,status:401,json:async()=>({secret:'do not expose'})};}
    return ok({choices:[{message:{content:JSON.stringify(decision)}}]});
  };
  const config=readConfig({AI_PROVIDER:'gigachat',GIGACHAT_AUTH_KEY:'test-auth',GIGACHAT_SCOPE:'GIGACHAT_API_B2B'});
  const ai=createAI(config,createExternalClient(fetch),fetch);
  assert.equal(ai.configError,'');assert.deepEqual(await ai.decide('Привет'),decision);await ai.decide('Здравствуйте');assert.equal(oauth,1);
  assert.equal(calls[0].url,'https://ngw.devices.sberbank.ru:9443/api/v2/oauth');assert.equal(calls[0].opt.headers.Authorization,'Basic test-auth');
  assert.equal(calls[0].opt.body,'scope=GIGACHAT_API_B2B');assert.match(calls[0].opt.headers.RqUID,/^[0-9a-f-]{36}$/);
  assert.equal(calls[1].url,'https://api.giga.chat/v1/chat/completions');assert.equal(calls[1].opt.headers.Authorization,'Bearer token1');assert.match(JSON.parse(calls[1].opt.body).messages[0].content,/нет проверенного прайса/);
  failNext=true;await assert.rejects(ai.decide('Привет'),{status:401});await ai.decide('Привет');assert.equal(oauth,2);
});

test('GigaChat: корректный пересчёт seconds и отказ от протухшего токена',async()=>{
  let expiry=Math.floor(Date.now()/1000)+1800;
  const fetch=async(url)=>url.includes('/oauth')?ok({access_token:'test',expires_at:expiry}):ok({choices:[{message:{content:JSON.stringify(decision)}}]});
  let ai=createAI(readConfig({AI_PROVIDER:'gigachat',GIGACHAT_AUTH_KEY:'key'}),createExternalClient(fetch),fetch);
  assert.deepEqual(await ai.decide('hi'),decision);
  expiry=0;ai=createAI(readConfig({AI_PROVIDER:'gigachat',GIGACHAT_AUTH_KEY:'key'}),createExternalClient(fetch),fetch);
  await assert.rejects(ai.decide('hi'),{message:'invalid_response'});
});

test('Неподдерживаемый провайдер и неправильные настройки не дают незаметно переключиться на Gemini',async()=>{
  const never=()=>{throw Error('network must not be called');};
  for(const env of [{AI_PROVIDER:'unknown',GEMINI_API_KEY:'key'},{AI_PROVIDER:'openai',OPENAI_API_KEY:'x',OPENAI_MODEL:'model',OPENAI_BASE_URL:'http://example.test/v1'},{AI_PROVIDER:'gigachat',GIGACHAT_AUTH_KEY:'x',GIGACHAT_SCOPE:'invalid'}]) {
    const ai=createAI(readConfig(env),never,never);assert.ok(ai.configError);await assert.rejects(ai.decide('hi'));
  }
});

test('Ошибки и некорректный JSON передаются без утечки ключей и тела ответа',async()=>{
  const fetch=async()=>ok({choices:[{message:{content:'not JSON and private'}}]});
  const ai=createAI(readConfig({AI_PROVIDER:'openai',OPENAI_API_KEY:'secret',OPENAI_MODEL:'model'}),createExternalClient(fetch),fetch);
  await assert.rejects(ai.decide('hi'),SyntaxError);
  assert.doesNotMatch(aiFailureReason(new SyntaxError('secret or patient'),'openai'),/secret|patient/);
  assert.match(aiFailureReason({status:429},'gigachat'),/GigaChat/);
});

test('Gemini, GigaChat и OpenAI получают неизменяемые правила и подтверждённые настройки клиники',async()=>{
 const base=require('../src/workflow/ai-settings').DEFAULTS,clinic=structuredClone(base);clinic.style='formal';clinic.facts={name:'Клиника Пример',address:'Москва, улица Примерная, 1',phone:'+7 900 000-00-00',hours:'Пн–пт 09:00–18:00'};clinic.factsConfirmed=true;
 for(const provider of ['gemini','gigachat','openai']){
  const prompts=[];const fetch=async(url,opt)=>{
   if(url.includes('/oauth'))return ok({access_token:'token',expires_at:Date.now()+1800000});
   const b=JSON.parse(opt.body);prompts.push(provider==='gemini'?b.systemInstruction.parts[0].text:b.messages[0].content);
   return provider==='gemini'?ok({candidates:[{content:{parts:[{text:JSON.stringify(decision)}]}}]}):ok({choices:[{message:{content:JSON.stringify(decision)}}]});
  };
  const config=readConfig({AI_PROVIDER:provider,GEMINI_API_KEY:'fake',GIGACHAT_AUTH_KEY:'fake',OPENAI_API_KEY:'fake',OPENAI_MODEL:'test',OPENAI_BASE_URL:'https://example.test/v1'});const ai=createAI(config,createExternalClient(fetch),fetch);
  await ai.decide('Здравствуйте',{clinic});assert.match(prompts[0],/Не ставь диагноз/);assert.match(prompts[0],/не подтверждай/);assert.match(prompts[0],/Клиника Пример/);assert.match(prompts[0],/официально/);
 }
});
