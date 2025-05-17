// reset_users_sqlite.js
const db = require('./src/db');
db.prepare('DELETE FROM users').run();
console.log('All users deleted from SQLite database.');
