require('dotenv').config();
const express = require('express');
const { Server } = require("socket.io"); // Socket.io Import
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 8000;

// --- 1. CONFIGURATION ---
app.use(cors({ origin: "*" })); // Allow all origins
app.use(express.json());

// --- 2. START LISTENING FIRST ---
// We start the server and capture the "expressServer" instance
const expressServer = app.listen(PORT, () => {
  console.log(`🚀 SERVER RUNNING ON PORT ${PORT}`);
});

// --- 3. ATTACH SOCKET.IO TO THAT INSTANCE ---
const io = new Server(expressServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  transports: ['polling', 'websocket'], // Force polling support
  path: '/socket.io/' // Explicitly set the path
});

// --- 4. DEBUGGING: SOCKET.IO CONNECTION ---
io.on('connection', (socket) => {
  console.log(`⚡ SOCKET CONNECTED: ${socket.id}`);
  
  socket.on('disconnect', () => {
    console.log(`❌ SOCKET DISCONNECTED: ${socket.id}`);
  });
});

// --- 5. DATABASE CONNECTION ---
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch(err => console.log("❌ DB Error:", err.message));

// --- 6. SIMPLE TEST ROUTE ---
app.get("/", (req, res) => {
  res.send("<h1>Server is working</h1>");
});