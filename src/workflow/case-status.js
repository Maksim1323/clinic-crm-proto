'use strict';
const identity=require('./identity');
const allowed=new Set(['new','in_progress','resolved']);
function status(c){return allowed.has(c.caseStatus)?c.caseStatus:c.mode==='assigned'?'in_progress':'new';}
function version(c){return Number.isSafeInteger(c.caseStatusVersion)&&c.caseStatusVersion>=0?c.caseStatusVersion:0;}
function change(s,c,next,actor){const previous=status(c);if(previous===next)return; c.caseStatus=next;c.caseStatusVersion=version(c)+1;identity.audit(s,actor,'case_status_changed','conversation',c.id);Object.assign(s.audit.at(-1),{previousStatus:previous,status:next});}
module.exports={allowed,status,version,change};
