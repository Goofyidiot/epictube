const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const session = require('express-session');

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

// Helper: get user file path
function getUserFile(username) {
  return path.join(USERS_DIR, username + '.txt');
}

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
  if (fs.existsSync(getUserFile(username))) return res.status(409).json({ error: 'User exists' });
  const hash = await bcrypt.hash(password, 10);
  const user = { username, password: hash, description: '', profilePic: '', videos: [] };
  fs.writeFileSync(getUserFile(username), JSON.stringify(user));
  req.session.user = username;
  res.json({ username });
});

// Login
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!fs.existsSync(getUserFile(username))) return res.status(404).json({ error: 'User not found' });
  const user = JSON.parse(fs.readFileSync(getUserFile(username), 'utf-8'));
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
  const user = JSON.parse(fs.readFileSync(getUserFile(req.session.user), 'utf-8'));
  res.json({ username: user.username, description: user.description, profilePic: user.profilePic });
});

// Update profile (support image upload)
app.post('/api/me', uploadProfilePic.single('profilePicFile'), (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
  const user = JSON.parse(fs.readFileSync(getUserFile(req.session.user), 'utf-8'));
  user.description = req.body.description || user.description;
  // If a new image was uploaded, update profilePic to the new file URL
  if (req.file) {
    user.profilePic = '/profilepics/' + req.file.filename;
  } else if (req.body.profilePic) {
    user.profilePic = req.body.profilePic;
  }
  fs.writeFileSync(getUserFile(user.username), JSON.stringify(user));
  res.json({ ok: true });
});

// Delete account
app.post('/api/delete-account', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
  const username = req.session.user;
  // Delete user's videos
  const user = JSON.parse(fs.readFileSync(getUserFile(username), 'utf-8'));
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
  // Delete user file
  fs.unlinkSync(getUserFile(username));
  req.session.destroy(() => res.json({ ok: true }));
});

// List videos
app.get('/api/videos', (req, res) => {
  fs.readdir(DATA_DIR, (err, files) => {
    if (err) return res.status(500).json({ error: 'Failed to read data directory' });
    const videos = files.filter(f => f.endsWith('.txt') && !f.endsWith('.votes.txt')).map(f => {
      const content = fs.readFileSync(path.join(DATA_DIR, f), 'utf-8');
      const video = JSON.parse(content);
      video.score = getVideoScore(video.id);
      return video;
    });
    res.json(videos);
  });
});

// Get single video metadata
app.get('/api/videos/:id', (req, res) => {
  const file = path.join(DATA_DIR, req.params.id + '.txt');
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Video not found' });
  const content = fs.readFileSync(file, 'utf-8');
  const video = JSON.parse(content);
  video.score = getVideoScore(video.id);
  res.json(video);
});

// Upload video (authenticated)
app.post('/api/upload', upload.single('video'), (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
  const { title, description } = req.body;
  if (!req.file) return res.status(400).json({ error: 'No video file uploaded' });
  const videoMeta = {
    id: Date.now().toString(),
    title,
    description,
    filename: req.file.filename,
    url: `/videos/${req.file.filename}`,
    owner: req.session.user
  };
  fs.writeFileSync(path.join(DATA_DIR, videoMeta.id + '.txt'), JSON.stringify(videoMeta));
  // Add video to user's list
  const userFile = path.join(__dirname, '../users', req.session.user + '.txt');
  const user = JSON.parse(fs.readFileSync(userFile, 'utf-8'));
  user.videos.push(videoMeta.id);
  fs.writeFileSync(userFile, JSON.stringify(user));
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
  const userFile = path.join(__dirname, '../users', req.session.user + '.txt');
  const user = JSON.parse(fs.readFileSync(userFile, 'utf-8'));
  user.videos = user.videos.filter(id => id !== req.params.id);
  fs.writeFileSync(userFile, JSON.stringify(user));
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
  const file = path.join(COMMENTS_DIR, req.params.id + '.txt');
  if (!fs.existsSync(file)) return res.json([]);
  const content = fs.readFileSync(file, 'utf-8');
  res.json(JSON.parse(content));
});

// Comments API (authenticated)
app.post('/api/videos/:id/comments', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
  const file = path.join(COMMENTS_DIR, req.params.id + '.txt');
  let comments = [];
  if (fs.existsSync(file)) {
    comments = JSON.parse(fs.readFileSync(file, 'utf-8'));
  }
  const userFile = path.join(__dirname, '../users', req.session.user + '.txt');
  const user = JSON.parse(fs.readFileSync(userFile, 'utf-8'));
  const comment = {
    id: Date.now().toString(),
    user: req.session.user,
    profilePic: user.profilePic,
    text: req.body.text,
    timestamp: new Date().toISOString()
  };
  comments.push(comment);
  fs.writeFileSync(file, JSON.stringify(comments));
  res.json(comment);
});

// Voting System
// Get votes for a video
app.get('/api/videos/:id/votes', (req, res) => {
  const vfile = path.join(DATA_DIR, req.params.id + '.votes.txt');
  if (!fs.existsSync(vfile)) return res.json({ score: 0, userVote: 0 });
  const votes = JSON.parse(fs.readFileSync(vfile, 'utf-8'));
  let score = 0;
  for (const v of Object.values(votes)) score += v;
  let userVote = 0;
  if (req.session.user && votes[req.session.user]) userVote = votes[req.session.user];
  res.json({ score, userVote });
});

// Vote on a video (upvote: 1, downvote: -1, remove: 0)
app.post('/api/videos/:id/votes', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
  const vfile = path.join(DATA_DIR, req.params.id + '.votes.txt');
  let votes = {};
  if (fs.existsSync(vfile)) votes = JSON.parse(fs.readFileSync(vfile, 'utf-8'));
  const { vote } = req.body; // 1, -1, or 0
  if (![1, -1, 0].includes(vote)) return res.status(400).json({ error: 'Invalid vote' });
  if (vote === 0) delete votes[req.session.user];
  else votes[req.session.user] = vote;
  fs.writeFileSync(vfile, JSON.stringify(votes));
  let score = 0;
  for (const v of Object.values(votes)) score += v;
  res.json({ score, userVote: votes[req.session.user] || 0 });
});

// Serve index.html for root
app.get('/', (req, res) => {
  res.sendFile(path.join(SRC_DIR, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
