'use strict';
// This CA is trusted only by requests to the two hard-coded GigaChat endpoints.
// Telegram, Gemini and any custom OpenAI-compatible provider use Node's usual trust store.
const fs = require('node:fs');
const path = require('node:path');
const tls = require('node:tls');
const {Agent} = require('undici');

function createGigachatFetch(fetchImpl = global.fetch) {
  const root = fs.readFileSync(path.join(__dirname, '../../certs/russian-trusted-root-ca.pem'), 'utf8');
  const dispatcher = new Agent({connect: {ca: [...tls.rootCertificates, root], rejectUnauthorized: true}});
  const allowed = new Set([
    'https://ngw.devices.sberbank.ru:9443/api/v2/oauth',
    'https://api.giga.chat/v1/chat/completions'
  ]);
  return (url, options = {}) => {
    // Never send authorization headers or our additional trust to an unexpected endpoint.
    if (!allowed.has(String(url))) throw new Error('unsupported_gigachat_endpoint');
    return fetchImpl(url, {...options, dispatcher, redirect:'error'});
  };
}
module.exports = {createGigachatFetch};
