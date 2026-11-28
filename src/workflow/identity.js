'use strict';
const crypto=require('node:crypto');
const {promisify}=require('node:util');
const scrypt=promisify(crypto.scrypt);
const ROLES=new Set(['administrator','curator','manager']);
const VALID_ID=/^u_[a-f0-9]{32}$/;
const SESSION_MS=12*60*60*1000;
const random=()=>crypto.randomBytes(32).toString('base64url');
const hash=t=>crypto.createHash('sha256').update(t).digest('hex');
function ensure(s){s.staffUsers||={};s.staffSessions||={};s.staffLoginFailures||={};s.audit||=[];}
function audit(s,actor,action,type,id){ensure(s);s.audit.push({id:'a_'+crypto.randomUUID().replaceAll('-',''),at:new Date().toISOString(),actorId:actor.id,actorName:actor.name,action,type,resourceId:id||''});}
function publicUser(u){return {id:u.id,login:u.login,name:u.name,role:u.role,active:u.active,preferences:u.preferences||{}};}
function credentials(login,name,password){
  if(typeof login!=='string'||!/^[a-zA-Z0-9_.-]{3,40}$/.test(login))return 'Логин: 3–40 латинских букв, цифр, точка, дефис или подчёркивание.';
  if(typeof name!=='string'||!name.trim()||name.length>100)return 'Укажите имя сотрудника (до 100 символов).';
  if(typeof password!=='string'||password.length<12||Buffer.byteLength(password)>512)return 'Пароль: не менее 12 символов.';
  return '';
}
async function passwordHash(password){const salt=crypto.randomBytes(16),key=await scrypt(password,salt,32,{N:16384,r:8,p:1,maxmem:64*1024*1024});return {salt:salt.toString('hex'),hash:key.toString('hex')};}
async function passwordMatches(password,record){const salt=Buffer.from(record.salt,'hex'),expected=Buffer.from(record.hash,'hex'),key=await scrypt(password,salt,32,{N:16384,r:8,p:1,maxmem:64*1024*1024});return expected.length===key.length&&crypto.timingSafeEqual(expected,key);}
function resolve(s,token){ensure(s);if(!/^[a-zA-Z0-9_-]{43}$/.test(token))return null;const session=s.staffSessions[hash(token)],u=session&&s.staffUsers[session.userId];if(!u||!u.active||session.expiresAt<=Date.now())return null;return u;}
function issue(s,u){const token=random();ensure(s);for(const [k,v] of Object.entries(s.staffSessions))if(v.expiresAt<=Date.now())delete s.staffSessions[k];s.staffSessions[hash(token)]={userId:u.id,expiresAt:Date.now()+SESSION_MS};return token;}
function revoke(s,userId){for(const [k,v] of Object.entries(s.staffSessions||{}))if(v.userId===userId)delete s.staffSessions[k];}
function id(){return 'u_'+crypto.randomUUID().replaceAll('-','');}
function create(s,{login,name,role,secret},actor){ensure(s);if(!ROLES.has(role))return {error:'Неизвестная роль.'};const key=login.toLowerCase();if(Object.values(s.staffUsers).some(u=>u.login.toLowerCase()===key))return {error:'Такой логин уже занят.'};const u={id:id(),login,name:name.trim(),role,active:true,password:secret,preferences:{}};s.staffUsers[u.id]=u;audit(s,actor||u,'account_created','staff',u.id);return {user:publicUser(u)};}
function bootstrap(s,data,secret){ensure(s);if(Object.keys(s.staffUsers).length)return {status:409,error:'Первый управляющий уже создан. Войдите под личной учётной записью.'};const made=create(s,{...data,role:'manager',secret});if(made.error)return {status:400,error:made.error};const u=s.staffUsers[made.user.id];return {status:200,user:made.user,token:issue(s,u)};}
function failureKey(login){return hash(login.toLowerCase());}
function currentFailures(s,login){ensure(s);const now=Date.now();return (s.staffLoginFailures[failureKey(login)]||[]).filter(x=>now-x<60000);}
function failure(s,login){ensure(s);const now=Date.now();for(const [key,items] of Object.entries(s.staffLoginFailures)){if(!items.some(x=>now-x<60000))delete s.staffLoginFailures[key];}const key=failureKey(login);s.staffLoginFailures[key]=currentFailures(s,login).concat(now).slice(-10);}
function setupRoles(s,actor,id,changes){ensure(s);if(actor.role!=='manager')return {status:403,error:'Только управляющий может управлять сотрудниками.'};const target=s.staffUsers[id];if(!target)return {status:404,error:'Сотрудник не найден.'};const role=changes.role??target.role,active=changes.active??target.active;
  if(!ROLES.has(role)||typeof active!=='boolean')return {status:400,error:'Проверьте роль и статус.'};
  const otherManagers=Object.values(s.staffUsers).filter(x=>x.id!==id&&x.role==='manager'&&x.active).length;
  if(target.role==='manager'&&target.active&&(!active||role!=='manager')&&!otherManagers)return {status:409,error:'Нужен хотя бы один активный управляющий.'};
  if(changes.name!==undefined&&(typeof changes.name!=='string'||!changes.name.trim()||changes.name.length>100))return {status:400,error:'Проверьте имя.'};
  if(changes.name!==undefined)target.name=changes.name.trim();target.role=role;target.active=active;if(changes.secret)target.password=changes.secret;
  revoke(s,id);audit(s,actor,'account_updated','staff',id);return {status:200,user:publicUser(target)};
}
module.exports={ROLES,VALID_ID,credentials,passwordHash,passwordMatches,ensure,audit,publicUser,resolve,issue,revoke,create,bootstrap,currentFailures,failure,hash,setupRoles};
