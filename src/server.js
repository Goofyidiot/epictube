const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, '../data');
const VIDEOS_DIR = path.join(__dirname, '../videos');
const COMMENTS_DIR = path.join(__dirname, '../comments');
const USERS_DIR = path.join(__dirname, '../users');
const SRC_DIR = path.join(__dirname);
const PROFILEPICS_DIR = path.join(__dirname, '../profilepics');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(VIDEOS_DIR)) fs.mkdirSync(VIDEOS_DIR);
if (!fs.existsSync(COMMENTS_DIR)) fs.mkdirSync(COMMENTS_DIR);
if (!fs.existsSync(USERS_DIR)) fs.mkdirSync(USERS_DIR);
if (!fs.existsSync(PROFILEPICS_DIR)) fs.mkdirSync(PROFILEPICS_DIR);

app.use(cors());
app.use(express.json());
app.use(session({
  secret: 'epictube_secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false }
}));
app.use('/videos', express.static(VIDEOS_DIR));
app.use('/thumbnails', express.static(path.join(__dirname, '../thumbnails')));
app.use('/profilepics', express.static(PROFILEPICS_DIR));
app.use(express.static(SRC_DIR)); // Serve index.html and static files

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, VIDEOS_DIR),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

const profilePicUpload = multer.diskStorage({
  destination: (req, file, cb) => cb(null, PROFILEPICS_DIR),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const uploadProfilePic = multer({ storage: profilePicUpload });

// Helper: get video score
function getVideoScore(id) {
  const vfile = path.join(DATA_DIR, id + '.votes.txt');
  if (!fs.existsSync(vfile)) return 0;
  const votes = JSON.parse(fs.readFileSync(vfile, 'utf-8'));
  let score = 0;
  for (const v of Object.values(votes)) score += v;
  return score;
}

// Register
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing fields' });
  const exists = db.prepare('SELECT 1 FROM users WHERE username = ?').get(username);
  if (exists) return res.status(409).json({ error: 'User exists' });
  const hash = await bcrypt.hash(password, 10);
  db.prepare('INSERT INTO users (username, password, description, profilePic) VALUES (?, ?, ?, ?)')
    .run(username, hash, '', '');
  req.session.user = username;
  res.json({ username });
});

// Login
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (!(await bcrypt.compare(password, user.password))) return res.status(401).json({ error: 'Invalid password' });
  req.session.user = username;
  res.json({ username });
});

// Logout
app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// Get current user
app.get('/api/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
  const user = db.prepare('SELECT username, description, profilePic FROM users WHERE username = ?').get(req.session.user);
  res.json(user);
});

// Update profile (support image upload)
app.post('/api/me', uploadProfilePic.single('profilePicFile'), (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(req.session.user);
  const description = req.body.description || user.description;
  let profilePic = user.profilePic;
  if (req.file) {
    profilePic = '/profilepics/' + req.file.filename;
  } else if (req.body.profilePic) {
    profilePic = req.body.profilePic;
  }
  db.prepare('UPDATE users SET description = ?, profilePic = ? WHERE username = ?')
    .run(description, profilePic, req.session.user);
  res.json({ ok: true });
});

// Delete account
app.post('/api/delete-account', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
  const username = req.session.user;
  // Delete user's videos
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  user.videos.forEach(id => {
    const vfile = path.join(DATA_DIR, id + '.txt');
    const vdata = fs.existsSync(vfile) ? JSON.parse(fs.readFileSync(vfile, 'utf-8')) : null;
    if (vdata && vdata.filename) {
      const vpath = path.join(VIDEOS_DIR, vdata.filename);
      if (fs.existsSync(vpath)) fs.unlinkSync(vpath);
    }
    if (fs.existsSync(vfile)) fs.unlinkSync(vfile);
    const cfile = path.join(COMMENTS_DIR, id + '.txt');
    if (fs.existsSync(cfile)) fs.unlinkSync(cfile);
    const vvotes = path.join(DATA_DIR, id + '.votes.txt');
    if (fs.existsSync(vvotes)) fs.unlinkSync(vvotes);
  });
  // Delete user from database
  db.prepare('DELETE FROM users WHERE username = ?').run(username);
  req.session.destroy(() => res.json({ ok: true }));
});

// List videos
app.get('/api/videos', (req, res) => {
  const videos = db.prepare('SELECT *, (SELECT IFNULL(SUM(vote),0) FROM votes WHERE videoId = videos.id) as score FROM videos').all();
  res.json(videos);
});

// Get single video metadata
app.get('/api/videos/:id', (req, res) => {
  const video = db.prepare('SELECT *, (SELECT IFNULL(SUM(vote),0) FROM votes WHERE videoId = videos.id) as score FROM videos WHERE id = ?').get(req.params.id);
  if (!video) return res.status(404).json({ error: 'Video not found' });
  res.json(video);
});

// Upload video (authenticated)
app.post('/api/upload', upload.single('video'), (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
  const { title, description } = req.body;
  if (!req.file) return res.status(400).json({ error: 'No video file uploaded' });
  const stmt = db.prepare('INSERT INTO videos (title, description, filename, url, owner) VALUES (?, ?, ?, ?, ?)');
  const info = stmt.run(title, description, req.file.filename, `/videos/${req.file.filename}`, req.session.user);
  const videoMeta = db.prepare('SELECT * FROM videos WHERE id = ?').get(info.lastInsertRowid);
  res.json(videoMeta);
});

// Delete video (authenticated, owner only)
app.post('/api/videos/:id/delete', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
  const file = path.join(DATA_DIR, req.params.id + '.txt');
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Video not found' });
  const video = JSON.parse(fs.readFileSync(file, 'utf-8'));
  if (video.owner !== req.session.user) return res.status(403).json({ error: 'Not your video' });
  // Remove video file
  const vpath = path.join(VIDEOS_DIR, video.filename);
  if (fs.existsSync(vpath)) fs.unlinkSync(vpath);
  // Remove video metadata
  fs.unlinkSync(file);
  // Remove from user's list
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(req.session.user);
  user.videos = user.videos.filter(id => id !== req.params.id);
  db.prepare('UPDATE users SET videos = ? WHERE username = ?')
    .run(JSON.stringify(user.videos), req.session.user);
  // Remove comments
  const cfile = path.join(COMMENTS_DIR, req.params.id + '.txt');
  if (fs.existsSync(cfile)) fs.unlinkSync(cfile);
  // Remove votes
  const vvotes = path.join(DATA_DIR, req.params.id + '.votes.txt');
  if (fs.existsSync(vvotes)) fs.unlinkSync(vvotes);
  res.json({ ok: true });
});

// Edit video (authenticated, owner only)
app.post('/api/videos/:id/edit', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
  const file = path.join(DATA_DIR, req.params.id + '.txt');
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Video not found' });
  const video = JSON.parse(fs.readFileSync(file, 'utf-8'));
  if (video.owner !== req.session.user) return res.status(403).json({ error: 'Not your video' });
  video.title = req.body.title || video.title;
  video.description = req.body.description || video.description;
  fs.writeFileSync(file, JSON.stringify(video));
  res.json({ ok: true });
});

// Comments API
app.get('/api/videos/:id/comments', (req, res) => {
  const comments = db.prepare('SELECT * FROM comments WHERE videoId = ? ORDER BY id ASC').all(req.params.id);
  res.json(comments);
});

// Comments API (authenticated)
app.post('/api/videos/:id/comments', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(req.session.user);
  const stmt = db.prepare('INSERT INTO comments (videoId, user, profilePic, text, timestamp) VALUES (?, ?, ?, ?, ?)');
  const info = stmt.run(
    req.params.id,
    req.session.user,
    user.profilePic,
    req.body.text,
    new Date().toISOString()
  );
  const comment = db.prepare('SELECT * FROM comments WHERE id = ?').get(info.lastInsertRowid);
  res.json(comment);
});

// Voting System
// Get votes for a video
app.get('/api/videos/:id/votes', (req, res) => {
  const votes = db.prepare('SELECT user, vote FROM votes WHERE videoId = ?').all(req.params.id);
  let score = 0;
  let userVote = 0;
  for (const v of votes) {
    score += v.vote;
    if (req.session.user && v.user === req.session.user) userVote = v.vote;
  }
  res.json({ score, userVote });
});

// Vote on a video (upvote: 1, downvote: -1, remove: 0)
app.post('/api/videos/:id/votes', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
  const { vote } = req.body; // 1, -1, or 0
  if (![1, -1, 0].includes(vote)) return res.status(400).json({ error: 'Invalid vote' });
  if (vote === 0) {
    db.prepare('DELETE FROM votes WHERE videoId = ? AND user = ?').run(req.params.id, req.session.user);
  } else {
    db.prepare('INSERT INTO votes (videoId, user, vote) VALUES (?, ?, ?) ON CONFLICT(videoId, user) DO UPDATE SET vote = excluded.vote')
      .run(req.params.id, req.session.user, vote);
  }
  // Return updated score and userVote
  const votes = db.prepare('SELECT user, vote FROM votes WHERE videoId = ?').all(req.params.id);
  let score = 0;
  let userVote = 0;
  for (const v of votes) {
    score += v.vote;
    if (req.session.user && v.user === req.session.user) userVote = v.vote;
  }
  res.json({ score, userVote });
});

// Serve index.html for root
app.get('/', (req, res) => {
  res.sendFile(path.join(SRC_DIR, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
