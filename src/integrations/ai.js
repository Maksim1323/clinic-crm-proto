'use strict';
const crypto = require('node:crypto');
const {createGemini, AUTO_PROMPT} = require('./gemini');

// An unknown or incomplete provider must not silently fall back to another service.
function createAI(config, external, callFetch) {
  const provider = config.aiProvider;
  // Longer model requests must not extend the Telegram send timeout.
  const aiExternal = (url, body, headers) => external(url, body, headers, config.aiTimeoutMs);
  const validModel = value => typeof value === 'string' && value.length > 0 && value.length <= 160 && /^[A-Za-z0-9._:/-]+$/.test(value);
  let configError = '';
  if (!['gemini', 'gigachat', 'openai'].includes(provider)) configError = 'Неизвестный AI_PROVIDER: выберите gemini, gigachat или openai.';
  if (provider === 'gemini' && (!config.gemini || !/^[A-Za-z0-9._-]{1,80}$/.test(config.geminiModel))) configError = 'Проверьте GEMINI_API_KEY и GEMINI_MODEL.';
  if (provider === 'gigachat' && (!config.gigachatKey || !validModel(config.gigachatModel) || !['GIGACHAT_API_PERS','GIGACHAT_API_B2B','GIGACHAT_API_CORP'].includes(config.gigachatScope))) configError = 'Проверьте GIGACHAT_AUTH_KEY, GIGACHAT_MODEL и GIGACHAT_SCOPE.';
  if (provider === 'openai') {
    let validUrl = false;
    try { const u = new URL(config.openaiBaseUrl); validUrl = u.protocol === 'https:' && !u.username && !u.password && !u.search && !u.hash; } catch (_) {}
    if (!config.openaiKey || !validModel(config.openaiModel) || !validUrl) configError = 'Проверьте OPENAI_API_KEY, OPENAI_MODEL и HTTPS OPENAI_BASE_URL.';
  }
  if (provider === 'gemini') return {...createGemini(aiExternal, config.geminiModel, config.gemini), configError};
  let token = '', expiry = 0, tokenPromise;
  async function accessToken() {
    if (token && expiry > Date.now() + 60000) return token;
    if (!tokenPromise) tokenPromise = (async () => {
      const response = await callFetch('https://ngw.devices.sberbank.ru:9443/api/v2/oauth', {
        method:'POST', headers:{'content-type':'application/x-www-form-urlencoded', accept:'application/json', RqUID:crypto.randomUUID(), Authorization:'Basic '+config.gigachatKey},
        body:new URLSearchParams({scope:config.gigachatScope}).toString(), signal:AbortSignal.timeout(20000)
      });
      if (!response.ok) throw Object.assign(new Error('upstream_error'), {status:response.status});
      const data = await response.json();
      // Providers document expiry as a Unix timestamp; accept seconds or milliseconds.
      const expiresAt = data.expires_at < 1e12 ? data.expires_at * 1000 : data.expires_at;
      if (typeof data.access_token !== 'string' || !data.access_token || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new Error('invalid_response');
      token = data.access_token; expiry = expiresAt; return token;
    })().finally(() => { tokenPromise = null; });
    return tokenPromise;
  }
  async function generate(prompt, text, maxTokens) {
    if (configError) throw new Error('invalid_configuration');
    const isGiga = provider === 'gigachat';
    const base = isGiga ? 'https://api.giga.chat/v1' : config.openaiBaseUrl.replace(/\/+$/, '');
    const authorization = isGiga ? await accessToken() : config.openaiKey;
    const body = {model:isGiga ? config.gigachatModel : config.openaiModel, messages:[{role:'system', content:prompt},{role:'user', content:text}], max_tokens:maxTokens, stream:false};
    let result;
    try { result = await aiExternal(base + '/chat/completions', body, {Authorization:'Bearer '+authorization}); }
    catch (error) { if (isGiga && error.status === 401) {token = ''; expiry = 0;} throw error; }
    const content = result.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new Error('invalid_response');
    return content.trim();
  }
  async function decide(history) {
    const result = JSON.parse(await generate(AUTO_PROMPT, 'История тестового диалога:\n'+history, 1200));
    if (!result || !['reply','handoff'].includes(result.action) || typeof result.reply !== 'string' || typeof result.reason !== 'string' || typeof result.summary !== 'string') throw new Error('invalid_response');
    return result;
  }
  return {configError, decide};
}
module.exports = {createAI};
