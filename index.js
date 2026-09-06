const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });

const { createServer } = require('./src/server');
const { PORT } = require('./src/config');

const server = createServer();

server.listen(PORT, () => {
  console.log(`Status API listening on port ${PORT}`);
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled promise rejection:', error);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});

function shutdown() {
  console.log('Shutting down...');
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
