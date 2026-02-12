require('dotenv').config();
const express = require('express');
const http = require('http'); // Standard HTTP module
const { Server } = require("socket.io");
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();

// 1. Basic CORS for API Routes
app.use(cors({ origin: "*" })); 
app.use(express.json());

// 2. Create the HTTP Server explicitly
const server = http.createServer(app);

// 3. Attach Socket.io with Permissive CORS
const io = new Server(server, {
  cors: {
    origin: "*", // Allow any origin (Browser, Mobile, Postman)
    methods: ["GET", "POST"]
  }
});

// 4. Connect Database
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch(err => console.log("❌ DB Error:", err.message));

// 5. Basic Routes
app.get("/", (req, res) => res.send("Server is Running"));

// 6. Socket Logic
io.on("connection", (socket) => {
  console.log("⚡ New User Connected:", socket.id);

  socket.on("join_room", (room) => {
    socket.join(room);
    console.log(`User ${socket.id} joined room: ${room}`);
  });

  socket.on("send_message", (data) => {
    socket.to(data.room).emit("receive_message", data);
  });

  socket.on("disconnect", () => console.log("User Disconnected", socket.id));
});

// 7. LISTEN ON PORT (Crucial Step)
const PORT = process.env.PORT || 8000; // Koyeb often prefers 8000
server.listen(PORT, () => {
  console.log(`🚀 SERVER RUNNING ON PORT ${PORT}`);
});