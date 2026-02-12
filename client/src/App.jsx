import { useState, useEffect, useRef } from "react";
import io from "socket.io-client";
import axios from "axios";
import Peer from "peerjs";
import { motion, AnimatePresence } from "framer-motion";
import { Hash, Volume2, Mic, MicOff, Headphones, VolumeX, Signal, Settings } from "lucide-react";
import "./App.css";

// --- 1. AUTO-DETECT URL ---
// This ensures it works on your phone (via IP) and your laptop (via localhost)
const SERVER_URL = "https://funny-name-123.koyeb.app";

// client/src/App.jsx

// client/src/App.jsx

const socket = io("https://funny-name-123.koyeb.app", {
  transports: ["polling"], // FORCE polling to start - it's safer for CORS
  withCredentials: true,
  forceNew: true
});

// --- 2. COMPONENT: Voice User Bubble (Green Outline) ---
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
  const [connectionStatus, setConnectionStatus] = useState("disconnected");
  
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
    const peer = new Peer();
    peer.on('open', (id) => setMyPeerId(id));
    
    // Handle Incoming Calls
    peer.on('call', (call) => {
      navigator.mediaDevices.getUserMedia({ video: false, audio: true }).then((stream) => {
        call.answer(stream);
        call.on('stream', (remoteStream) => handleRemoteStream(remoteStream, call.peer));
      });
    });
    peerInstance.current = peer;

    // Handle User List Updates
    socket.on('voice_users_update', ({ roomId, users }) => {
      setVoiceUsers((prev) => ({ ...prev, [roomId]: users }));
    });

    return () => { socket.off('voice_users_update'); };
  }, []);

  // --- AUDIO HELPERS ---
  const handleRemoteStream = (stream, peerId) => {
    // Play Audio
    const audio = document.createElement('audio');
    audio.srcObject = stream;
    audio.play();
    incomingAudioRefs.current[peerId] = audio;
    if (isDeafened) audio.muted = true;

    // Speaking Detection (Green Outline)
    const audioContext = new AudioContext();
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
        setSpeakingPeers(prev => ({ ...prev, [peerId]: average > 10 }));
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
    // Mute all incoming audio
    Object.values(incomingAudioRefs.current).forEach(audio => audio.muted = newDeafenState);
    // Auto-mute self if deafened
    if (newDeafenState && !isMuted) toggleMute();
  };

  // --- ACTIONS ---
  const joinVoiceChannel = (channelName) => {
    if (activeVoice === channelName) return; 
    stopMicrophone(); // Stop old mic
    setConnectionStatus("connecting");
    
    navigator.mediaDevices.getUserMedia({ video: false, audio: true })
      .then((stream) => {
        myStreamRef.current = stream;
        stream.getAudioTracks()[0].enabled = !isMuted; // Respect mute button
        setActiveVoice(channelName);
        handleRemoteStream(stream, myPeerId); // Analyze self volume

        socket.emit('join_voice', { roomId: channelName, peerId: myPeerId, username });
        
        socket.on('user_connected', (newUserId) => {
          const call = peerInstance.current.call(newUserId, stream);
          call.on('stream', (remoteStream) => handleRemoteStream(remoteStream, newUserId));
        });
        
        setTimeout(() => setConnectionStatus("connected"), 500);
      })
      .catch(err => {
        alert("Microphone Error! (If on phone, make sure you are using HTTPS)");
        setConnectionStatus("disconnected");
      });
  };

  const leaveVoice = () => {
    if(activeVoice) {
      socket.emit('leave_voice');
      stopMicrophone();
      setActiveVoice(null);
      setConnectionStatus("disconnected");
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
    } catch (e) { alert("Login Failed"); }
  };
  
  const register = async () => { 
      try { await axios.post(`${SERVER_URL}/register`, { username, password }); alert("Registered!"); }
      catch(e) { alert("Username taken"); }
  };

  const sendMessage = async () => {
    if (message) {
      const msgData = { room: activeChannel, author: username, message, time: new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) };
      await socket.emit("send_message", msgData);
      setMessageList(list => [...list, msgData]);
      setMessage("");
    }
  };

  // --- RENDER ---
  if (!token) return <div className="login-container"><div className="login-box"><h2 style={{color:'white'}}>Login</h2><input placeholder="Name" onChange={e=>setUsername(e.target.value)}/><input type="password" placeholder="Pass" onChange={e=>setPassword(e.target.value)}/><button onClick={login}>Login</button><button style={{background:'transparent', marginTop:'10px'}} onClick={register}>Register</button></div></div>;

  return (
    <div className="app-container">
      <div className="sidebar"><div className="server-icon">D</div></div>
      
      <div className="channels">
        <h3 style={{color:'#949ba4', fontSize:'12px', fontWeight:'bold', paddingLeft:'10px'}}>TEXT</h3>
        {["General", "Gaming"].map(c => (
          <div key={c} className={`channel-item ${activeChannel === c ? "active" : ""}`} onClick={() => { setActiveChannel(c); socket.emit("join_room", c); setMessageList([]); }}>
            <Hash size={20} /> {c}
          </div>
        ))}

        <h3 style={{color:'#949ba4', fontSize:'12px', fontWeight:'bold', paddingLeft:'10px', marginTop:'20px'}}>VOICE</h3>
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

        <div className="voice-controls" style={{marginTop: 'auto'}}>
           <div style={{display: 'flex', alignItems: 'center', gap: '8px', flex: 1}}>
             <div className="avatar" style={{width: '32px', height: '32px'}}></div>
             <div>
               <div style={{fontWeight: 'bold', fontSize: '13px', color: 'white'}}>{username}</div>
               <div style={{fontSize: '11px', color: '#b5bac1'}}>Online</div>
             </div>
           </div>
           <div style={{display: 'flex', gap: '2px'}}>
             {/* MUTE BUTTON */}
             <button onClick={toggleMute} style={{background: 'transparent', padding: '6px', color: isMuted ? '#fa373c' : '#b5bac1'}}>
               {isMuted ? <MicOff size={20}/> : <Mic size={20}/>}
             </button>
             {/* DEAFEN BUTTON (Fixed Icon) */}
             <button onClick={toggleDeafen} style={{background: 'transparent', padding: '6px', color: isDeafened ? '#fa373c' : '#b5bac1'}}>
               {isDeafened ? <VolumeX size={20}/> : <Headphones size={20}/>}
             </button>
             <button style={{background: 'transparent', padding: '6px', color: '#b5bac1'}}><Settings size={20}/></button>
           </div>
        </div>

        {activeVoice && (
          <div style={{padding: '10px', background: '#232428', borderTop: '1px solid #1e1f22'}}>
             <div style={{color: '#3ba55c', fontWeight:'bold', fontSize:'12px', display:'flex', alignItems:'center', gap:'5px', marginBottom:'5px'}}>
               <Signal size={14}/> Connected: {activeVoice}
             </div>
             <button onClick={leaveVoice} style={{padding:'6px', background: 'transparent', border: '1px solid #da373c', color: '#da373c', fontSize:'12px', width: '100%', borderRadius: '4px'}}>
               Disconnect
             </button>
          </div>
        )}
      </div>

      <div className="chat-area">
        <div style={{height: '48px', borderBottom: '1px solid #26272d', display: 'flex', alignItems: 'center', padding: '0 16px', fontWeight: 'bold', color: 'white'}}>
          <Hash size={24} style={{marginRight: '8px', color: '#80848e'}}/> {activeChannel}
        </div>
        <div className="messages-list">
          {messageList.map((msg, i) => (
            <motion.div key={i} initial={{opacity:0, x:-10}} animate={{opacity:1, x:0}} className="message">
              <div className="avatar"></div>
              <div>
                <div style={{fontWeight:'bold', color: msg.author===username ? '#4ade80':'white'}}>{msg.author} <span style={{fontSize:'12px', color:'#949ba4', fontWeight:'normal'}}>{msg.time}</span></div>
                <div style={{color:'#dcddde'}}>{msg.message}</div>
              </div>
            </motion.div>
          ))}
        </div>
        <div className="input-area">
          <input className="input-box" placeholder={`Message #${activeChannel}`} value={message} onChange={e=>setMessage(e.target.value)} onKeyDown={e => e.key === 'Enter' && sendMessage()} />
        </div>
      </div>
    </div>
  );
}

export default App;