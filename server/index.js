require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const crypto = require('crypto'); // Built-in Node module for encryption

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

// --- ENCRYPTION SETTINGS ---
// MUST be 32 characters long for AES-256
const password = process.env.ENCRYPTION_PASS || 'default-password';
const ENCRYPTION_KEY = crypto.scryptSync(password, 'salt', 32);
const IV_LENGTH = 16; // For AES, this is always 16

// Helper: Encrypt text
function encrypt(text) {
  let iv = crypto.randomBytes(IV_LENGTH);
  let cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

// Helper: Decrypt text
function decrypt(text) {
  let textParts = text.split(':');
  let iv = Buffer.from(textParts.shift(), 'hex');
  let encryptedText = Buffer.from(textParts.join(':'), 'hex');
  let decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
  let decrypted = decipher.update(encryptedText);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString();
}

// --- PERSISTENT DATABASE ---
const DATA_FILE = './users_v2.encrypted'; // Changed extension to show it's encrypted
let users = [];

// 1. Load users (Decrypting on read)
if (fs.existsSync(DATA_FILE)) {
  try {
    const rawData = fs.readFileSync(DATA_FILE, 'utf8');
    // If the file is empty or just initialized, handle gracefully
    if (rawData) {
      const jsonString = decrypt(rawData);
      users = JSON.parse(jsonString);
    }
    console.log(`[SECURE LOAD] Decrypted ${users.length} users.`);
  } catch (e) { 
    console.log("Error decrypting/loading users. File might be corrupt or key changed.", e); 
    users = []; // Reset if decryption fails
  }
}

// 2. Save users (Encrypting on write)
const saveUsers = () => {
  const jsonString = JSON.stringify(users, null, 2);
  const encryptedData = encrypt(jsonString);
  fs.writeFileSync(DATA_FILE, encryptedData);
  console.log("[SECURE SAVE] Database encrypted and saved.");
};

const voiceRooms = {}; 

// --- AUTHENTICATION ---
app.post('/register', async (req, res) => {
  const { username, password } = req.body;
  
  if (users.find(u => u.username === username)) {
    return res.status(400).json({ error: "User already exists" });
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  users.push({ username, password: hashedPassword });
  saveUsers(); // <--- Encrypts entire file now
  res.json({ message: "User created!" });
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const user = users.find(u => u.username === username);
  if (!user) return res.status(400).json({ error: "User not found" });

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(400).json({ error: "Wrong password" });

  const token = jwt.sign({ username }, process.env.JWT_SECRET);
  res.json({ token, username });
});

// --- SOCKET LOGIC ---
const removeUserFromVoice = (socketId) => {
  for (const roomId in voiceRooms) {
    const initialLength = voiceRooms[roomId].length;
    voiceRooms[roomId] = voiceRooms[roomId].filter(u => u.socketId !== socketId);
    if (voiceRooms[roomId].length < initialLength) {
      io.emit('voice_users_update', { roomId, users: voiceRooms[roomId] });
    }
  }
};

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  socket.on('join_room', (room) => socket.join(room));
  
  socket.on('send_message', (data) => socket.to(data.room).emit('receive_message', data));

  socket.on('join_voice', ({ roomId, peerId, username }) => {
    removeUserFromVoice(socket.id);
    if (!voiceRooms[roomId]) voiceRooms[roomId] = [];
    voiceRooms[roomId].push({ username, peerId, socketId: socket.id });
    socket.join(roomId);
    io.emit('voice_users_update', { roomId, users: voiceRooms[roomId] });
    socket.to(roomId).emit('user_connected', peerId);
  });

  socket.on('leave_voice', () => removeUserFromVoice(socket.id));
  socket.on('disconnect', () => removeUserFromVoice(socket.id));
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`SERVER RUNNING ON PORT ${PORT}`);
});