'use strict';
const fs = require('node:fs');
const path = require('node:path');

// A local, temporary test store; not suitable for patient data or multiple instances.
function openStore(file) {
  let state = {updates:[], conversations:{}, sends:{}, jobs:[]};
  try {
    const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!stored || !Array.isArray(stored.updates) || !stored.conversations || !stored.sends) throw new Error('invalid_store');
    state = stored;
  } catch (e) { if (e.code !== 'ENOENT') throw new Error('Не удалось прочитать хранилище: запуск остановлен, чтобы не перезаписать данные.'); }
  if (!Array.isArray(state.jobs)) state.jobs = [];
  function persist() {
    fs.mkdirSync(path.dirname(file), {recursive:true});
    const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(state), {mode:0o600}); fs.renameSync(tmp,file);
  }
  return {state, persist};
}
module.exports = {openStore};
