import { useState, useEffect, useRef } from "react";
import axios from "axios";
import Peer from "peerjs";
import { motion, AnimatePresence } from "framer-motion";
import { Hash, Volume2, Mic, MicOff, Headphones, VolumeX, Signal, Settings } from "lucide-react";
import "./App.css";

// --- 1. CONFIGURATION ---
// REPLACE THIS WITH YOUR ACTUAL KOYEB URL
import io from 'socket.io-client';

// 1. Define the URL
const SERVER_URL = "https://funny-name-123.koyeb.app"; 

// 2. Simple Connection (Let Socket.io handle the rest)
const socket = io(SERVER_URL, {
  withCredentials: true,
  autoConnect: true
});
// --- 2. COMPONENT: Voice User Bubble ---
const VoiceUser = ({ name, isSpeaking }) => (
  <motion.div 
    initial={{ opacity: 0, height: 0 }} 
    animate={{ opacity: 1, height: 'auto' }} 
    exit={{ opacity: 0, height: 0 }}
    style={{ display: 'flex', alignItems: 'center', padding: '4px 0 4px 28px', gap: '8px' }}
  >
    <div style={{
      width: '24px', height: '24px', borderRadius: '50%', background: '#5865f2',
      border: isSpeaking ? '2px solid #3ba55c' : '2px solid transparent',
      boxShadow: isSpeaking ? '0 0 8px #3ba55c' : 'none',
      transition: 'all 0.1s'
    }}></div>
    <span style={{ color: isSpeaking ? 'white' : '#949ba4', fontSize: '14px', fontWeight: isSpeaking ? 'bold' : 'normal' }}>
      {name}
    </span>
  </motion.div>
);

function App() {
  // --- STATE ---
  const [token, setToken] = useState(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  
  const [activeChannel, setActiveChannel] = useState("General");
  const [activeVoice, setActiveVoice] = useState(null);
  
  const [message, setMessage] = useState("");
  const [messageList, setMessageList] = useState([]);

  // Voice & Audio State
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);
  const [myPeerId, setMyPeerId] = useState(null);
  const [voiceUsers, setVoiceUsers] = useState({});
  const [speakingPeers, setSpeakingPeers] = useState({});
  
  const peerInstance = useRef(null);
  const myStreamRef = useRef(null);
  const incomingAudioRefs = useRef({}); 

  // --- INITIAL SETUP ---
  useEffect(() => {
    // Initialize PeerJS for Voice
    const peer = new Peer();
    peer.on('open', (id) => setMyPeerId(id));
    
    peer.on('call', (call) => {
      navigator.mediaDevices.getUserMedia({ video: false, audio: true }).then((stream) => {
        call.answer(stream);
        call.on('stream', (remoteStream) => handleRemoteStream(remoteStream, call.peer));
      });
    });
    peerInstance.current = peer;

    // Handle Socket Listeners
    socket.on('receive_message', (data) => {
      setMessageList((list) => [...list, data]);
    });

    socket.on('voice_users_update', ({ roomId, users }) => {
      setVoiceUsers((prev) => ({ ...prev, [roomId]: users }));
    });

    return () => { 
        socket.off('receive_message');
        socket.off('voice_users_update'); 
    };
  }, []);

  // --- AUDIO HELPERS ---
  const handleRemoteStream = (stream, peerId) => {
    const audio = document.createElement('audio');
    audio.srcObject = stream;
    audio.play();
    incomingAudioRefs.current[peerId] = audio;
    if (isDeafened) audio.muted = true;

    // Speaking Detection Logic
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    const checkVolume = () => {
      if(!audio.paused && !audio.ended) {
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
        const average = sum / dataArray.length;
        setSpeakingPeers(prev => ({ ...prev, [peerId]: average > 15 }));
        requestAnimationFrame(checkVolume);
      }
    };
    checkVolume();
  };

  const stopMicrophone = () => {
    if (myStreamRef.current) {
      myStreamRef.current.getTracks().forEach(track => track.stop());
      myStreamRef.current = null;
    }
  };

  const toggleMute = () => {
    const newMuteState = !isMuted;
    setIsMuted(newMuteState);
    if (myStreamRef.current) {
      myStreamRef.current.getAudioTracks()[0].enabled = !newMuteState;
    }
  };

  const toggleDeafen = () => {
    const newDeafenState = !isDeafened;
    setIsDeafened(newDeafenState);
    Object.values(incomingAudioRefs.current).forEach(audio => audio.muted = newDeafenState);
    if (newDeafenState && !isMuted) toggleMute();
  };

  // --- ACTIONS ---
  const joinVoiceChannel = (channelName) => {
    if (activeVoice === channelName) return; 
    stopMicrophone();
    
    navigator.mediaDevices.getUserMedia({ video: false, audio: true })
      .then((stream) => {
        myStreamRef.current = stream;
        stream.getAudioTracks()[0].enabled = !isMuted;
        setActiveVoice(channelName);
        handleRemoteStream(stream, myPeerId); 

        socket.emit('join_voice', { roomId: channelName, peerId: myPeerId, username });
        
        socket.on('user_connected', (newUserId) => {
          const call = peerInstance.current.call(newUserId, stream);
          call.on('stream', (remoteStream) => handleRemoteStream(remoteStream, newUserId));
        });
      })
      .catch(err => {
        alert("Microphone Access Denied! Ensure you are using HTTPS.");
      });
  };

  const leaveVoice = () => {
    if(activeVoice) {
      socket.emit('leave_voice');
      stopMicrophone();
      setActiveVoice(null);
      Object.values(incomingAudioRefs.current).forEach(audio => {
          audio.pause();
          audio.srcObject = null;
      });
      incomingAudioRefs.current = {};
    }
  };

  const login = async () => {
    try {
      const res = await axios.post(`${SERVER_URL}/login`, { username, password });
      setToken(res.data.token);
      setUsername(res.data.username);
      socket.emit("join_room", "General");
    } catch (e) { 
      alert(e.response?.data?.error || "Login Failed. Check Server Logs."); 
    }
  };
  
  const register = async () => { 
      try { 
        await axios.post(`${SERVER_URL}/register`, { username, password }); 
        alert("Registered successfully! Now you can login."); 
      }
      catch(e) { alert("Username taken or server error."); }
  };

  const sendMessage = async () => {
    if (message.trim()) {
      const msgData = { 
        room: activeChannel, 
        author: username, 
        message, 
        time: new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) 
      };
      socket.emit("send_message", msgData);
      setMessageList(list => [...list, msgData]);
      setMessage("");
    }
  };

  // --- RENDER ---
  if (!token) return (
    <div className="login-container">
      <div className="login-box">
        <h2 style={{color:'white', marginBottom:'20px'}}>Discord Clone</h2>
        <input placeholder="Username" onChange={e=>setUsername(e.target.value)}/>
        <input type="password" placeholder="Password" onChange={e=>setPassword(e.target.value)}/>
        <button onClick={login}>Login</button>
        <button className="secondary-btn" onClick={register}>Register</button>
      </div>
    </div>
  );

  return (
    <div className="app-container">
      {/* Sidebar */}
      <div className="sidebar"><div className="server-icon">D</div></div>
      
      {/* Channels List */}
      <div className="channels">
        <h3 className="section-title">TEXT CHANNELS</h3>
        {["General", "Gaming"].map(c => (
          <div key={c} className={`channel-item ${activeChannel === c ? "active" : ""}`} 
               onClick={() => { setActiveChannel(c); socket.emit("join_room", c); setMessageList([]); }}>
            <Hash size={20} /> {c}
          </div>
        ))}

        <h3 className="section-title" style={{marginTop:'20px'}}>VOICE CHANNELS</h3>
        {["Lobby", "Gaming Voice"].map(c => (
          <div key={c}>
            <div className={`channel-item ${activeVoice === c ? "active" : ""}`} onClick={() => joinVoiceChannel(c)}>
              <Volume2 size={20} /> {c}
            </div>
            <AnimatePresence>
              {voiceUsers[c]?.map(u => (
                <VoiceUser key={u.peerId} name={u.username} isSpeaking={speakingPeers[u.peerId]} />
              ))}
            </AnimatePresence>
          </div>
        ))}

        {/* User Status Bar */}
        <div className="voice-controls">
           <div className="user-info">
             <div className="avatar"></div>
             <div className="name-tag">
               <div className="username-text">{username}</div>
               <div className="status-text">Online</div>
             </div>
           </div>
           <div className="control-buttons">
             <button onClick={toggleMute} style={{color: isMuted ? '#fa373c' : '#b5bac1'}}>
               {isMuted ? <MicOff size={20}/> : <Mic size={20}/>}
             </button>
             <button onClick={toggleDeafen} style={{color: isDeafened ? '#fa373c' : '#b5bac1'}}>
               {isDeafened ? <VolumeX size={20}/> : <Headphones size={20}/>}
             </button>
             <button style={{color: '#b5bac1'}}><Settings size={20}/></button>
           </div>
        </div>

        {activeVoice && (
          <div className="voice-status">
             <div className="connection-info">
               <Signal size={14}/> Voice Connected: {activeVoice}
             </div>
             <button className="disconnect-btn" onClick={leaveVoice}>Disconnect</button>
          </div>
        )}
      </div>

      {/* Main Chat Area */}
      <div className="chat-area">
        <div className="chat-header">
          <Hash size={24} style={{color: '#80848e'}}/> {activeChannel}
        </div>
        <div className="messages-list">
          {messageList.map((msg, i) => (
            <motion.div key={i} initial={{opacity:0, x:-10}} animate={{opacity:1, x:0}} className="message">
              <div className="avatar"></div>
              <div className="message-content">
                <div className="message-meta">
                  <span className="author" style={{color: msg.author===username ? '#4ade80':'white'}}>{msg.author}</span>
                  <span className="time">{msg.time}</span>
                </div>
                <div className="text">{msg.message}</div>
              </div>
            </motion.div>
          ))}
        </div>
        <div className="input-area">
          <input className="input-box" 
                 placeholder={`Message #${activeChannel}`} 
                 value={message} 
                 onChange={e=>setMessage(e.target.value)} 
                 onKeyDown={e => e.key === 'Enter' && sendMessage()} />
        </div>
      </div>
    </div>
  );
}

export default App;