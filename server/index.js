require('dotenv').config();
const express = require('express');
const { Server } = require("socket.io");
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 8000;

// --- 1. DEFINE ALLOWED ORIGINS ---
// This includes your Localhost AND your Production URL
const allowedOrigins = [
  "http://localhost:5173",                      // Your Local React App
  "https://positive-joy-talksy-02653a35.koyeb.app" // Your Public App
];

// --- 2. CONFIGURE CORS FOR EXPRESS ---
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) === -1) {
      const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  },
  credentials: true, // This matches the client setting
  methods: ["GET", "POST", "OPTIONS"]
}));

app.use(express.json());

// --- 3. START SERVER ---
const expressServer = app.listen(PORT, () => {
  console.log(`🚀 SERVER RUNNING ON PORT ${PORT}`);
});

// --- 4. CONFIGURE SOCKET.IO CORS ---
const io = new Server(expressServer, {
  cors: {
    origin: allowedOrigins, // Use the same specific list
    methods: ["GET", "POST"],
    credentials: true // This MUST match the client
  },
  transports: ['polling', 'websocket'],
  path: '/socket.io/'
});

// --- 5. DATABASE ---
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch(err => console.log("❌ DB Error:", err.message));

// --- 6. ROUTES ---
// User Model
const UserSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  password: { type: String, required: true }
});
const User = mongoose.model('User', UserSchema);

app.get("/", (req, res) => res.send("Server is Online 🟢"));

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
    res.status(500).json({ error: "Login failed" });
  }
});

// --- 7. SOCKET LOGIC ---
io.on('connection', (socket) => {
  console.log(`⚡ User Connected: ${socket.id}`);
  socket.on('disconnect', () => console.log(`❌ Disconnected: ${socket.id}`));
  socket.on('join_room', (room) => socket.join(room));
  socket.on('send_message', (data) => socket.to(data.room).emit('receive_message', data));
});