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
