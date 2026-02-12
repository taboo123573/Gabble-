require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();

// 1. RADICAL CORS (Allows everything for debugging)
app.use(cors({
  origin: true, // Dynamically allow the origin of the request
  credentials: true,
  methods: ["GET", "POST"]
}));

app.use(express.json());

const server = http.createServer(app);

// 2. STRENGTHENED SOCKET.IO
const io = new Server(server, {
  cors: {
    origin: true,
    methods: ["GET", "POST"],
    credentials: true
  },
  allowEIO3: true, // Compatibility mode
  transports: ['polling', 'websocket'] // Force polling first to establish CORS
});

// 3. MONGODB (Non-blocking)
const uri = process.env.MONGODB_URI;
mongoose.connect(uri)
  .then(() => console.log("MongoDB Connected ✅"))
  .catch(err => console.log("MongoDB Error ❌: ", err.message));

// ... keep your routes and socket logic below ...

// --- 4. DATA SCHEMA ---
const UserSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  password: { type: String, required: true }
});
const User = mongoose.model('User', UserSchema);

// --- 5. ROUTES ---

// Health Check (To see if server is alive)
app.get("/", (req, res) => {
  res.send("<h1>Server is Live and Running 🚀</h1>");
});

app.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Missing fields" });

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({ username, password: hashedPassword });
    await newUser.save();
    res.json({ message: "User registered successfully!" });
  } catch (e) {
    res.status(400).json({ error: "Username already taken" });
  }
});

app.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user) return res.status(400).json({ error: "User not found" });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(400).json({ error: "Wrong password" });

    const token = jwt.sign({ username: user.username }, process.env.JWT_SECRET || 'fallback_secret');
    res.json({ token, username: user.username });
  } catch (e) {
    res.status(500).json({ error: "Server error during login" });
  }
});

// --- 6. SOCKET LOGIC ---
const voiceRooms = {}; 

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
  
  socket.on('send_message', (data) => {
    socket.to(data.room).emit('receive_message', data);
  });

  socket.on('join_voice', ({ roomId, peerId, username }) => {
    removeUserFromVoice(socket.id);
    if (!voiceRooms[roomId]) voiceRooms[roomId] = [];
    voiceRooms[roomId].push({ username, peerId, socketId: socket.id });
    socket.join(roomId);
    io.emit('voice_users_update', { roomId, users: voiceRooms[roomId] });
    socket.to(roomId).emit('user_connected', peerId);
  });

  socket.on('leave_voice', () => removeUserFromVoice(socket.id));
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    removeUserFromVoice(socket.id);
  });
});

// --- 7. START SERVER ---
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`SERVER RUNNING ON PORT ${PORT}`);
});