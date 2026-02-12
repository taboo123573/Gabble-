import { useState, useEffect, useRef } from "react";
import io from "socket.io-client";
import axios from "axios";
import Peer from "peerjs"; 
import { motion, AnimatePresence } from "framer-motion";
import { Hash, Volume2, Mic, MicOff, Headphones, VolumeX, Signal, Settings, PhoneOff } from "lucide-react";
import "./App.css";

// ⚠️ YOUR REAL URL
const SERVER_URL = "https://positive-joy-talksy-02653a35.koyeb.app"; 

const socket = io(SERVER_URL, {
  path: '/socket.io/',
  transports: ["polling"],
  withCredentials: true,
  autoConnect: true
});

function App() {
  const [token, setToken] = useState(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isRegistering, setIsRegistering] = useState(false); // New: Toggle Login/Register
  
  // Random ID generated once
  const [discriminator] = useState(Math.floor(1000 + Math.random() * 9000));

  const [activeChannel, setActiveChannel] = useState("General");
  const [activeVoice, setActiveVoice] = useState(null);
  const [message, setMessage] = useState("");
  const [messageList, setMessageList] = useState([]);
  
  // Voice State
  const [voiceUsers, setVoiceUsers] = useState({}); // Stores users in each channel
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);
  const [myPeerId, setMyPeerId] = useState(null);
  
  const peerInstance = useRef(null);
  const myStreamRef = useRef(null);
  const incomingAudioRefs = useRef({});

  // --- SETUP ---
  useEffect(() => {
    const peer = new Peer();
    peer.on('open', (id) => setMyPeerId(id));
    
    peer.on('call', (call) => {
      navigator.mediaDevices.getUserMedia({ video: false, audio: true }).then((stream) => {
        call.answer(stream);
        call.on('stream', (remoteStream) => handleRemoteStream(remoteStream, call.peer));
      });
    });
    peerInstance.current = peer;

    // Socket Listeners
    socket.on('receive_message', (data) => setMessageList((list) => [...list, data]));
    
    // UPDATE: Listen for who is in which channel
    socket.on('voice_users_update', ({ roomId, users }) => {
      setVoiceUsers((prev) => ({ ...prev, [roomId]: users }));
    });

    return () => { 
      socket.off('receive_message');
      socket.off('voice_users_update');
    };
  }, []);

  // --- AUDIO LOGIC ---
  const handleRemoteStream = (stream, peerId) => {
    const audio = document.createElement('audio');
    audio.srcObject = stream;
    audio.play();
    incomingAudioRefs.current[peerId] = audio;
  };

  const stopMicrophone = () => {
    if (myStreamRef.current) {
      // This actually kills the hardware light
      myStreamRef.current.getTracks().forEach(track => track.stop());
      myStreamRef.current = null;
    }
  };

  const toggleMute = () => {
    const newState = !isMuted;
    setIsMuted(newState);
    if (myStreamRef.current) {
      myStreamRef.current.getAudioTracks()[0].enabled = !newState;
    }
  };

  const toggleDeafen = () => {
    const newState = !isDeafened;
    setIsDeafened(newState);
    Object.values(incomingAudioRefs.current).forEach(a => a.muted = newState);
    if (!isDeafened) toggleMute(); // Auto-mute if deafening
  };

  // --- ACTIONS ---
  const joinVoice = (channel) => {
    if (activeVoice === channel) return;
    
    // Stop previous mic if switching channels
    stopMicrophone();

    setActiveVoice(channel);
    
    navigator.mediaDevices.getUserMedia({audio: true}).then(stream => {
      myStreamRef.current = stream;
      stream.getAudioTracks()[0].enabled = !isMuted;

      // Tell server we joined so others can see us
      socket.emit('join_voice', { roomId: channel, peerId: myPeerId, username });
      
      socket.on('user_connected', (newUserId) => {
        const call = peerInstance.current.call(newUserId, stream);
        call.on('stream', (remoteStream) => handleRemoteStream(remoteStream, newUserId));
      });
    }).catch(err => console.error("Mic Error:", err));
  };

  const leaveVoice = () => {
    if (activeVoice) {
      socket.emit('leave_voice');
      stopMicrophone(); // FIX: Stops the mic immediately
      setActiveVoice(null);
      // Cleanup audio elements
      Object.values(incomingAudioRefs.current).forEach(a => { a.pause(); a.srcObject = null; });
      incomingAudioRefs.current = {};
    }
  };

  const auth = async () => {
    const endpoint = isRegistering ? "register" : "login";
    try {
      const res = await axios.post(`${SERVER_URL}/${endpoint}`, { username, password });
      if (isRegistering) {
        alert("Registered! Now Login.");
        setIsRegistering(false);
      } else {
        setToken(res.data.token);
        setUsername(res.data.username);
      }
    } catch (e) { alert(e.response?.data?.error || "Auth Failed"); }
  };

  const sendMessage = () => {
    if (message.trim()) {
      const msgData = { room: activeChannel, author: username, message, time: new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) };
      socket.emit("send_message", msgData);
      setMessageList(list => [...list, msgData]);
      setMessage("");
    }
  };

  // --- RENDER: LOGIN ---
  if (!token) return (
    <div className="login-wrapper">
      <div className="login-box">
        <h2>{isRegistering ? "Create an Account" : "Welcome Back!"}</h2>
        <p style={{color:'#b5bac1', textAlign:'center', marginBottom:'20px'}}>
          {isRegistering ? "Join the community today." : "We're so excited to see you again!"}
        </p>
        
        <div className="input-group">
          <label>USERNAME</label>
          <input onChange={e=>setUsername(e.target.value)} />
        </div>
        <div className="input-group">
          <label>PASSWORD</label>
          <input type="password" onChange={e=>setPassword(e.target.value)} />
        </div>
        
        <button className="login-btn" onClick={auth}>
          {isRegistering ? "Register" : "Log In"}
        </button>
        
        <div style={{marginTop:'15px', fontSize:'12px', color:'#949ba4'}}>
            {isRegistering ? "Already have an account?" : "Need an account?"} 
            <span 
              style={{color:'#00a8fc', cursor:'pointer', marginLeft:'5px'}} 
              onClick={() => setIsRegistering(!isRegistering)}
            >
              {isRegistering ? "Log In" : "Register"}
            </span>
        </div>
      </div>
    </div>
  );

  // --- RENDER: APP ---
  return (
    <div className="app-layout">
      {/* 1. SERVER SIDEBAR */}
      <div className="server-sidebar">
        <div className="server-icon active">D</div>
        <div className="server-hr"></div>
        <div className="server-icon">+</div>
      </div>

      {/* 2. CHANNEL SIDEBAR */}
      <div className="channel-sidebar">
        <div className="server-header">Discord Clone</div>
        
        <div className="channel-scroller">
          <div className="category-label">TEXT CHANNELS</div>
          {["General", "Gaming", "Music"].map(c => (
            <div key={c} className={`channel-item ${activeChannel===c ? 'selected' : ''}`} onClick={() => setActiveChannel(c)}>
              <Hash size={20} color="#80848e" /> {c}
            </div>
          ))}

          <div className="category-label">VOICE CHANNELS</div>
          {["Lobby", "Gaming"].map(c => (
            <div key={c}>
              <div className={`channel-item ${activeVoice===c ? 'selected' : ''}`} onClick={() => joinVoice(c)}>
                <Volume2 size={20} color="#80848e" /> {c}
              </div>
              
              {/* FIX: RENDER USERS INSIDE THE CHANNEL LIST */}
              <div style={{paddingLeft:'15px'}}>
                <AnimatePresence>
                  {voiceUsers[c]?.map(u => (
                    <motion.div 
                      key={u.peerId}
                      initial={{opacity:0, height:0}}
                      animate={{opacity:1, height:'auto'}}
                      exit={{opacity:0, height:0}}
                      style={{display:'flex', alignItems:'center', gap:'8px', padding:'4px', color:'#949ba4', fontSize:'13px'}}
                    >
                      <div style={{width:'24px', height:'24px', borderRadius:'50%', background:'#5865f2'}}></div>
                      {u.username}
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </div>
          ))}
        </div>

        {/* VOICE STATUS (Green Panel) */}
        {activeVoice && (
          <div className="voice-status-panel">
            <div className="signal-green"><Signal size={16}/> Voice Connected</div>
            <div className="channel-subtext">{activeVoice} / Cloud</div>
            <button className="disconnect-btn" onClick={leaveVoice}>
              <PhoneOff size={16}/> Disconnect
            </button>
          </div>
        )}

        {/* USER CONTROLS */}
        <div className="user-control-panel">
          <div className="user-avatar"></div>
          <div className="user-info">
            <div className="username">{username}</div>
            <div className="discriminator">#{discriminator}</div>
          </div>
          <div className="button-group">
            <button onClick={toggleMute} className={isMuted ? "control-btn active-red" : "control-btn"}>
              {isMuted ? <MicOff size={18}/> : <Mic size={18}/>}
            </button>
            <button onClick={toggleDeafen} className={isDeafened ? "control-btn active-red" : "control-btn"}>
              {isDeafened ? <VolumeX size={18}/> : <Headphones size={18}/>}
            </button>
            <button className="control-btn"><Settings size={18}/></button>
          </div>
        </div>
      </div>

      {/* 3. CHAT MAIN */}
      <div className="chat-main">
        <div className="chat-header">
          <Hash size={24} color="#80848e"/> 
          <h3>{activeChannel}</h3>
        </div>

        <div className="messages-container">
          {messageList.map((msg, i) => (
            <div key={i} className="message-row">
              <div className="message-avatar"></div>
              <div className="message-content">
                <div className="message-header">
                  <span className="msg-author">{msg.author}</span>
                  <span className="msg-time">{msg.time}</span>
                </div>
                <div className="msg-text">{msg.message}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="input-area">
          <div className="input-wrapper">
            <input 
              placeholder={`Message #${activeChannel}`} 
              value={message}
              onChange={e=>setMessage(e.target.value)}
              onKeyDown={e=>e.key==='Enter' && sendMessage()}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;