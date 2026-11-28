'use strict';

// Configuration is read only from the environment; do not put secrets in Git.
function readConfig(env, dataFile) {
  return {
    file: dataFile || env.DATA_FILE || '/tmp/clinic-crm-demo.json',
    databaseUrl: env.DATABASE_URL || '',
    requireDatabase: !!env.RENDER,
    admin: env.ADMIN_TOKEN || '',
    tg: env.TELEGRAM_BOT_TOKEN || '',
    hookSecret: env.TELEGRAM_WEBHOOK_SECRET || '',
    aiProvider: (env.AI_PROVIDER || 'gemini').toLowerCase().trim(),
    aiTimeoutMs: /^(?:[1-9][0-9]*)$/.test(env.AI_TIMEOUT_MS || '') && Number(env.AI_TIMEOUT_MS) >= 10000 && Number(env.AI_TIMEOUT_MS) <= 120000 ? Number(env.AI_TIMEOUT_MS) : 60000,
    gemini: env.GEMINI_API_KEY || '',
    geminiModel: env.GEMINI_MODEL || 'gemini-2.5-flash',
    gigachatKey: env.GIGACHAT_AUTH_KEY || '',
    gigachatScope: env.GIGACHAT_SCOPE || 'GIGACHAT_API_PERS',
    gigachatModel: env.GIGACHAT_MODEL || 'GigaChat',
    openaiKey: env.OPENAI_API_KEY || '',
    openaiModel: env.OPENAI_MODEL || '',
    openaiBaseUrl: env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    baseUrl: (env.PUBLIC_BASE_URL || env.RENDER_EXTERNAL_URL || '').replace(/\/$/, ''),
    autoEnabled: env.AI_AUTO_REPLY === 'true'
  };
}
module.exports = { readConfig };
