import React, { useRef, useState, useEffect } from 'react';
import { createSignalRConnection } from './signalrClient';

const SIGNALR_URL = 'http://135.181.81.49:9000/call';

const VideoChat = () => {
  // Keep existing state and refs...
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const localStreamRef = useRef(null);
  const pendingCandidatesRef = useRef([]); // New: store candidates that arrive before peer connection
  const [connection, setConnection] = useState(null);
  const [peer, setPeer] = useState(null);
  const [joined, setJoined] = useState(false);
  const [token, setToken] = useState("");
  const [userId, setUserId] = useState('');
  const [calleeId, setCalleeId] = useState('');
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [incomingCall, setIncomingCall] = useState(null);
  const [inCall, setInCall] = useState(false);
  const [mediaError, setMediaError] = useState(null);
  const [iceConnectionStatus, setIceConnectionStatus] = useState('');


  
  // Function to refresh online users list
  const refreshOnlineUsers = (conn, currentUserId) => {
    const idToUse = currentUserId || userId;
    conn.invoke('GetOnlineUsers').then(users => {
      // Filter out our own ID
      setOnlineUsers(users.filter(id => id !== idToUse));
    }).catch(err => {
      console.error("Error getting online users:", err);
    });
  };



  // Handle join button click
  const handleJoin = async () => {
    if (!token) {
      setMediaError("Please enter a valid token");
      return;
    }
    setJoined(true);

    const conn = createSignalRConnection(SIGNALR_URL, token);

    // Set up SignalR event handlers
    conn.on('ReceiveOffer', (sdp, fromUser) => {
      console.log(`[SignalR] Received offer from ${fromUser}`);
      setIncomingCall(fromUser);
      window.pendingOffer = { sdp, fromUser };
    });

    conn.on('ReceiveAnswer', async (sdp) => {
      console.log("[SignalR] Received answer");
      setInCall(true);
      if (peer) {
        try {
          await peer.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp }));
          console.log("[RTC] Remote description set successfully");
        } catch (err) {
          console.error("[CALL] Error setting remote description:", err);
        }
      }
    });

    conn.on('ReceiveIceCandidate', handleReceiveIceCandidate);

    conn.start().then(() => {
      setConnection(conn);
      conn.invoke('Join').then(() => {
        console.log("Joined the hub.");
        // Get our own ID and online users
        conn.invoke('GetConnectionId').then(id => {
          console.log('My connection ID:', id);
          setUserId(id);

          // Now get online users AFTER we have our ID
          refreshOnlineUsers(conn, id);
        });
      });
    }).catch(err => {
      console.error("Error connecting to SignalR hub:", err);
      setMediaError(`Error connecting to server: ${err.message}`);
    });
  };
  
  // Handle refresh users button click
  const handleRefreshUsers = () => {
    if (connection) {
      refreshOnlineUsers(connection, userId);
    }
  };
  
  // Handle call button click
  const handleCall = async () => {
    if (!calleeId || !connection) {
      console.error("[CALL] Cannot call without a selected user and connection.");
      return;
    }
    
    try {
      console.log("[CALL] Starting call to", calleeId);
      setInCall(true);
      
      const peerConnection = await createPeer(true, calleeId);
      if (!peerConnection) {
        console.error("[CALL] Failed to create peer connection for outgoing call.");
        setInCall(false);
        return;
      }
      
      console.log("[CALL] Creating offer");
      const offer = await peerConnection.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      });
      
      console.log("[CALL] Setting local description (offer)");
      await peerConnection.setLocalDescription(offer);
      
      console.log("[CALL] Sending offer to", calleeId);
      await connection.invoke('SendOffer', offer.sdp, calleeId);
      
    } catch (err) {
      console.error("[CALL] Error starting call:", err);
      setInCall(false);
      setMediaError(`Error starting call: ${err.message}`);
    }
  };
  
  // IMPROVED getUserMedia with more specific constraints
  const getUserMedia = async () => {
    try {
      const constraints = { 
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 30 }
        }, 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      };
      console.log("[MEDIA] Requesting user media with constraints:", constraints);
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      console.log("[MEDIA] Got local stream:", stream);
      
      localStreamRef.current = stream;
      
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
        console.log("[MEDIA] Set local video srcObject");
      }
      
      return stream;
    } catch (err) {
      console.error("[MEDIA] Error getting user media:", err);
      setMediaError(`Error accessing camera/microphone: ${err.message}`);
      return null;
    }
  };

  // IMPROVED createPeer with better ICE server config
  const createPeer = async (isOfferer, remoteUser = null) => {
    console.log(`[RTC] Creating peer connection as ${isOfferer ? 'offerer' : 'answerer'}`);
    
    const stream = await getUserMedia();
    if (!stream) {
      console.error("[RTC] Failed to get user media, cannot create peer");
      return null;
    }
    
    // UPDATED ICE server configuration with multiple STUN/TURN options
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        {
          urls: [
            'turn:23.88.107.221:3478?transport=udp',
            'turn:23.88.107.221:3478?transport=tcp'
          ],
          username: 'benji',
          credential: 'benji',
        }
      ],
      iceTransportPolicy: 'relay', // <--- Force TURN only for testing
    });
    setPeer(pc);

    pc.onicecandidate = (event) => {
      if (event.candidate && event.candidate.candidate) {
        console.log('[ICE] Local candidate gathered:', event.candidate);
        if (connection) {
          console.log('[ICE] Sending candidate to remote:', event.candidate);
          connection.invoke('SendIceCandidate', event.candidate.candidate, event.candidate.sdpMid, event.candidate.sdpMLineIndex, remoteUser || calleeId);
        }
      } else if (event.candidate === null) {
        console.log('[ICE] All local candidates have been gathered.');
      }
    };
    
    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState;
      console.log('[ICE] ICE connection state:', state);
      setIceConnectionStatus(state);
      
      // Handle failed connection with retry for specific states
      if (state === 'disconnected' || state === 'failed') {
        console.log('[ICE] Connection issues detected. Consider restarting the call.');
      }
      
      if (state === 'connected' || state === 'completed') {
        console.log('[ICE] Connection established successfully!');
      }
    };
    
    pc.onicegatheringstatechange = () => {
      console.log('[ICE] ICE gathering state:', pc.iceGatheringState);
    };
    
    pc.ontrack = (event) => {
      console.log('[RTC] Remote track received:', event.track.kind);
      if (remoteVideoRef.current && event.streams && event.streams[0]) {
        remoteVideoRef.current.srcObject = event.streams[0];
        console.log('[RTC] Set remote video srcObject to stream');
        
        // Monitor remote track status
        event.track.onunmute = () => {
          console.log('[RTC] Remote track unmuted:', event.track.kind);
        };
        
        event.track.onmute = () => {
          console.log('[RTC] Remote track muted:', event.track.kind);
        };
        
        event.track.onended = () => {
          console.log('[RTC] Remote track ended:', event.track.kind);
        };
      }
    };
    
    pc.onconnectionstatechange = () => {
      console.log('[RTC] Connection state change:', pc.connectionState);
      
      if (pc.connectionState === 'connected') {
        console.log('[RTC] Peers connected successfully!');
      }
    };

    // Add tracks to the peer connection
    stream.getTracks().forEach((track) => {
      console.log(`[RTC] Adding ${track.kind} track to peer connection`);
      pc.addTrack(track, stream);
    });
    
    // Add any pending ICE candidates if available
    if (pendingCandidatesRef.current.length > 0) {
      console.log('[ICE] Adding pending candidates:', pendingCandidatesRef.current.length);
      for (const candidate of pendingCandidatesRef.current) {
        try {
          await pc.addIceCandidate(candidate);
          console.log('[ICE] Added pending candidate');
        } catch (e) {
          console.warn('[ICE] Error adding pending candidate:', e);
        }
      }
      pendingCandidatesRef.current = [];
    }

    return pc;
  };

  // Keep most other functions intact, update these:
  
  // IMPROVED accept call function
  const acceptCall = async () => {
    try {
      console.log("[CALL] Accepting call");
      setInCall(true);
      setIncomingCall(null);
      
      const { sdp, fromUser } = window.pendingOffer;
      
      const peerConnection = await createPeer(false, fromUser);
      if (!peerConnection) {
        console.error("[CALL] Failed to create peer connection");
        setInCall(false);
        return;
      }
      
      console.log("[CALL] Setting remote description (offer)");
      await peerConnection.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp }));
      
      console.log("[CALL] Creating answer");
      const answer = await peerConnection.createAnswer({
        offerToReceiveAudio: true, 
        offerToReceiveVideo: true
      });
      
      console.log("[CALL] Setting local description (answer)");
      await peerConnection.setLocalDescription(answer);
      
      console.log("[CALL] Sending answer to", fromUser);
      if (connection) {
        await connection.invoke('SendAnswer', answer.sdp, fromUser);
      }
      
      window.pendingOffer = null;
    } catch (err) {
      console.error("[CALL] Error accepting call:", err);
      setInCall(false);
      setMediaError(`Error accepting call: ${err.message}`);
    }
  };

  // IMPROVED ICE candidate handling
  const handleReceiveIceCandidate = async (candidate, sdpMid, sdpMLineIndex) => {
    if (!candidate) return;
    
    console.log('[ICE] Received remote candidate');
    
    const iceCandidate = { candidate, sdpMid, sdpMLineIndex };
    
    try {
      if (peer && peer.remoteDescription) {
        await peer.addIceCandidate(iceCandidate);
        console.log('[ICE] Remote candidate added successfully');
      } else {
        // Store candidates that arrive before the peer connection is ready
        console.log('[ICE] Storing early candidate for later');
        pendingCandidatesRef.current.push(iceCandidate);
      }
    } catch (e) {
      console.warn('[ICE] Error adding remote candidate:', e);
    }
  };

  // Add a function to restart ICE if needed
  const restartIce = async () => {
    if (!peer || !inCall) return;
    
    try {
      console.log("[ICE] Restarting ICE connection");
      
      // Create a new offer with ICE restart flag
      const offer = await peer.createOffer({ 
        iceRestart: true,
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      });
      
      await peer.setLocalDescription(offer);
      
      if (connection) {
        await connection.invoke('SendOffer', offer.sdp, calleeId);
      }
    } catch (err) {
      console.error("[ICE] Error restarting ICE:", err);
    }
  };

  // UPDATE the UI to include connection status and a restart button
  return (
    <div>
      <h2>Video Chat</h2>
      {mediaError && (
        <div style={{ color: 'red', marginBottom: 12 }}>
          {mediaError}
        </div>
      )}
      {iceConnectionStatus === 'failed' && (
        <div style={{ color: 'red', marginBottom: 12 }}>
          Connection failed. Try restarting the call.
          <button onClick={restartIce} style={{ marginLeft: 8 }}>Restart Connection</button>
        </div>
      )}
      <div style={{ marginBottom: 12 }}>
        <input
          placeholder="Enter JWT token"
          value={token}
          onChange={e => setToken(e.target.value)}
          disabled={joined}
          style={{ width: '300px' }}
        />
        <button onClick={handleJoin} disabled={joined || !token}>Join</button>
        {userId && <div style={{ fontSize: 12, color: 'gray', marginTop: 4 }}>Your ID: {userId}</div>}
        {inCall && <div style={{ fontSize: 12, color: 'gray', marginTop: 4 }}>Connection Status: {iceConnectionStatus}</div>}
      </div>
      
      {/* Keep the rest of the UI the same */}
      {joined && (
        <div style={{ marginBottom: 12 }}>
          <select
            value={calleeId}
            onChange={e => setCalleeId(e.target.value)}
            disabled={inCall}
            style={{ minWidth: '200px' }}
          >
            <option value="">Select a user to call</option>
            {onlineUsers.map(user => (
              <option key={user} value={user}>{user}</option>
            ))}
          </select>
          <button onClick={handleCall} disabled={!calleeId || inCall} style={{ marginLeft: 8 }}>Call</button>
          <button onClick={handleRefreshUsers} style={{ marginLeft: 8 }}>Refresh Users</button>
        </div>
      )}
      {incomingCall && (
        <div style={{ marginBottom: 12, color: 'green' }}>
          Incoming call from <b>{incomingCall}</b>
          <button onClick={acceptCall} style={{ marginLeft: 8 }}>Accept</button>
        </div>
      )}
      <div style={{ display: 'flex', gap: '10px' }}>
        <div style={{ width: '45%' }}>
          <video ref={localVideoRef} autoPlay playsInline muted style={{ width: '100%', border: '1px solid #ccc' }} />
          <div style={{ textAlign: 'center', marginTop: 4 }}>Local Video</div>
        </div>
        <div style={{ width: '45%' }}>
          <video ref={remoteVideoRef} autoPlay playsInline style={{ width: '100%', border: '1px solid #ccc' }} />
          <div style={{ textAlign: 'center', marginTop: 4 }}>Remote Video</div>
        </div>
      </div>
    </div>
  );
};

export default VideoChat;