'use strict';
// The prototype uses the same serialised state transaction as Telegram. No
// external requests are made within transactions. This is not multi-user RBAC.
const crypto=require('node:crypto');
const FIELDS=['name','phone','age','gender','channelIcon','channelLabel','timeLabel','admin','doctor','preview','createdAt','plan','note'];
const visibilityFields=['name','phone','age','gender','channel','admin','doctor','stage','bonuses','nps','nospam','inclinic','plan','note'];
const safeId=/^(?:p|t)_[a-f0-9]{32}$/;
const refId=/^(?:p_[a-f0-9]{32}|tg_-?\d{1,20})$/;
const ok=data=>({status:200,data}),bad=(status,error)=>({status,data:{error}});
function ensure(s){s.manualPatients||={};s.manualTasks||={};s.manualEmployees||={};return s;}
function employeeFor(s,name){const value=String(name||'').trim();if(!value||value==='—')return '';const key=value.normalize('NFKC').toLocaleLowerCase('ru-RU');const existing=Object.values(s.manualEmployees).find(e=>e.name.normalize('NFKC').toLocaleLowerCase('ru-RU')===key);if(existing)return existing.id;const id='e_'+crypto.randomUUID().replaceAll('-','');s.manualEmployees[id]={id,name:value};return id;}
function idFromLegacy(scope,kind,id){return (kind==='patient'?'p_':'t_')+crypto.createHash('sha256').update(JSON.stringify([scope,kind,id])).digest('hex').slice(0,32);}
function patientInput(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
  const p={};for(const key of FIELDS){const value=raw[key];if(value!=null&&typeof value!=='string')return null;if(typeof value==='string'&&value.length>(key==='note'?5000:300))return null;p[key]=value??'';}
  if(!p.name.trim()||!p.phone.trim())return null;
  p.emoji=typeof raw.emoji==='string'&&raw.emoji.length<=20?raw.emoji:'👤';
  p.stageNum=Number(raw.stageNum);if(!Number.isInteger(p.stageNum)||p.stageNum<1||p.stageNum>5)return null;p.stageTotal=5;
  p.bonuses=Number(raw.bonuses||0);if(!Number.isFinite(p.bonuses)||p.bonuses<0)return null;
  p.nps=raw.nps==null||raw.nps===''?null:Number(raw.nps);if(p.nps!==null&&(!Number.isInteger(p.nps)||p.nps<1||p.nps>10))return null;
  p.unread=Number.isSafeInteger(raw.unread)&&raw.unread>=0?raw.unread:0;p.noSpam=!!raw.noSpam;p.statusInClinic=!!raw.statusInClinic;
  p.visibility={};if(raw.visibility&&typeof raw.visibility==='object'&&!Array.isArray(raw.visibility))for(const k of visibilityFields){if(typeof raw.visibility[k]==='boolean')p.visibility[k]=raw.visibility[k];}
  if(!Array.isArray(raw.history)||raw.history.length>500)return null;
  p.history=[];for(const h of raw.history){if(!h||typeof h!=='object')return null;const e={};for(const k of ['type','icon','title','date','body']){if(h[k]!=null&&typeof h[k]!=='string')return null;if((h[k]||'').length>(k==='body'?12000:300))return null;e[k]=h[k]||'';}p.history.push(e);}
  return p;
}
function taskInput(raw,s){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
  const title=typeof raw.title==='string'?raw.title.trim():'';if(!title||title.length>160)return null;
  const assignee=typeof raw.assignee==='string'?raw.assignee.trim():'';if(assignee.length>100)return null;
  const patientId=typeof raw.patientId==='string'?raw.patientId:'';if(patientId&&(!refId.test(patientId)||(patientId.startsWith('p_')?!s.manualPatients[patientId]:!s.conversations[patientId.slice(3)])))return null;
  let dueAt=raw.dueAt||null;if(dueAt!==null&&(typeof dueAt!=='string'||dueAt.length>40||!Number.isFinite(Date.parse(dueAt))||!/(?:Z|[+-]\d\d:\d\d)$/.test(dueAt)))return null;
  if(dueAt)dueAt=new Date(dueAt).toISOString();
  const due=typeof raw.due==='string'?raw.due:'без срока';const source=typeof raw.source==='string'?raw.source:'Вручную';if(due.length>150||source.length>150)return null;
  return {title,assignee:assignee||'—',patientId,dueAt,due,overdue:!!raw.overdue,done:!!raw.done,source};
}
function patientName(s,id){if(!id)return '—';if(id.startsWith('tg_')){const c=s.conversations[id.slice(3)];return c?.patient?.name||c?.name||'Telegram';}return s.manualPatients[id]?.name||'—';}
function publicRecord(record){const {legacyRecord,...visible}=record;return visible;}
function list(s){ensure(s);return {patients:Object.values(s.manualPatients).map(publicRecord),tasks:Object.values(s.manualTasks).map(t=>({...publicRecord(t),patient:patientName(s,t.patientId)})),employees:Object.values(s.manualEmployees)};}
function save(s,kind,id,data){
  ensure(s);if(!safeId.test(id)||(kind==='patient'&&!id.startsWith('p_'))||(kind==='task'&&!id.startsWith('t_')))return bad(400,'Неверный идентификатор');
  if(!data||typeof data!=='object'||Array.isArray(data))return bad(400,'Некорректный запрос');
  const collection=kind==='patient'?s.manualPatients:s.manualTasks,old=collection[id],expected=data.expectedVersion;
  if(old ? !Number.isSafeInteger(expected)||expected!==old.version : expected!==null)return bad(409,'Запись изменилась или уже существует. Скопируйте несохранённый текст, откройте её заново и повторите.');
  const next=kind==='patient'?patientInput(data.record):taskInput(data.record,s);if(!next)return bad(400,'Проверьте поля, длину текста и связь с пациентом.');
  next.id=id;next.version=old?old.version+1:1;if(kind==='task')next.employeeId=employeeFor(s,next.assignee);if(old?.legacyRecord)next.legacyRecord=old.legacyRecord;collection[id]=next;
  if(kind==='patient'&&data.createStageTask===true&&old&&old.stageNum!==next.stageNum){
    const taskId='t_'+crypto.randomUUID().replaceAll('-','');s.manualTasks[taskId]={id:taskId,version:1,title:'Проверить этап: '+({1:'Первичный приём',2:'Продажа плана лечения',3:'Лечение',4:'Профосмотр',5:'Потенциальный клиент'}[next.stageNum]),patientId:id,assignee:next.admin||'—',dueAt:null,due:'без срока',overdue:false,done:false,source:'Смена этапа',employeeId:employeeFor(s,next.admin)};
  }
  return ok({record:kind==='task'?{...publicRecord(next),patient:patientName(s,next.patientId)}:publicRecord(next)});
}
function importOne(s,data){
  ensure(s);if(!data||!['patient','task'].includes(data.kind)||typeof data.scope!=='string'||!/^[a-f0-9]{32}$/.test(data.scope)||typeof data.legacyId!=='string'||!data.legacyId||data.legacyId.length>200)return bad(400,'Некорректные данные импорта.');
  const id=idFromLegacy(data.scope,data.kind,data.legacyId),collection=data.kind==='patient'?s.manualPatients:s.manualTasks;
  if(collection[id])return ok({status:'exists',id});
  let record=data.record;
  if(data.kind==='task'&&record&&record.patientId){
    if(typeof record.patientId!=='string'||record.patientId.length>200)return bad(400,'Некорректная связь задачи.');
    const linked=idFromLegacy(data.scope,'patient',record.patientId);
    if(!s.manualPatients[linked])return bad(409,'Связанная старая карточка не импортирована; задача оставлена в браузере.');
    record={...record,patientId:linked};
  }
  const result=save(s,data.kind,id,{expectedVersion:null,record});if(result.status!==200)return result;
  // Retain the original imported data, including any legacy fields not used by the current UI.
  collection[id].legacyRecord=data.record;
  return ok({status:'imported',id});
}
module.exports={list,save,importOne};
