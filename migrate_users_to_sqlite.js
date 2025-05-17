// migrate_users_to_sqlite.js
const fs = require('fs');
const path = require('path');
const db = require('./src/db');
const bcrypt = require('bcryptjs');

const USERS_DIR = path.join(__dirname, 'users');

function isBcryptHash(str) {
  return typeof str === 'string' && str.startsWith('$2') && str.length >= 60;
}

fs.readdirSync(USERS_DIR).forEach(file => {
  if (!file.endsWith('.txt')) return;
  const userDataRaw = fs.readFileSync(path.join(USERS_DIR, file), 'utf-8');
  let userData;
  try {
    userData = JSON.parse(userDataRaw);
  } catch (e) {
    // If not JSON, skip
    return;
  }
  let password = userData.password;
  if (!isBcryptHash(password)) {
    password = bcrypt.hashSync(password, 10);
  }
  db.prepare('INSERT INTO users (username, password, description, profilePic) VALUES (?, ?, ?, ?) ON CONFLICT(username) DO UPDATE SET password = excluded.password, description = excluded.description, profilePic = excluded.profilePic')
    .run(userData.username, password, userData.description || '', userData.profilePic || '');
  console.log('Migrated/Updated:', userData.username);
});

console.log('Migration complete.');
