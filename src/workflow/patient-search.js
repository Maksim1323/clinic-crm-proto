'use strict';
// Exact comparison is deliberately conservative: it is a warning, not identity verification.
function phoneKey(value){
 const s=String(value||'').trim();if(!/^[+\d\s().-]+$/.test(s))return '';let n=s.replace(/\D/g,'');if(n.length<7||n.length>15)return '';if(n.length===11&&n.startsWith('8'))n='7'+n.slice(1);return n;
}
function norm(value){return String(value||'').trim().toLocaleLowerCase('ru-RU').replaceAll('ё','е');}
function entries(s){
 const manual=Object.entries(s.manualPatients||{}).map(([id,p])=>({id,kind:'manual',name:p.name||'',phone:p.phone||''}));
 const telegram=Object.entries(s.conversations||{}).map(([id,c])=>({id:'tg_'+id,kind:'telegram',name:c.patient?.name||c.name||'Telegram',phone:c.patient?.phone||'',source:c.patientSources?.phone?.source||'',linkedPatientId:c.linkedPatientId||''}));
 return manual.concat(telegram);
}
function search(s,q){
 const query=norm(q),digits=String(q).replace(/\D/g,''),numeric=/^[+\d\s().-]+$/.test(String(q));if((numeric?digits.length<3:query.length<2))return [];
 const exact=phoneKey(q);return entries(s).filter(p=>numeric?(String(p.phone).replace(/\D/g,'').includes(digits)||(exact&&phoneKey(p.phone)===exact)):norm(p.name).includes(query)).slice(0,50);
}
function duplicates(s,phone,exclude=''){const key=phoneKey(phone);if(!key)return [];return entries(s).filter(p=>p.id!==exclude&&phoneKey(p.phone)===key).sort((a,b)=>a.id.localeCompare(b.id));}
function acknowledged(matches,ack){if(!Array.isArray(ack)||ack.length!==matches.length||ack.some(x=>typeof x!=='string'))return false;const expected=matches.map(m=>m.id).sort();return [...ack].sort().every((x,i)=>x===expected[i]);}
module.exports={phoneKey,search,duplicates,acknowledged};
