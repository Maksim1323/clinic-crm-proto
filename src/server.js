'use strict';
const {createServer}=require('./app');
const port=Number(process.env.PORT)||10000;
let server;try{server=createServer();}catch(error){console.error('Запуск остановлен: настройте DATABASE_URL на Render.');process.exit(1);}
server.ready.then(()=>server.listen(port,'0.0.0.0',()=>console.log('Сервис запущен на порту '+port+' (только тестовые данные)')))
  .catch(()=>{console.error('Не удалось подключить хранилище: запуск остановлен. Проверьте настройки DATABASE_URL.');process.exitCode=1;});
