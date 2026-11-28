'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{Pool}=require('pg');
const {openTransactionStore}=require('../src/storage/transaction-store');
const url=process.env.TEST_MIGRATION_DATABASE_URL;
const config={databaseUrl:url};
const initial={updates:[11,12],sends:{send1:{status:'pending',chatId:'42'}},jobs:[{id:'job',stage:'queued',chatId:'42'}],
 conversations:{'42':{id:'42',name:'Тест',mode:'waiting',messages:[{id:'same',text:'Первое',at:'2030-01-01'},{id:'same',text:'Второе'}],patient:{name:'Пример',phone:'000'},patientVersion:2,patientSources:{name:{source:'telegram'}},patientVisibility:{phone:false},handoff:{reason:'Проверить'},extra:'сохранить'}},
 manualPatients:{p_abc:{id:'p_abc',name:'Карточка',phone:'000',plan:'план',bonuses:12,visibility:{plan:false},history:[{body:'заметка'}],legacyRecord:{any:['старое']}}},
 manualTasks:{t_abc:{id:'t_abc',title:'Проверить',patientId:'p_abc',assigneeUserId:'u_abc',done:false}},
 staffUsers:{u_abc:{id:'u_abc',login:'manager',name:'Тест',role:'manager',active:true,password:{salt:'salt',hash:'hash'},preferences:{phone:false}}},
 staffSessions:{hash:{userId:'u_abc',expiresAt:9999999999999}},staffLoginFailures:{key:[10]},manualEmployees:{e:{id:'e',name:'Тест'}},audit:[{id:'a1',action:'record_updated',actorId:'u_abc',at:'2030-01-01'}],futureFeature:{keep:['данные',null]}};
async function reset(pool,seed=initial){await pool.query('DROP SCHEMA IF EXISTS crm_v2 CASCADE');await pool.query('DROP TABLE IF EXISTS clinic_state');await pool.query('CREATE TABLE clinic_state(id integer PRIMARY KEY,payload jsonb NOT NULL)');await pool.query('INSERT INTO clinic_state VALUES(1,$1::jsonb)',[JSON.stringify(seed)]);}

test('PostgreSQL: перенос каждой сущности, исходная копия, рестарт и конкурентный старый выпуск',{skip:!url},async t=>{
 const pool=new Pool({connectionString:url});await reset(pool);const a=openTransactionStore(config),b=openTransactionStore(config);t.after(async()=>{await Promise.all([a.close(),b.close()]);await pool.end()});await Promise.all([a.ready,b.ready]);
 assert.deepEqual(await a.transact(s=>structuredClone(s)),initial);
 assert.deepEqual((await pool.query('SELECT payload FROM clinic_state')).rows[0].payload,initial);
 assert.deepEqual((await pool.query('SELECT payload FROM crm_v2.migration_backup')).rows[0].payload,initial);
 const counts=Object.fromEntries(await Promise.all(['patients','conversations','messages','tasks','users','card_view_settings','audit_events','roles'].map(async n=>[n,Number((await pool.query(`SELECT count(*) n FROM crm_v2.${n}`)).rows[0].n)])));
 assert.deepEqual(counts,{patients:2,conversations:1,messages:2,tasks:1,users:1,card_view_settings:3,audit_events:1,roles:3});
 assert.equal((await pool.query("SELECT name FROM crm_v2.patients WHERE kind='telegram' AND entity_id='42'")).rows[0].name,'Пример');
 assert.equal((await pool.query("SELECT assignee_user_id FROM crm_v2.tasks WHERE record_key='t_abc'")).rows[0].assignee_user_id,'u_abc');
 const {spawnSync}=require('node:child_process'),report=spawnSync(process.execPath,['scripts/check-storage.js'],{env:{...process.env,DATABASE_URL:url},encoding:'utf8'});assert.equal(report.status,0,report.stderr);assert.equal(JSON.parse(report.stdout).status,'ok');
 // A pre-migration instance still writes clinic_state under the same lock.
 const legacy=await pool.connect();await legacy.query('BEGIN');const r=await legacy.query('SELECT payload FROM clinic_state WHERE id=1 FOR UPDATE');const old=r.rows[0].payload;old.conversations['42'].messages.push({id:'old',text:'Старый экземпляр'});old.manualTasks.t_abc.done=true;await legacy.query('UPDATE clinic_state SET payload=$1::jsonb WHERE id=1',[JSON.stringify(old)]);
 const waiting=b.transact(s=>{s.manualPatients.p_abc.name='Новый экземпляр';return s.conversations['42'].messages.length;});await legacy.query('COMMIT');legacy.release();assert.equal(await waiting,3);
 const result=await a.transact(s=>structuredClone(s));assert.equal(result.conversations['42'].messages[2].text,'Старый экземпляр');assert.equal(result.manualTasks.t_abc.done,true);assert.equal(result.manualPatients.p_abc.name,'Новый экземпляр');assert.deepEqual((await pool.query('SELECT payload FROM clinic_state')).rows[0].payload,result);assert.deepEqual((await pool.query('SELECT payload FROM crm_v2.migration_backup')).rows[0].payload,initial);
 assert.equal((await pool.query('SELECT count(*) n FROM crm_v2.messages')).rows[0].n,'3');
 // Starting a new release while an existing transaction holds the compatibility
 // lock must not lock entity tables first (that lock order caused a deadlock).
 const live=await pool.connect();await live.query('BEGIN');await live.query("SET LOCAL statement_timeout='2s'");await live.query('SELECT payload FROM clinic_state WHERE id=1 FOR UPDATE');
 const restarted=openTransactionStore(config);await new Promise(r=>setTimeout(r,100));
 try{await live.query('SELECT * FROM crm_v2.tasks');await live.query('COMMIT');}catch(e){await live.query('ROLLBACK');throw e;}finally{live.release();}
 await restarted.ready;assert.deepEqual(await restarted.transact(s=>structuredClone(s)),result);await restarted.close();
});

test('PostgreSQL: ошибка миграции и отказ записи не портят исходные данные',{skip:!url},async t=>{
 const pool=new Pool({connectionString:url});await reset(pool);const s=openTransactionStore(config);t.after(async()=>{await s.close();await pool.end()});await s.ready;
 await pool.query("CREATE FUNCTION crm_v2.reject_patient() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced failure'; END $$");await pool.query('CREATE TRIGGER fail_patient BEFORE INSERT OR UPDATE ON crm_v2.patients FOR EACH ROW EXECUTE FUNCTION crm_v2.reject_patient()');
 await assert.rejects(s.transact(state=>{state.manualPatients.p_abc.name='Не должно сохраниться';state.manualTasks.t_abc.done=true}));
 assert.deepEqual((await pool.query('SELECT payload FROM clinic_state')).rows[0].payload,initial);
 await pool.query('DROP TRIGGER fail_patient ON crm_v2.patients');assert.deepEqual(await s.transact(x=>structuredClone(x)),initial);
 // An inconsistent direct table edit fails closed and never overwrites the legacy snapshot.
 await pool.query("UPDATE crm_v2.users SET payload=jsonb_set(payload,'{name}',to_jsonb('Подмена'::text)) WHERE record_key='u_abc'");
 await assert.rejects(s.transact(()=>null),/relational_mirror_mismatch/);assert.deepEqual((await pool.query('SELECT payload FROM clinic_state')).rows[0].payload,initial);
});

test('PostgreSQL: неполные или неточно представимые старые данные не перезаписываются',{skip:!url},async t=>{
 const pool=new Pool({connectionString:url});t.after(()=>pool.end());const bad={updates:[],conversations:{'1':{id:'1',messages:'broken'}},sends:{},jobs:[]};await reset(pool,bad);
 let s=openTransactionStore(config);await assert.rejects(s.ready,/invalid_relational_conversation/);await s.close();assert.deepEqual((await pool.query('SELECT payload FROM clinic_state')).rows[0].payload,bad);
 // This JSONB integer cannot be represented exactly by JavaScript; do not silently round it.
 await reset(pool,{updates:[],conversations:{},sends:{},jobs:[]});await pool.query("UPDATE clinic_state SET payload = jsonb_set(payload,'{future}', '9007199254740993'::jsonb)");
 s=openTransactionStore(config);await assert.rejects(s.ready,/legacy_state_roundtrip_mismatch/);await s.close();assert.equal((await pool.query("SELECT payload->>'future' n FROM clinic_state")).rows[0].n,'9007199254740993');
});

test('PostgreSQL: существующие сотрудники и права работают после переноса без повторного bootstrap',{skip:!url},async t=>{
 const pool=new Pool({connectionString:url});t.after(()=>pool.end());const identity=require('../src/workflow/identity');const secret=await identity.passwordHash('Strongpass123456');
 const seeded=structuredClone(initial);seeded.staffUsers.u_abc={...seeded.staffUsers.u_abc,login:'admin',role:'administrator',password:secret};await reset(pool,seeded);
 const {createServer}=require('../src/app');const app=createServer({env:{DATABASE_URL:url,ADMIN_TOKEN:'setup-token-at-least-24-characters',AI_AUTO_REPLY:'false'}});await app.ready;await new Promise(r=>app.listen(0,'127.0.0.1',r));t.after(()=>app.close());const root='http://127.0.0.1:'+app.address().port;
 const status=await(await fetch(root+'/api/auth/status')).json();assert.equal(status.configured,true);
 const login=await fetch(root+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({login:'admin',password:'Strongpass123456'})});assert.equal(login.status,200);const session=await login.json();assert.equal(session.user.id,'u_abc');
 const auth={Authorization:'Bearer '+session.token};const cards=await(await fetch(root+'/api/manual',{headers:auth})).json();assert.equal(cards.patients[0].name,'Карточка');assert.equal(cards.patients[0].plan,undefined);assert.equal(cards.tasks[0].assigneeUserId,'u_abc');
 const chat=await(await fetch(root+'/api/telegram/conversations/42',{headers:auth})).json();assert.equal(chat.messages.length,2);assert.equal(chat.patientVisibility.phone,false);
 const backup=(await pool.query('SELECT payload FROM crm_v2.migration_backup WHERE id=1')).rows[0].payload;assert.deepEqual(backup,seeded);
});

test('PostgreSQL: старое состояние без поля очереди сохраняется и нормализуется при работе',{skip:!url},async t=>{
 const pool=new Pool({connectionString:url});t.after(()=>pool.end());const old={updates:[],conversations:{},sends:{},extra:'сохранить'};await reset(pool,old);const store=openTransactionStore(config);t.after(()=>store.close());await store.ready;
 assert.deepEqual((await pool.query('SELECT payload FROM clinic_state')).rows[0].payload,old);const current=await store.transact(s=>structuredClone(s));assert.deepEqual(current,{...old,jobs:[]});assert.deepEqual((await pool.query('SELECT payload FROM crm_v2.migration_backup')).rows[0].payload,old);
});
