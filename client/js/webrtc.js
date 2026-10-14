/**
 * webrtc.js — Peer-to-Peer Video/Audio Calling via WebRTC
 * ========================================================
 * Implements direct peer-to-peer browser video/audio communication.
 * 
 * DISTRIBUTED SYSTEMS CONCEPTS DEMONSTRATED:
 * 1. P2P Architecture: Audio/video flows directly between peers without backend relays.
 * 2. WebRTC Signaling: Exchanging SDP Offers/Answers and ICE Candidates via Socket.IO.
 * 3. Distributed Multimedia: Real-time text collaboration with synchronized video/audio.
 */

// DOM Elements
const startCallBtn = document.getElementById('startCallBtn');
const endCallBtn = document.getElementById('endCallBtn');
const videoSection = document.getElementById('videoSection');
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');

// State Variables
let localStream = null;
let peerConnection = null;
let pendingIceCandidates = [];
let isCallInProgress = false;
let isWebRTCInitialized = false;

// WebRTC Configuration (STUN servers for NAT Traversal + Extensible for TURN)
const rtcConfiguration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
        // TURN servers can be configured here if symmetric NAT requires a relay:
        // {
        //     urls: 'turn:turn.example.com:3478',
        //     username: 'user',
        //     credential: 'password'
        // }
    ]
};

// Helper: Toast Notifications
function webrtcToast(message) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
}

// ============================================================
// INITIALIZE WEBRTC EVENT LISTENERS
// ============================================================
function initWebRTC() {
    if (!window.collabSocket) {
        setTimeout(initWebRTC, 500);
        return;
    }

    if (isWebRTCInitialized) return;
    isWebRTCInitialized = true;

    const socket = window.collabSocket;
    const docId = window.currentDocId;
    const userInfo = window.currentUserInfo || {};

    // --- 1. User clicks "Start Video Call" (Caller Flow) ---
    if (startCallBtn) {
        startCallBtn.addEventListener('click', async function () {
            if (isCallInProgress) return;

            try {
                isCallInProgress = true;
                startCallBtn.disabled = true;

                // 1. Obtain user media (camera & microphone)
                await startLocalStream();

                // 2. Create RTCPeerConnection and attach tracks
                createPeerConnection();

                // 3. Notify room that call is starting
                socket.emit('webrtc:join-call', {
                    documentId: docId,
                    userName: userInfo.name || 'Collaborator'
                });

                // 4. Create and set local SDP Offer
                const offer = await peerConnection.createOffer();
                console.log('[WebRTC] Offer created.');

                await peerConnection.setLocalDescription(offer);
                console.log('[WebRTC] Local description set (offer).');

                // 5. Send offer to peer via signaling server
                socket.emit('webrtc:offer', {
                    documentId: docId,
                    offer: offer
                });

                // 6. Update UI
                startCallBtn.style.display = 'none';
                startCallBtn.disabled = false;
                if (endCallBtn) endCallBtn.style.display = 'block';
                if (videoSection) videoSection.style.display = 'block';
                webrtcToast('Starting video call...');

            } catch (error) {
                console.error('[WebRTC] Start call error:', error);
                startCallBtn.disabled = false;
                isCallInProgress = false;
                webrtcToast('Camera/Microphone access required for video call.');
                endCall();
            }
        });
    }

    // --- 2. Remote peer received "User is calling" notification ---
    socket.on('webrtc:user-calling', function (data) {
        console.log(`[WebRTC] ${data.userName} started a video call.`);
        webrtcToast(`${data.userName} started a video call.`);
    });

    // --- 3. Callee received SDP Offer from Caller ---
    socket.on('webrtc:offer', async function (data) {
        try {
            console.log('[WebRTC] Received SDP Offer from peer.');

            // Safely close any stale connection before accepting new offer
            if (peerConnection) {
                console.log('[WebRTC] Resetting existing connection before handling new offer.');
                closePeerConnection();
            }

            // 1. Obtain user media
            await startLocalStream();

            // 2. Create RTCPeerConnection and attach tracks
            createPeerConnection();

            // 3. Set remote description from offer
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
            console.log('[WebRTC] Remote description set (offer).');

            // 4. Process all ICE candidates queued while awaiting getUserMedia / setRemoteDescription
            await processPendingIceCandidates();

            // 5. Create and set local SDP Answer
            const answer = await peerConnection.createAnswer();
            console.log('[WebRTC] Answer created.');

            await peerConnection.setLocalDescription(answer);
            console.log('[WebRTC] Local description set (answer).');

            // 6. Send answer to caller via signaling server
            socket.emit('webrtc:answer', {
                documentId: docId,
                answer: answer
            });

            // 7. Update UI
            isCallInProgress = true;
            if (startCallBtn) startCallBtn.style.display = 'none';
            if (endCallBtn) endCallBtn.style.display = 'block';
            if (videoSection) videoSection.style.display = 'block';
            webrtcToast('Connecting video call...');

        } catch (error) {
            console.error('[WebRTC] Offer handling error:', error);
            webrtcToast('Failed to connect incoming video call.');
            endCall();
        }
    });

    // --- 4. Caller received SDP Answer from Callee ---
    socket.on('webrtc:answer', async function (data) {
        try {
            console.log('[WebRTC] Received SDP Answer from peer.');
            if (!peerConnection) {
                console.warn('[WebRTC] Received answer but no active peerConnection exists.');
                return;
            }

            // Set remote description from answer
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
            console.log('[WebRTC] Remote description set (answer).');

            // Process all ICE candidates that arrived before or during answer arrival
            await processPendingIceCandidates();

        } catch (error) {
            console.error('[WebRTC] Answer handling error:', error);
            webrtcToast('Failed to establish peer connection.');
        }
    });

    // --- 5. Exchange ICE Candidates ---
    socket.on('webrtc:ice-candidate', async function (data) {
        try {
            if (!data || !data.candidate) return;

            console.log('[WebRTC] ICE candidate received from peer.');

            // If remote description is already available, add candidate immediately
            if (peerConnection && peerConnection.remoteDescription && peerConnection.remoteDescription.type) {
                try {
                    await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
                    console.log('[WebRTC] ICE candidate added directly.');
                } catch (candidateError) {
                    console.warn('[WebRTC] Failed to add ICE candidate directly:', candidateError);
                }
            } else {
                // Otherwise, queue candidate until setRemoteDescription completes
                const candStr = data.candidate.candidate || JSON.stringify(data.candidate);
                const isDuplicate = pendingIceCandidates.some(c => (c.candidate || JSON.stringify(c)) === candStr);
                if (!isDuplicate) {
                    pendingIceCandidates.push(data.candidate);
                    console.log(`[WebRTC] ICE candidate queued. Total queued: ${pendingIceCandidates.length}`);
                }
            }
        } catch (error) {
            console.error('[WebRTC] ICE candidate handling error:', error);
        }
    });

    // --- 6. Call Ended Event from Peer ---
    socket.on('webrtc:call-ended', function () {
        console.log('[WebRTC] Peer ended the call.');
        webrtcToast('Peer ended the video call.');
        endCall();
    });

    // --- 7. End Call Button Click ---
    if (endCallBtn) {
        endCallBtn.addEventListener('click', function () {
            console.log('[WebRTC] Ending video call...');
            if (window.collabSocket) {
                window.collabSocket.emit('webrtc:end-call', {
                    documentId: docId
                });
            }
            endCall();
            webrtcToast('Call ended.');
        });
    }
}

// ============================================================
// HELPER: PROCESS QUEUED ICE CANDIDATES
// ============================================================
async function processPendingIceCandidates() {
    if (!peerConnection || !peerConnection.remoteDescription) return;
    if (pendingIceCandidates.length === 0) return;

    console.log(`[WebRTC] Processing ${pendingIceCandidates.length} queued ICE candidate(s)...`);
    const candidatesToProcess = [...pendingIceCandidates];
    pendingIceCandidates = [];

    for (const candidate of candidatesToProcess) {
        if (!candidate) continue;
        try {
            await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
            console.log('[WebRTC] Queued ICE candidate added successfully.');
        } catch (error) {
            console.warn('[WebRTC] Error adding queued ICE candidate:', error);
        }
    }
}

// ============================================================
// HELPER: ACCESS USER CAMERA & MICROPHONE
// ============================================================
async function startLocalStream() {
    if (localStream && localStream.active && localStream.getTracks().some(t => t.readyState === 'live')) {
        return localStream;
    }

    console.log('[WebRTC] Requesting camera and microphone access...');
    localStream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 320 }, height: { ideal: 240 } },
        audio: true
    });

    if (localVideo) {
        localVideo.srcObject = localStream;
        localVideo.muted = true; // Local preview must always be muted to prevent feedback loop
        const playPromise = localVideo.play();
        if (playPromise !== undefined) {
            playPromise.catch(err => console.warn('[WebRTC] Local video play error:', err));
        }
    }

    console.log('[WebRTC] Local camera/microphone stream acquired.');
    return localStream;
}

// ============================================================
// HELPER: CREATE RTCPeerConnection INSTANCE
// ============================================================
function createPeerConnection() {
    if (peerConnection) {
        closePeerConnection();
    }

    console.log('[WebRTC] Creating new RTCPeerConnection...');
    peerConnection = new RTCPeerConnection(rtcConfiguration);

    // Add local stream tracks to peer connection
    if (localStream) {
        localStream.getTracks().forEach(track => {
            console.log(`[WebRTC] Adding local track (${track.kind}) to peerConnection.`);
            peerConnection.addTrack(track, localStream);
        });
    }

    // Remote track listener
    peerConnection.ontrack = function (event) {
        console.log('[WebRTC] Remote track received:', event.track.kind);
        if (!remoteVideo) return;

        if (event.streams && event.streams[0]) {
            if (remoteVideo.srcObject !== event.streams[0]) {
                remoteVideo.srcObject = event.streams[0];
            }
        } else {
            if (!remoteVideo.srcObject) {
                remoteVideo.srcObject = new MediaStream();
            }
            if (!remoteVideo.srcObject.getTracks().some(t => t.id === event.track.id)) {
                remoteVideo.srcObject.addTrack(event.track);
            }
        }

        remoteVideo.muted = false; // Remote video must NOT be muted
        if (videoSection) videoSection.style.display = 'block';

        const playPromise = remoteVideo.play();
        if (playPromise !== undefined) {
            playPromise.catch(err => {
                console.warn('[WebRTC] Remote video autoplay error (user interaction might be needed):', err);
            });
        }
    };

    // Local ICE candidate generation listener
    peerConnection.onicecandidate = function (event) {
        if (event.candidate) {
            console.log('[WebRTC] ICE candidate generated:', event.candidate.candidate);
            if (window.collabSocket) {
                window.collabSocket.emit('webrtc:ice-candidate', {
                    documentId: window.currentDocId,
                    candidate: event.candidate
                });
            }
        } else {
            console.log('[WebRTC] ICE candidate gathering finished.');
        }
    };

    // State change debugging listeners
    peerConnection.onconnectionstatechange = function () {
        console.log('[WebRTC] Connection state:', peerConnection.connectionState);
        if (peerConnection.connectionState === 'connected') {
            webrtcToast('Video call connected.');
        } else if (peerConnection.connectionState === 'failed') {
            console.error('[WebRTC] ICE connection failed (connectionState: failed)');
            webrtcToast('Unable to establish peer-to-peer connection.');
        } else if (peerConnection.connectionState === 'disconnected') {
            console.warn('[WebRTC] Peer connection disconnected.');
        }
    };

    peerConnection.oniceconnectionstatechange = function () {
        console.log('[WebRTC] ICE connection state:', peerConnection.iceConnectionState);
        if (peerConnection.iceConnectionState === 'failed') {
            console.error('[WebRTC] ICE connection failed (iceConnectionState: failed)');
            webrtcToast('Unable to establish peer-to-peer connection.');
        } else if (peerConnection.iceConnectionState === 'connected' || peerConnection.iceConnectionState === 'completed') {
            console.log('[WebRTC] ICE connection established.');
        }
    };

    peerConnection.onicegatheringstatechange = function () {
        console.log('[WebRTC] ICE gathering state:', peerConnection.iceGatheringState);
    };

    peerConnection.onsignalingstatechange = function () {
        console.log('[WebRTC] Signaling state:', peerConnection.signalingState);
    };

    return peerConnection;
}

// ============================================================
// HELPER: SAFELY CLOSE PEER CONNECTION
// ============================================================
function closePeerConnection() {
    if (peerConnection) {
        peerConnection.onicecandidate = null;
        peerConnection.ontrack = null;
        peerConnection.onconnectionstatechange = null;
        peerConnection.oniceconnectionstatechange = null;
        peerConnection.onicegatheringstatechange = null;
        peerConnection.onsignalingstatechange = null;
        try {
            peerConnection.close();
        } catch (e) {
            console.warn('[WebRTC] Error closing peerConnection:', e);
        }
        peerConnection = null;
        console.log('[WebRTC] Closed existing RTCPeerConnection.');
    }
}

// ============================================================
// HELPER: TEARDOWN CALL & CLEANUP MEDIA
// ============================================================
function endCall() {
    closePeerConnection();

    if (localStream) {
        localStream.getTracks().forEach(track => {
            try {
                track.stop();
            } catch (e) {}
        });
        localStream = null;
    }

    pendingIceCandidates = [];
    isCallInProgress = false;

    if (localVideo) localVideo.srcObject = null;
    if (remoteVideo) remoteVideo.srcObject = null;
    if (videoSection) videoSection.style.display = 'none';
    if (startCallBtn) {
        startCallBtn.style.display = 'block';
        startCallBtn.disabled = false;
    }
    if (endCallBtn) endCallBtn.style.display = 'none';

    console.log('[WebRTC] Call ended cleanly.');
}

// Initialize WebRTC signaling
initWebRTC();
