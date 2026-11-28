'use strict';
// Compatibility entry point for existing deployments that run `node server.js`.
const {createServer} = require('./src/app');
if (require.main === module) require('./src/server');
module.exports = {createServer};
