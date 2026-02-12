require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();

// --- 1. ALLOW EVERYONE (Debug Mode) ---
app.use(cors({
  origin: "*", 
  methods: ["GET", "POST"],
  credentials: true
}));
app.use(express.json());

const server = http.createServer(app);

// --- 2. SOCKET.IO SETUP ---
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['polling', 'websocket'] // Force polling first (safest)
});

// --- 3. DATABASE CONNECTION (Crash-Proof) ---
const mongoURI = process.env.MONGODB_URI;

if (!mongoURI) {
  console.error("❌ FATAL: MONGODB_URI is missing! Check Koyeb Secrets.");
} else {
  // Mask the password in logs so we can see if the format is wrong
  const maskedURI = mongoURI.replace(/:([^@]+)@/, ":****@");
  console.log(`🔌 Attempting to connect to MongoDB: ${maskedURI}`);

  mongoose.connect(mongoURI)
    .then(() => console.log("✅ MongoDB Connected Successfully!"))
    .catch(err => {
      console.error("❌ MongoDB Connection Error:", err.message);
      console.error("👉 HINT: Check for spaces at the start/end of your Koyeb Variable.");
    });
}

// --- 4. DATA MODELS ---
const UserSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  password: { type: String, required: true }
});
const User = mongoose.model('User', UserSchema);

// --- 5. DEBUG ROUTE (The "I am Alive" check) ---
app.get("/", (req, res) => {
  res.send(`<h1>Server is Running! 🚀</h1><p>MongoDB Status: ${mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected'}</p>`);
});

// --- 6. AUTH ROUTES ---
app.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Missing fields" });
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({ username, password: hashedPassword });
    await newUser.save();
    res.json({ message: "User created" });
  } catch (e) {
    res.status(400).json({ error: "Username taken or DB error" });
  }
});

app.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user) return res.status(400).json({ error: "User not found" });
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(400).json({ error: "Wrong password" });
    const token = jwt.sign({ username: user.username }, process.env.JWT_SECRET || 'secret');
    res.json({ token, username: user.username });
  } catch (e) {
    res.status(500).json({ error: "Login failed" });
  }
});

// --- 7. SOCKET LOGIC ---
io.on('connection', (socket) => {
  console.log(`User Connected: ${socket.id}`);
  
  socket.on('join_room', (room) => socket.join(room));
  socket.on('send_message', (data) => socket.to(data.room).emit('receive_message', data));
  
  socket.on('disconnect', () => console.log(`User Disconnected: ${socket.id}`));
});

// --- 8. START SERVER ---
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`✅ SERVER RUNNING ON PORT ${PORT}`);
});