'use strict';
// Read-only, consistent snapshot. Never output patient data or connection strings.
const {Pool}=require('pg');
const {isDeepStrictEqual}=require('node:util');
const relational=require('../src/storage/relational-state');
async function main(){
 if(!process.env.DATABASE_URL){console.error('DATABASE_URL не задан.');process.exitCode=1;return;}
 const pool=new Pool({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:10000,max:1});
 try{
  const c=await pool.connect();try{
   await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
   const legacy=await c.query('SELECT payload,md5(payload::text) hash FROM clinic_state WHERE id=1');
   const meta=await c.query('SELECT version,legacy_hash FROM crm_v2.migration_meta WHERE id=1');
   if(legacy.rowCount!==1||meta.rowCount!==1||meta.rows[0].version!==1)throw Error('schema');
   const maps=await relational.readMaps(c),state=relational.join(maps);
   const exact=await c.query('SELECT payload=$1::jsonb AS same FROM clinic_state WHERE id=1',[JSON.stringify(state)]);
   const same=meta.rows[0].legacy_hash===legacy.rows[0].hash&&isDeepStrictEqual(state,legacy.rows[0].payload)&&exact.rows[0]?.same;
   const backup=await c.query('SELECT created_at FROM crm_v2.migration_backup WHERE id=1');
   const counts=Object.fromEntries(['patients','conversations','messages','tasks','users','card_view_settings','audit_events'].map(k=>[k,maps[k].size]));
   await c.query('COMMIT');console.log(JSON.stringify({status:same?'ok':'mismatch',schema_version:1,counts,initial_snapshot_present:backup.rowCount===1},null,2));if(!same)process.exitCode=2;
  }finally{c.release();}
 }catch(_){console.error('Проверка хранилища не выполнена. Проверьте доступность базы и миграцию.');process.exitCode=1;}finally{await pool.end();}
}
main();
