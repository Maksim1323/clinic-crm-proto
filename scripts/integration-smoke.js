'use strict';
const {runAi,runTelegram}=require('../src/security/integration-smoke');
async function main(){if(process.env.INTEGRATION_SMOKE_CONFIRM!=='synthetic-only'||!['ai','telegram'].includes(process.argv[2])||process.argv.length!==3)throw Error('not_confirmed');const result=await (process.argv[2]==='ai'?runAi(process.env):runTelegram(process.env));console.log(JSON.stringify(result));}
main().catch(()=>{console.error('Проверка не выполнена. Проверьте настройки, доступ к провайдеру и подтверждение использования только синтетических данных.');process.exitCode=1;});
