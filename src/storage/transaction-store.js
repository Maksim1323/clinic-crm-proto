'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {Pool} = require('pg');
const EMPTY = () => ({updates:[],conversations:{},sends:{},jobs:[]});
function validate(state) {
  if(!state || !Array.isArray(state.updates) || !state.conversations || typeof state.conversations!=='object' || !state.sends || typeof state.sends!=='object')throw Error('invalid_store');
  if(!Array.isArray(state.jobs))state.jobs=[];
  return state;
}
function openTransactionStore(config) {
  if(config.databaseUrl) {
    const pool = new Pool({connectionString:config.databaseUrl, connectionTimeoutMillis:10000, max:6});
    pool.on('error',()=>console.error('Соединение с хранилищем закрыто'));
    const ready=(async()=>{
      const client=await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(735812760)');
        await client.query('CREATE TABLE IF NOT EXISTS clinic_state (id integer PRIMARY KEY CHECK (id=1), payload jsonb NOT NULL)');
        await client.query('INSERT INTO clinic_state (id,payload) VALUES (1,$1::jsonb) ON CONFLICT (id) DO NOTHING',[JSON.stringify(EMPTY())]);
        await client.query('COMMIT');
      }catch(error){try{await client.query('ROLLBACK');}catch(_){}throw error;}finally{client.release();}
    })();
    async function transact(fn) {
      await ready; const client=await pool.connect();
      try {
        await client.query('BEGIN');
        const result=await client.query('SELECT payload FROM clinic_state WHERE id=1 FOR UPDATE');
        if(result.rowCount!==1)throw Error('invalid_store');
        const state=validate(result.rows[0].payload), value=fn(state);
        if(value && typeof value.then==='function')throw Error('async_transaction_forbidden');
        await client.query('UPDATE clinic_state SET payload=$1::jsonb WHERE id=1',[JSON.stringify(state)]);
        await client.query('COMMIT');return value;
      } catch(error) {try{await client.query('ROLLBACK');}catch(_){}throw error;} finally {client.release();}
    }
    return {ready,transact,close:()=>pool.end(),kind:'postgres'};
  }
  if(config.requireDatabase)throw Error('На Render необходимо настроить DATABASE_URL для сохранения чатов.');
  let state=EMPTY();
  try {state=validate(JSON.parse(fs.readFileSync(config.file,'utf8')));}catch(e){if(e.code!=='ENOENT')throw Error('Не удалось прочитать хранилище: запуск остановлен.');}
  let lock=Promise.resolve();
  function transact(fn) {
    const work=lock.then(()=>{
      const candidate=structuredClone(state), result=fn(candidate);
      if(result && typeof result.then==='function')throw Error('async_transaction_forbidden');
      fs.mkdirSync(path.dirname(config.file),{recursive:true});const temp=config.file+'.tmp';fs.writeFileSync(temp,JSON.stringify(candidate),{mode:0o600});fs.renameSync(temp,config.file);state=candidate;return result;
    });
    lock=work.catch(()=>{});return work;
  }
  return {ready:Promise.resolve(),transact,close:async()=>{await lock;},kind:'temporary'};
}
module.exports={openTransactionStore};
