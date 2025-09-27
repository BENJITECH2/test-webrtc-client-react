import React, { useRef, useState, useEffect } from 'react';
import { createSignalRConnection } from './signalrClient';


const SIGNALR_URL = 'http://135.181.81.49:9000/call';


const VideoChat = () => {
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const localStreamRef = useRef(null); // Add this to keep track of local stream
  const [connection, setConnection] = useState(null);
  const [peer, setPeer] = useState(null);
  const [joined, setJoined] = useState(false);
  const [token, setToken] = useState("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI0ZjMyMjBhOC1kNTllLTQxYzgtYTk1MC1iOGI5YWEyYjcyNTAiLCJlbWFpbCI6ImhvbGFAZ21haWwuY29tIiwianRpIjoiZjNiMTIxODMtYWRjMC00NjEyLWI0ZTUtMWNkYjkzNmFmM2FhIiwiaHR0cDovL3NjaGVtYXMueG1sc29hcC5vcmcvd3MvMjAwNS8wNS9pZGVudGl0eS9jbGFpbXMvbmFtZWlkZW50aWZpZXIiOiI0ZjMyMjBhOC1kNTllLTQxYzgtYTk1MC1iOGI5YWEyYjcyNTAiLCJodHRwOi8vc2NoZW1hcy5taWNyb3NvZnQuY29tL3dzLzIwMDgvMDYvaWRlbnRpdHkvY2xhaW1zL3JvbGUiOiJDbGllbnQiLCJleHAiOjE3NTg5Mjg3MDR9.Rij426Gu8hVNkSQsy2hVOBIdLMkDmM1xrStxdvBLomg");
  const [userId, setUserId] = useState('');
  const [calleeId, setCalleeId] = useState('');
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [incomingCall, setIncomingCall] = useState(null);
  const [inCall, setInCall] = useState(false);
  const [mediaError, setMediaError] = useState(null);

  useEffect(() => {
    if (!token) return;
    const conn = createSignalRConnection(SIGNALR_URL, (type, ...args) => {
      if (type === 'ReceiveOffer') handleReceiveOffer(args[0], args[1]);
      if (type === 'ReceiveAnswer') handleReceiveAnswer(args[0]);
      if (type === 'ReceiveIceCandidate') handleReceiveIceCandidate(args[0], args[1], args[2]);
    }, token);

    conn.on('ReceiveOffer', handleReceiveOffer);
    conn.on('ReceiveAnswer', handleReceiveAnswer);
    conn.on('ReceiveIceCandidate', handleReceiveIceCandidate);

    conn.start().then(() => {
      setConnection(conn);
      conn.invoke('GetConnectionId').then(id => {
        console.log('My connection ID:', id);
        setUserId(id);
      });
      conn.invoke('Join').then(() => {
        refreshOnlineUsers(conn);
      });
    });
    return () => {
      // Clean up media stream when component unmounts
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }
      conn.stop();
    };
    // eslint-disable-next-line
  }, [token]);
  
  const refreshOnlineUsers = (conn) => {
    conn.invoke('GetOnlineUsers').then(users => {
      setOnlineUsers(users.filter(id => id !== userId));
    });
  };

  // Get user media separately so we can reuse it and handle errors properly
  const getUserMedia = async () => {
    try {
      const constraints = { 
        video: true, 
        audio: true 
      };
      console.log("[MEDIA] Requesting user media with constraints:", constraints);
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      console.log("[MEDIA] Got local stream:", stream);
      
      // Store the stream for later cleanup
      localStreamRef.current = stream;
      
      // Display local video
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

  const createPeer = async (isOfferer, remoteUser = null) => {
    console.log(`[RTC] Creating peer connection as ${isOfferer ? 'offerer' : 'answerer'}`);
    
    // Get media first
    const stream = await getUserMedia();
    if (!stream) {
      console.error("[RTC] Failed to get user media, cannot create peer");
      return null;
    }
    
    // Create peer connection
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:23.88.107.221:3478' },    
        {
          urls: [
            'turn:23.88.107.221:3478?transport=udp',
            'turn:23.88.107.221:3478?transport=tcp'
          ],
          username: 'benji',
          credential: 'benji',
        },
      ],
      iceCandidatePoolSize: 10,
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
      console.log('[ICE] ICE connection state:', pc.iceConnectionState);
    };
    pc.onicegatheringstatechange = () => {
      console.log('[ICE] ICE gathering state:', pc.iceGatheringState);
    };
    pc.ontrack = (event) => {
      console.log('[RTC] Remote track received:', event);
      if (remoteVideoRef.current && event.streams && event.streams[0]) {
        remoteVideoRef.current.srcObject = event.streams[0];
        console.log('[RTC] Set remote video srcObject to stream:', event.streams[0]);
      }
    };
    
    pc.onconnectionstatechange = () => {
      console.log('[RTC] Connection state change:', pc.connectionState);
    };

    // Add tracks to the peer connection
    stream.getTracks().forEach((track) => {
      console.log(`[RTC] Adding ${track.kind} track to peer connection`);
      pc.addTrack(track, stream);
    });

    return pc;
  };

  const handleReceiveOffer = async (sdp, fromUser) => {
    console.log(`[SIGNAL] Received offer from ${fromUser}`);
    setIncomingCall(fromUser);
    window.pendingOffer = { sdp, fromUser };
  };

  const acceptCall = async () => {
    try {
      console.log("[CALL] Accepting call");
      setInCall(true);
      setIncomingCall(null);
      
      const { sdp, fromUser } = window.pendingOffer;
      
      // Create peer if it doesn't exist yet
      const peerConnection = await createPeer(false, fromUser);
      if (!peerConnection) {
        console.error("[CALL] Failed to create peer connection");
        setInCall(false);
        return;
      }
      
      // Set remote description (the offer)
      console.log("[CALL] Setting remote description (offer)");
      await peerConnection.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp }));
      
      // Create and send answer
      console.log("[CALL] Creating answer");
      const answer = await peerConnection.createAnswer();
      console.log("[CALL] Setting local description (answer)");
      await peerConnection.setLocalDescription(answer);
      
      console.log("[CALL] Sending answer");
      if (connection) {
        connection.invoke('SendAnswer', answer.sdp, fromUser);
      }
      
      window.pendingOffer = null;
    } catch (err) {
      console.error("[CALL] Error accepting call:", err);
      setInCall(false);
      setMediaError(`Error accepting call: ${err.message}`);
    }
  };

  const handleReceiveAnswer = async (sdp) => {
    console.log("[SIGNAL] Received answer");
    try {
      setInCall(true);
      if (peer) {
        console.log("[CALL] Setting remote description (answer)");
        await peer.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp }));
        console.log("[CALL] Remote description set successfully");
      } else {
        console.error("[CALL] Received answer but peer connection doesn't exist");
      }
    } catch (err) {
      console.error("[CALL] Error setting remote description:", err);
    }
  };

  const handleReceiveIceCandidate = async (candidate, sdpMid, sdpMLineIndex) => {
    if (!candidate) {
      return;
    }
    console.log('[ICE] Received remote candidate:', { candidate, sdpMid, sdpMLineIndex });
    
    try {
      if (peer) {
        await peer.addIceCandidate({ candidate, sdpMid, sdpMLineIndex });
        console.log('[ICE] Remote candidate added successfully');
      } else {
        console.warn('[ICE] Cannot add ICE candidate, peer connection does not exist');
      }
    } catch (e) {
      console.warn('[ICE] Error adding remote candidate:', e);
    }
  };

  const handleJoin = async () => {
    if (token) {
      setJoined(true);
    }
  };

  const handleCall = async () => {
    try {
      console.log("[CALL] Starting call to", calleeId);
      setInCall(true);
      
      const peerConnection = await createPeer(true, calleeId);
      if (!peerConnection) {
        console.error("[CALL] Failed to create peer connection");
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
      if (connection) {
        connection.invoke('SendOffer', offer.sdp, calleeId);
      }
    } catch (err) {
      console.error("[CALL] Error making call:", err);
      setInCall(false);
      setMediaError(`Error making call: ${err.message}`);
    }
  };
  
  const handleRefreshUsers = () => {
    if (connection) {
      refreshOnlineUsers(connection);
    }
  };

  return (
    <div>
      <h2>Video Chat</h2>
      {mediaError && (
        <div style={{ color: 'red', marginBottom: 12 }}>
          {mediaError}
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
      </div>
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