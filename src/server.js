'use strict';
const {createServer}=require('./app');
const port=Number(process.env.PORT)||10000;
let server;try{server=createServer();}catch(error){console.error('Запуск остановлен: настройте DATABASE_URL на Render.');process.exit(1);}
server.ready.then(()=>server.listen(port,'0.0.0.0',()=>console.log('Сервис запущен на порту '+port+' (только тестовые данные)')))
  .catch(error=>{const reason=/^(?:invalid_relational_[a-z_]+|relational_[a-z_]+|legacy_state_roundtrip_mismatch|unsupported_relational_schema)$/.test(error.message)?error.message:'storage_unavailable';console.error('Запуск остановлен: проверка хранилища не пройдена ('+reason+').');server.close();process.exitCode=1;});
