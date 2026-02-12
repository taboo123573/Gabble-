require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose'); // New library

const app = express();
// server/index.js

app.use(cors({
  origin: "*", // This allows all origins (e.g., your phone, local pc, or a deployed site)
  methods: ["GET", "POST"],
  credentials: true
}));
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

// --- MONGODB CONNECTION ---
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log("Connected to MongoDB Atlas! ✅"))
  .catch(err => console.error("MongoDB Connection Error: ", err));

// --- USER MODEL (The Structure) ---
const UserSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  password: { type: String, required: true }
});
const User = mongoose.model('User', UserSchema);

// --- AUTHENTICATION ---
app.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({ username, password: hashedPassword });
    await newUser.save();
    res.json({ message: "User registered in MongoDB!" });
  } catch (e) {
    res.status(400).json({ error: "Username already taken" });
  }
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await User.findOne({ username });
  if (!user) return res.status(400).json({ error: "User not found" });

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(400).json({ error: "Wrong password" });

  const token = jwt.sign({ username: user.username }, process.env.JWT_SECRET);
  res.json({ token, username: user.username });
});

// --- SOCKET LOGIC (Remains exactly the same) ---
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
server.listen(PORT, () => console.log(`SERVER RUNNING ON PORT ${PORT}`));