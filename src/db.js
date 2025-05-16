const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(__dirname, '../epictube.db'));

// Create tables if they don't exist
// Users
// Videos
// Comments
// Votes
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  username TEXT PRIMARY KEY,
  password TEXT NOT NULL,
  description TEXT,
  profilePic TEXT
);

CREATE TABLE IF NOT EXISTS videos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT,
  description TEXT,
  filename TEXT,
  url TEXT,
  owner TEXT,
  FOREIGN KEY(owner) REFERENCES users(username)
);

CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  videoId INTEGER,
  user TEXT,
  profilePic TEXT,
  text TEXT,
  timestamp TEXT,
  FOREIGN KEY(videoId) REFERENCES videos(id),
  FOREIGN KEY(user) REFERENCES users(username)
);

CREATE TABLE IF NOT EXISTS votes (
  videoId INTEGER,
  user TEXT,
  vote INTEGER,
  PRIMARY KEY(videoId, user),
  FOREIGN KEY(videoId) REFERENCES videos(id),
  FOREIGN KEY(user) REFERENCES users(username)
);
`);

module.exports = db;
