'use strict';
// Incremental migration: individual entity rows are authoritative for new code,
// while clinic_state is maintained as a compatibility mirror for old releases.
// All operations still share clinic_state's row lock until the compatibility phase ends.
const {isDeepStrictEqual}=require('node:util');
const collections=['conversations','manualPatients','manualTasks','staffUsers','audit'];
const tables=['patients','conversations','messages','tasks','users','card_view_settings','audit_events','state_parts'];
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const key=(...parts)=>JSON.stringify(parts);
function take(o,names){const out={};for(const n of names)if(own(o,n)){out[n]=o[n];delete o[n];}return out;}
function isObject(v){return v!==null&&typeof v==='object'&&!Array.isArray(v);}
function split(state){
 const maps=Object.fromEntries(tables.map(n=>[n,new Map()]));
 const extra={...state},present=[];
 for(const n of collections)if(own(extra,n)){present.push(n);delete extra[n];}
 maps.state_parts.set('root',{extra,present});
 for(const name of ['conversations','manualPatients','manualTasks','staffUsers'])if(own(state,name)&&!isObject(state[name]))throw Error('invalid_relational_source_'+name);
 if(own(state,'audit')&&!Array.isArray(state.audit))throw Error('invalid_relational_source_audit');
 for(const [id,value] of Object.entries(state.conversations||{})){
  if(!isObject(value)||!Array.isArray(value.messages))throw Error('invalid_relational_conversation');
  const c={...value},messages=c.messages;delete c.messages;
  const patient=take(c,['patient','patientVersion','patientSources']);if(Object.keys(patient).length)maps.patients.set(key('telegram',id),patient);
  const vis=take(c,['patientVisibility']);if(Object.keys(vis).length)maps.card_view_settings.set(key('telegram',id),vis);
  maps.conversations.set(id,c);messages.forEach((m,i)=>maps.messages.set(key(id,i),m));
 }
 for(const [id,value] of Object.entries(state.manualPatients||{})){
  if(!isObject(value))throw Error('invalid_relational_patient');const p={...value},vis=take(p,['visibility']);
  maps.patients.set(key('manual',id),p);if(Object.keys(vis).length)maps.card_view_settings.set(key('patient',id),vis);
 }
 for(const [id,value] of Object.entries(state.manualTasks||{}))maps.tasks.set(id,value);
 for(const [id,value] of Object.entries(state.staffUsers||{})){
  if(!isObject(value))throw Error('invalid_relational_user');const u={...value},pref=take(u,['preferences']);maps.users.set(id,u);
  if(Object.keys(pref).length)maps.card_view_settings.set(key('user',id),pref);
 }
 (state.audit||[]).forEach((v,i)=>maps.audit_events.set(String(i),v));
 return maps;
}
function join(maps){
 const root=maps.state_parts.get('root');if(!root||!isObject(root.extra)||!Array.isArray(root.present))throw Error('invalid_relational_root');
 const state={...root.extra};for(const name of root.present){if(!collections.includes(name))throw Error('invalid_relational_root');state[name]=name==='audit'?[]:{};}
 for(const [id,c] of maps.conversations){if(!state.conversations||!isObject(c))throw Error('invalid_relational_conversation');state.conversations[id]={...c,messages:[]};}
 const messages=[];for(const [k,v] of maps.messages){const [id,i]=JSON.parse(k);if(!state.conversations?.[id]||!Number.isSafeInteger(i)||i<0)throw Error('invalid_relational_message');messages.push([id,i,v]);}
 messages.sort((a,b)=>a[1]-b[1]);for(const [id,i,v] of messages){const list=state.conversations[id].messages;if(i!==list.length)throw Error('invalid_relational_message_order');list.push(v);}
 for(const [k,v] of maps.patients){const [kind,id]=JSON.parse(k);if(kind==='manual'&&state.manualPatients)state.manualPatients[id]=v;else if(kind==='telegram'&&state.conversations?.[id]&&isObject(v))Object.assign(state.conversations[id],v);else throw Error('invalid_relational_patient');}
 for(const [id,v] of maps.tasks){if(!state.manualTasks)throw Error('invalid_relational_task');state.manualTasks[id]=v;}
 for(const [id,v] of maps.users){if(!state.staffUsers||!isObject(v))throw Error('invalid_relational_user');state.staffUsers[id]=v;}
 for(const [k,v] of maps.card_view_settings){const [kind,id]=JSON.parse(k),target=kind==='patient'?state.manualPatients?.[id]:kind==='telegram'?state.conversations?.[id]:kind==='user'?state.staffUsers?.[id]:null;if(!isObject(target)||!isObject(v))throw Error('invalid_relational_settings');Object.assign(target,v);}
 const events=[...maps.audit_events].sort((a,b)=>Number(a[0])-Number(b[0]));for(const [i,v] of events){if(!state.audit||String(state.audit.length)!==i)throw Error('invalid_relational_audit');state.audit.push(v);}
 return state;
}
async function initialize(client){
 await client.query('CREATE SCHEMA IF NOT EXISTS crm_v2');
 await client.query('CREATE TABLE IF NOT EXISTS crm_v2.migration_meta (id integer PRIMARY KEY CHECK (id=1), version integer NOT NULL, legacy_hash text NOT NULL)');
 const meta=await client.query('SELECT version FROM crm_v2.migration_meta WHERE id=1');if(meta.rowCount&&meta.rows[0].version!==1)throw Error('unsupported_relational_schema');
 await client.query('CREATE TABLE IF NOT EXISTS crm_v2.migration_backup (id integer PRIMARY KEY CHECK (id=1), created_at timestamptz NOT NULL DEFAULT now(), payload jsonb NOT NULL)');
 await client.query('CREATE TABLE IF NOT EXISTS crm_v2.roles (code text PRIMARY KEY, label text NOT NULL)');
 await client.query("INSERT INTO crm_v2.roles (code,label) VALUES ('administrator','Администратор'),('curator','Куратор'),('manager','Управляющий') ON CONFLICT (code) DO NOTHING");
 for(const t of tables)await client.query(`CREATE TABLE IF NOT EXISTS crm_v2.${t} (record_key text PRIMARY KEY, payload jsonb NOT NULL)`);
 // Generated columns expose identifiers and searchable fields without losing legacy JSON fields.
 const columns={
  patients:{kind:"record_key::jsonb->>0",entity_id:"record_key::jsonb->>1",name:"COALESCE(payload->>'name',payload#>>'{patient,name}')"},
  messages:{conversation_id:"record_key::jsonb->>0",sequence:"record_key::jsonb->>1"},
  card_view_settings:{entity_type:"record_key::jsonb->>0",entity_id:"record_key::jsonb->>1"},
  conversations:{assignee_user_id:"payload->>'assigneeUserId'"},
  tasks:{patient_id:"payload->>'patientId'",assignee_user_id:"payload->>'assigneeUserId'"},
  users:{login:"payload->>'login'",role:"payload->>'role'"},
  audit_events:{actor_id:"payload->>'actorId'",action:"payload->>'action'",occurred_at:"payload->>'at'"}
 };
 for(const [table,fields] of Object.entries(columns))for(const [name,expr] of Object.entries(fields))await client.query(`ALTER TABLE crm_v2.${table} ADD COLUMN IF NOT EXISTS ${name} text GENERATED ALWAYS AS (${expr}) STORED`);
 await client.query("ALTER TABLE crm_v2.messages ADD COLUMN IF NOT EXISTS sequence_num bigint GENERATED ALWAYS AS ((record_key::jsonb->>1)::bigint) STORED");
 await client.query('CREATE INDEX IF NOT EXISTS crm_patients_name_idx ON crm_v2.patients (name)');
 await client.query('CREATE INDEX IF NOT EXISTS crm_messages_conversation_idx ON crm_v2.messages (conversation_id,sequence_num)');
 await client.query('CREATE INDEX IF NOT EXISTS crm_tasks_patient_idx ON crm_v2.tasks (patient_id)');
 await client.query('CREATE INDEX IF NOT EXISTS crm_tasks_assignee_idx ON crm_v2.tasks (assignee_user_id)');
 await client.query('CREATE INDEX IF NOT EXISTS crm_conversations_assignee_idx ON crm_v2.conversations (assignee_user_id)');
 await client.query('CREATE INDEX IF NOT EXISTS crm_users_role_idx ON crm_v2.users (role)');
 await client.query('CREATE INDEX IF NOT EXISTS crm_audit_actor_idx ON crm_v2.audit_events (actor_id)');
}
async function readMaps(client){const maps={};for(const t of tables){const r=await client.query(`SELECT record_key,payload FROM crm_v2.${t}`);maps[t]=new Map(r.rows.map(x=>[x.record_key,x.payload]));}return maps;}
async function sync(client,before,after){
 // Remove dependent rows first; there are no cascading deletes or user-data FKs in phase 1.
 for(const t of tables){for(const k of before[t].keys())if(!after[t].has(k))await client.query(`DELETE FROM crm_v2.${t} WHERE record_key=$1`,[k]);
  for(const [k,v] of after[t])if(!before[t].has(k)||!isDeepStrictEqual(before[t].get(k),v))await client.query(`INSERT INTO crm_v2.${t} (record_key,payload) VALUES ($1,$2::jsonb) ON CONFLICT (record_key) DO UPDATE SET payload=EXCLUDED.payload`,[k,JSON.stringify(v)]);
 }
}
async function checkRoundtrip(client,state){const same=await client.query('SELECT payload = $1::jsonb AS same FROM clinic_state WHERE id=1',[JSON.stringify(state)]);if(!same.rows[0]?.same)throw Error('legacy_state_roundtrip_mismatch');}
async function load(client,legacy,hash){
 const meta=await client.query('SELECT version,legacy_hash FROM crm_v2.migration_meta WHERE id=1');
 if(meta.rowCount&&meta.rows[0].version!==1)throw Error('unsupported_relational_schema');
 let maps=await readMaps(client);
 if(!meta.rowCount||meta.rows[0].legacy_hash!==hash){
  // Another (older) instance changed clinic_state, or this is the first migration.
  // Snapshot is retained before the first conversion, and the original is never dropped.
  await client.query('INSERT INTO crm_v2.migration_backup (id,payload) SELECT 1,payload FROM clinic_state WHERE id=1 ON CONFLICT (id) DO NOTHING');
  await checkRoundtrip(client,legacy);const expected=split(legacy);await sync(client,maps,expected);maps=await readMaps(client);
  if(!isDeepStrictEqual(join(maps),legacy))throw Error('relational_migration_mismatch');
  await client.query('INSERT INTO crm_v2.migration_meta (id,version,legacy_hash) VALUES (1,1,$1) ON CONFLICT (id) DO UPDATE SET legacy_hash=EXCLUDED.legacy_hash',[hash]);
 }
 const state=join(maps);if(!isDeepStrictEqual(state,legacy))throw Error('relational_mirror_mismatch');
 return {state:structuredClone(state),maps};
}
async function save(client,maps,state){
 const expected=split(state);await sync(client,maps,expected);const verify=await readMaps(client);
 if(!isDeepStrictEqual(join(verify),state))throw Error('relational_write_mismatch');
 const updated=await client.query('UPDATE clinic_state SET payload=$1::jsonb WHERE id=1 RETURNING md5(payload::text) AS hash',[JSON.stringify(state)]);
 if(updated.rowCount!==1)throw Error('invalid_store');await checkRoundtrip(client,state);
 await client.query('UPDATE crm_v2.migration_meta SET legacy_hash=$1 WHERE id=1',[updated.rows[0].hash]);
}
module.exports={initialize,load,save,split,join,readMaps};
