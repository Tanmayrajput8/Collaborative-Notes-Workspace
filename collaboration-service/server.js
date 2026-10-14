/**
 * Collaboration Service — Server
 * ================================
 * Dedicated real-time microservice running on port 5002.
 * Handles WebSocket streams, in-room messaging, and WebRTC signaling.
 * 
 * DISTRIBUTED SYSTEMS CONCEPTS:
 * 
 * 1. MESSAGE-ORIENTED COMMUNICATION (Unit II):
 *    Socket.IO events for real-time document editing, chat, and notifications.
 * 
 * 2. STREAM-ORIENTED COMMUNICATION (Unit II):
 *    Continuous stream of editing updates over persistent WebSocket connection.
 * 
 * 3. WEBRTC SIGNALING (Unit II):
 *    Relays SDP/ICE between peers for P2P media connections.
 * 
 * In LocalTunnel deployment:
 * The API Gateway proxies public Socket.IO connections on port 3000
 * directly to this service on port 5002.
 */

const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
require('dotenv').config({ path: '../.env' });

const { setupSocketHandlers } = require('./socket/socketHandler');

const app = express();
const PORT = process.env.COLLABORATION_SERVICE_PORT || 5002;

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST']
}));
app.use(express.json());

// Request logging middleware
app.use(function (req, res, next) {
    console.log('[Collaboration Service]', new Date().toLocaleTimeString(), req.method, req.url);
    next();
});

// Health check endpoint
app.get('/health', function (req, res) {
    res.json({
        status: 'ok',
        service: 'collaboration-service',
        port: PORT,
        socketIO: 'active',
        timestamp: new Date().toISOString()
    });
});

// Create HTTP Server & attach Socket.IO
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*', // Accepts connections forwarded through API Gateway / LocalTunnel
        methods: ['GET', 'POST']
    },
    transports: ['polling', 'websocket'],
    allowEIO3: true
});

// Attach Socket.IO handlers
setupSocketHandlers(io);

// Start listening on all network interfaces
server.listen(PORT, '0.0.0.0', function () {
    console.log('============================================');
    console.log('[Collaboration Service] Running on port', PORT, '(0.0.0.0)');
    console.log('[Collaboration Service] Local URL: http://localhost:' + PORT);
    console.log('[Collaboration Service] Socket.IO: Initialized & Listening');
    console.log('============================================');
});
