import React, { useRef, useState, useEffect } from 'react';
import { createSignalRConnection } from './signalrClient';


const SIGNALR_URL = 'http://localhost:5159/call';


const VideoChat = () => {
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const [connection, setConnection] = useState(null);
  const [peer, setPeer] = useState(null);
  const [joined, setJoined] = useState(false);
  const [connectionId, setConnectionId] = useState('');
  const [activeConnections, setActiveConnections] = useState([]);
  const [callee, setCallee] = useState('');
  const [incomingCall, setIncomingCall] = useState(null);
  const [inCall, setInCall] = useState(false);

  useEffect(() => {
    if (!joined) return;
    const conn = createSignalRConnection(SIGNALR_URL, (type, ...args) => {
      if (type === 'ReceiveOffer') handleReceiveOffer(args[0], args[1]);
      if (type === 'ReceiveAnswer') handleReceiveAnswer(args[0]);
      if (type === 'ReceiveIceCandidate') handleReceiveIceCandidate(args[0], args[1], args[2]);
      // No IncomingCall event needed; UI is triggered by ReceiveOffer
    });

    conn.on('ReceiveOffer', handleReceiveOffer);
    conn.on('ReceiveAnswer', handleReceiveAnswer);
    conn.on('ReceiveIceCandidate', handleReceiveIceCandidate);

    conn.start().then(() => {
      setConnection(conn);
      setConnectionId(conn.connectionId);
      
      // Get active connections for UI
      conn.invoke('GetActiveConnections').then(connections => {
        setActiveConnections(connections.filter(id => id !== conn.connectionId));
      });
    });
    
    return () => {
      conn.stop();
    };
    // eslint-disable-next-line
  }, [joined]);

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
          connection.invoke('SendIceCandidate', event.candidate.candidate, event.candidate.sdpMid, event.candidate.sdpMLineIndex, remoteUser || callee);
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
        connection.invoke('SendOffer', offer.sdp, callee);
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
    setJoined(true);
  };

  const handleCall = async () => {
    setInCall(true);
    await createPeer(true);
  };

  return (
    <div>
      <h2>Video Chat</h2>
      <div style={{ marginBottom: 12 }}>
        <button onClick={handleJoin} disabled={joined}>Join Call</button>
        {connectionId && <div style={{ fontSize: 12, color: 'gray' }}>Your ID: {connectionId}</div>}
      </div>
      {joined && (
        <div>
          <div style={{ marginBottom: 12 }}>
            <select 
              value={callee} 
              onChange={e => setCallee(e.target.value)}
              disabled={inCall}
            >
              <option value="">Select a connection</option>
              {activeConnections.map(conn => (
                <option key={conn} value={conn}>{conn}</option>
              ))}
            </select>
            <button onClick={handleCall} disabled={!callee || inCall}>Call</button>
          </div>
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
