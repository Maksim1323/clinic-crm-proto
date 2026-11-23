'use strict';
const {createServer} = require('./app');
const port = Number(process.env.PORT) || 10000;
createServer().listen(port, '0.0.0.0', () => {
  console.log('Сервис запущен на порту ' + port + ' (только тестовые данные)');
});
