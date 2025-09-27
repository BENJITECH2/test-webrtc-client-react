import React, { useRef, useState, useEffect } from 'react';
import { createSignalRConnection } from './signalrClient';


const SIGNALR_URL = 'http://135.181.81.49:9000/call';

const mytoken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIyMWVkMjMzYi0wNjk4LTQ4YjMtYTdmMS1kMGU5Zjc5OWQ2MDIiLCJlbWFpbCI6ImhvbGFAZ21haWwuY29tIiwianRpIjoiMTg5N2UzNDYtNTQxMi00MWYzLTk3NzktMjlkMjZiNDBkMTg5IiwiaHR0cDovL3NjaGVtYXMueG1sc29hcC5vcmcvd3MvMjAwNS8wNS9pZGVudGl0eS9jbGFpbXMvbmFtZWlkZW50aWZpZXIiOiIyMWVkMjMzYi0wNjk4LTQ4YjMtYTdmMS1kMGU5Zjc5OWQ2MDIiLCJodHRwOi8vc2NoZW1hcy5taWNyb3NvZnQuY29tL3dzLzIwMDgvMDYvaWRlbnRpdHkvY2xhaW1zL3JvbGUiOiJDbGllbnQiLCJodHRwOi8vc2NoZW1hcy54bWxzb2FwLm9yZy93cy8yMDA1LzA1L2lkZW50aXR5L2NsYWltcy9uYW1lIjoiaG9sYUBnbWFpbC5jb20iLCJleHAiOjE3NTg5NTkyMzd9.Q1T4G7XoHjERhx5oxcD2tyJWl78mMHRGNtZ94ofCFyg"
const VideoChat = () => {
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const [connection, setConnection] = useState(null);
  const [peer, setPeer] = useState(null);
  const [joined, setJoined] = useState(false);
  const [token, setToken] = useState(mytoken);
  const [userId, setUserId] = useState('');
  const [calleeId, setCalleeId] = useState('');
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [incomingCall, setIncomingCall] = useState(null);
  const [inCall, setInCall] = useState(false);

  useEffect(() => {
    if (!token) return;
    const conn = createSignalRConnection(SIGNALR_URL, (type, ...args) => {
      if (type === 'ReceiveOffer') handleReceiveOffer(args[0], args[1]);
      if (type === 'ReceiveAnswer') handleReceiveAnswer(args[0]);
      if (type === 'ReceiveIceCandidate') handleReceiveIceCandidate(args[0], args[1], args[2]);
      // No IncomingCall event needed; UI is triggered by ReceiveOffer
    }, token); // Pass token for authentication

    conn.on('ReceiveOffer', handleReceiveOffer);
    conn.on('ReceiveAnswer', handleReceiveAnswer);
    conn.on('ReceiveIceCandidate', handleReceiveIceCandidate);

    conn.start().then(() => {
      setConnection(conn);
      // Get connection ID and store it
      conn.invoke('GetConnectionId').then(id => {
        console.log('My connection ID:', id);
        setUserId(id);
      });
      // Join the hub
      conn.invoke('Join').then(() => {
        // Get list of online users
        refreshOnlineUsers(conn);
      });
    });
    return () => {
      conn.stop();
    };
    // eslint-disable-next-line
  }, [token]);
  
  // Function to refresh the list of online users
  const refreshOnlineUsers = (conn) => {
    conn.invoke('GetOnlineUsers').then(users => {
      setOnlineUsers(users.filter(id => id !== userId));
    });
  };

  // WebRTC setup
  const createPeer = async (isOfferer, remoteUser = null) => {
    // Replace the TURN config below with your actual TURN server details
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
      console.log('[ICE] Remote track received:', event);
      if (remoteVideoRef.current) {
        // If multiple tracks/streams, always set the first stream
        if (event.streams && event.streams.length > 0) {
          remoteVideoRef.current.srcObject = event.streams[0];
          console.log('[ICE] Set remote video srcObject to stream:', event.streams[0]);
        } else if (event.track) {
          // Fallback: create a new MediaStream if only a track is present
          const ms = new window.MediaStream([event.track]);
          remoteVideoRef.current.srcObject = ms;
          console.log('[ICE] Set remote video srcObject to single track stream:', ms);
        }
      }
    };

    // Get local media
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = stream;
    }

    if (isOfferer) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      if (connection) {
        connection.invoke('SendOffer', offer.sdp, calleeId);
      }
    }
  };

  // SignalR handlers
  const handleReceiveOffer = async (sdp, fromUser) => {
    setIncomingCall(fromUser);
    // Wait for user to accept call
    window.pendingOffer = { sdp, fromUser };
  };

  const acceptCall = async () => {
    setInCall(true);
    setIncomingCall(null);
    const { sdp, fromUser } = window.pendingOffer;
    if (!peer) await createPeer(false, fromUser);
    await peer.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp }));
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    if (connection) {
      connection.invoke('SendAnswer', answer.sdp, fromUser);
    }
    window.pendingOffer = null;
  };

  const handleReceiveAnswer = async (sdp) => {
    setInCall(true);
    if (peer) {
      await peer.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp }));
    }
  };

  const handleReceiveIceCandidate = async (candidate, sdpMid, sdpMLineIndex) => {
    if (!candidate) {
      // Ignore empty candidate (end-of-candidates signal)
      return;
    }
    console.log('[ICE] Received remote candidate:', { candidate, sdpMid, sdpMLineIndex });
    if (peer) {
      try {
        await peer.addIceCandidate({ candidate, sdpMid, sdpMLineIndex });
        console.log('[ICE] Remote candidate added successfully');
      } catch (e) {
        console.warn('[ICE] Error adding remote candidate:', e);
      }
    }
  };

  const handleJoin = async () => {
    // In a real app, you'd get the token from your auth service
    if (token) {
      setJoined(true);
    }
  };

  const handleCall = async () => {
    setInCall(true);
    await createPeer(true);
  };
  
  const handleRefreshUsers = () => {
    if (connection) {
      refreshOnlineUsers(connection);
    }
  };

  return (
    <div>
      <h2>Video Chat</h2>
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
        <video ref={localVideoRef} autoPlay playsInline muted style={{ width: '45%' }} />
        <video ref={remoteVideoRef} autoPlay playsInline style={{ width: '45%' }} />
      </div>
    </div>
  );
};

export default VideoChat;
