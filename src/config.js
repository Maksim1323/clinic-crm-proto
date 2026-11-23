'use strict';

// Configuration is read only from the environment; do not put secrets in Git.
function readConfig(env, dataFile) {
  return {
    file: dataFile || env.DATA_FILE || '/tmp/clinic-crm-demo.json',
    admin: env.ADMIN_TOKEN || '',
    tg: env.TELEGRAM_BOT_TOKEN || '',
    hookSecret: env.TELEGRAM_WEBHOOK_SECRET || '',
    gemini: env.GEMINI_API_KEY || '',
    model: env.GEMINI_MODEL || 'gemini-2.5-flash',
    baseUrl: (env.PUBLIC_BASE_URL || env.RENDER_EXTERNAL_URL || '').replace(/\/$/, ''),
    autoEnabled: env.AI_AUTO_REPLY === 'true'
  };
}
module.exports = { readConfig };
