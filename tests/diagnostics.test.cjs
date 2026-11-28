'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {aiFailureReason} = require('../src/workflow/triage');

test('Диагностика Gemini показывает статус без исходного ответа и секретов', () => {
  const e = Object.assign(new Error('secret_key_and_patient_data'), {status:429});
  const result = aiFailureReason(e);
  assert.match(result, /квот/);
  assert.match(result, /429/);
  assert.ok(!result.includes('secret_key_and_patient_data'));
  assert.match(aiFailureReason(new SyntaxError('private')), /формат/);
  assert.match(aiFailureReason({status:403}), /доступ/i);
});

test('Ошибки TLS, сети и тайм-ауты классифицируются без раскрытия причин', () => {
  for (const code of ['SELF_SIGNED_CERT_IN_CHAIN','UNABLE_TO_GET_ISSUER_CERT_LOCALLY','CERT_HAS_EXPIRED']) {
    const reason = aiFailureReason({cause:{code,message:'authorization key and dialogue'}},'gigachat');
    assert.match(reason,/TLS-сертификата GigaChat/);assert.doesNotMatch(reason,/authorization key|dialogue/);
  }
  assert.match(aiFailureReason({cause:{code:'ENOTFOUND'}},'gigachat'),/DNS/);
  assert.match(aiFailureReason({cause:{code:'ECONNREFUSED'}},'gigachat'),/соединение/i);
  assert.match(aiFailureReason({cause:{code:'UND_ERR_CONNECT_TIMEOUT'}},'gigachat'),/время ожидания/);
  assert.doesNotMatch(aiFailureReason({cause:{code:'TOKEN_SECRET'}},'gigachat'),/TOKEN_SECRET/);
});
