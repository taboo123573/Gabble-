require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();

// --- 1. ALLOW EVERYTHING (CORS) ---
app.use(cors({ origin: "*" })); 
app.use(express.json());

// --- 2. LOG EVERY REQUEST (Debug) ---
app.use((req, res, next) => {
  console.log(`[REQUEST] ${req.method} ${req.url}`);
  next();
});

const server = http.createServer(app);

// --- 3. SOCKET.IO (The "Fix") ---
const io = new Server(server, {
  cors: {
    origin: "*", // Allow local and production
    methods: ["GET", "POST"]
  },
  transports: ['polling', 'websocket'] // Force support for both
});

// --- 4. DATABASE ---
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch(err => console.error("❌ MongoDB Error:", err.message));

// --- 5. ROUTES ---
const UserSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  password: { type: String, required: true }
});
const User = mongoose.model('User', UserSchema);

app.get("/", (req, res) => res.send("Server is Running 🚀"));

app.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({ username, password: hashedPassword });
    await newUser.save();
    res.json({ message: "User registered" });
  } catch (e) {
    res.status(400).json({ error: "Username taken" });
  }
});

app.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(400).json({ error: "Invalid credentials" });
    }
    const token = jwt.sign({ username }, process.env.JWT_SECRET || 'secret');
    res.json({ token, username });
  } catch (e) {
    res.status(500).json({ error: "Login error" });
  }
});

// --- 6. SOCKET LOGIC ---
io.on('connection', (socket) => {
  console.log(`⚡ User Connected: ${socket.id}`);
  
  socket.on('join_room', (room) => socket.join(room));
  
  socket.on('send_message', (data) => {
    console.log(`📩 Message: ${data.message}`);
    socket.to(data.room).emit('receive_message', data);
  });
  
  socket.on('disconnect', () => console.log(`❌ Disconnected: ${socket.id}`));
});

// --- 7. START SERVER ---
const PORT = process.env.PORT || 8000;
server.listen(PORT, () => {
  console.log(`🚀 SERVER RUNNING ON PORT ${PORT}`);
});