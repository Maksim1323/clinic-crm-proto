'use strict';
// Additional card fields are kept separately so an older Render instance,
// which replaces the original four-field patient object, cannot erase them.
const identity=require('./identity');
const core=['name','phone','admin','doctor'];
const extra=['age','gender','channel','stageNum','bonuses','nps','noSpam','statusInClinic','plan','note'];
const extraVisibility=['age','gender','channel','stage','bonuses','nps','nospam','inclinic','plan','note'];
const visibilityFields=core.concat(extraVisibility);
function view(c,user){
 const exists=c.patient||c.patientExtra;const patient=exists?{...(c.patient||{}),...(c.patientExtra||{})}:null;
 const visibility={...(c.patientVisibility||{}),...(c.patientExtraVisibility||{})};
 if(user.role==='administrator'){if(patient){delete patient.plan;delete patient.bonuses;}delete visibility.plan;delete visibility.bonuses;}
 return {patient,patientVisibility:visibility};
}
function validate(d,user){
 if(!d||typeof d!=='object'||Array.isArray(d)||core.some(k=>typeof d[k]!=='string'||d[k].length>100)||!Number.isSafeInteger(d.expectedVersion)||d.expectedVersion<0)return 'Проверьте поля и версию карточки.';
 if(d.visibility!==undefined&&(!d.visibility||typeof d.visibility!=='object'||Array.isArray(d.visibility)||Object.keys(d.visibility).some(k=>!visibilityFields.includes(k)||typeof d.visibility[k]!=='boolean')))return 'Проверьте настройки отображения полей.';
 if(d.extra!==undefined){const x=d.extra;if(!x||typeof x!=='object'||Array.isArray(x)||Object.keys(x).some(k=>!extra.includes(k)))return 'Проверьте дополнительные поля.';
  if(['age','plan','note'].some(k=>k in x&&(typeof x[k]!=='string'||x[k].length>(k==='note'?5000:k==='plan'?300:100))))return 'Проверьте длину дополнительных полей.';
  if('gender'in x&&!['','male','female'].includes(x.gender))return 'Проверьте пол.';
  if('channel'in x&&!['','tg','call','vk','email','mis'].includes(x.channel))return 'Проверьте канал обращения.';
  if('stageNum'in x&&!(x.stageNum===null||(Number.isInteger(x.stageNum)&&x.stageNum>=1&&x.stageNum<=5)))return 'Проверьте этап.';
  if('bonuses'in x&&!(x.bonuses===null||(typeof x.bonuses==='number'&&Number.isFinite(x.bonuses)&&x.bonuses>=0&&x.bonuses<=1e12)))return 'Проверьте бонусы.';
  if('nps'in x&&!(x.nps===null||(Number.isInteger(x.nps)&&x.nps>=1&&x.nps<=10)))return 'Проверьте NPS.';
  if(['noSpam','statusInClinic'].some(k=>k in x&&typeof x[k]!=='boolean'))return 'Проверьте отметки карточки.';
 }
 if(user.role==='administrator'&&(['plan','bonuses'].some(k=>Object.hasOwn(d.extra||{},k)||Object.hasOwn(d.visibility||{},k))))return 'Недостаточно прав для полей плана и бонусов.';
 if(d.assigneeUserId!==undefined&&(typeof d.assigneeUserId!=='string'||typeof d.expectedAssigneeUserId!=='string'||(d.assigneeUserId&&!identity.VALID_ID.test(d.assigneeUserId))))return 'Проверьте ответственного сотрудника.';
 return '';
}
module.exports={core,extraVisibility,view,validate};
