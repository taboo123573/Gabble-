require('dotenv').config();
const express = require('express');
const { Server } = require("socket.io");
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 8000;

// --- 1. CONFIGURATION ---
const allowedOrigins = [
  "http://localhost:5173",
  "https://positive-joy-talksy-02653a35.koyeb.app" // YOUR REAL URL
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) callback(null, true);
    else callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ["GET", "POST"]
}));
app.use(express.json());

// --- 2. START SERVER ---
const expressServer = app.listen(PORT, () => {
  console.log(`🚀 SERVER RUNNING ON PORT ${PORT}`);
});

// --- 3. SOCKET SETUP ---
const io = new Server(expressServer, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['polling', 'websocket'],
  path: '/socket.io/'
});

// --- 4. DATABASE ---
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch(err => console.log("❌ DB Error:", err.message));

// User Model
const UserSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  password: { type: String, required: true }
});
const User = mongoose.model('User', UserSchema);

// --- 5. ROUTES ---
app.get("/", (req, res) => res.send("Server Online"));

app.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({ username, password: hashedPassword });
    await newUser.save();
    res.json({ message: "User registered" });
  } catch (e) { res.status(400).json({ error: "Username taken" }); }
});

app.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user || !(await bcrypt.compare(password, user.password))) return res.status(400).json({ error: "Invalid credentials" });
    const token = jwt.sign({ username }, process.env.JWT_SECRET || 'secret');
    res.json({ token, username });
  } catch (e) { res.status(500).json({ error: "Login failed" }); }
});

// --- 6. VOICE ROOM LOGIC (THE FIX) ---
const voiceRooms = {}; // Stores { "Lobby": [{username, peerId, socketId}] }

const removeUserFromVoice = (socketId) => {
  for (const roomId in voiceRooms) {
    const initialLength = voiceRooms[roomId].length;
    // Filter out the user who left
    voiceRooms[roomId] = voiceRooms[roomId].filter(u => u.socketId !== socketId);
    
    // If someone was actually removed, tell everyone in that room
    if (voiceRooms[roomId].length < initialLength) {
      io.emit('voice_users_update', { roomId, users: voiceRooms[roomId] });
    }
  }
};

io.on('connection', (socket) => {
  console.log(`⚡ User Connected: ${socket.id}`);

  // Text Chat
  socket.on('join_room', (room) => socket.join(room));
  // --- INSIDE server/index.js ---

  socket.on('send_message', (data) => {
    // 1. THE FIX: Parse data if it arrives as a string
    if (typeof data === 'string') {
      try { data = JSON.parse(data); } catch(e){}
    }
    
    // 2. Debug Log (Optional: Helps you see if it arrives)
    console.log(`📩 Message from ${data.author} to ${data.room}: ${data.message}`);

    // 3. Broadcast
    socket.to(data.room).emit('receive_message', data);
  });

  // Voice Chat (Logic Restored!)
  socket.on('join_voice', ({ roomId, peerId, username }) => {
    // 1. Make sure they leave other voice channels first
    removeUserFromVoice(socket.id);

    // 2. Add to new room
    if (!voiceRooms[roomId]) voiceRooms[roomId] = [];
    voiceRooms[roomId].push({ username, peerId, socketId: socket.id });

    // 3. Tell everyone "Here is the new list of users for this room"
    io.emit('voice_users_update', { roomId, users: voiceRooms[roomId] });

    // 4. Signal other peers to connect audio
    socket.to(roomId).emit('user_connected', peerId);
    socket.join(roomId);
  });

  socket.on('leave_voice', () => {
    removeUserFromVoice(socket.id);
  });

  socket.on('disconnect', () => {
    console.log(`❌ Disconnected: ${socket.id}`);
    removeUserFromVoice(socket.id);
  });
});