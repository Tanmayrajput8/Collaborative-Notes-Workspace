/**
 * Document Service — Server
 * ==========================
 * Independent microservice managing document persistence in MongoDB.
 * Runs internally on port 5001 (REST) and port 5003 (gRPC).
 * 
 * DISTRIBUTED SYSTEMS CONCEPTS:
 * 
 * 1. SERVICE-ORIENTED ARCHITECTURE (Unit I):
 *    Decouples database operations from public routing and real-time streaming.
 * 
 * 2. RPC TARGET (Unit II — Remote Procedure Call):
 *    API Gateway makes gRPC calls to this service on port 5003.
 *    The REST server on port 5001 is kept for version-history and health checks.
 *    Neither port is exposed to the public internet / LocalTunnel.
 * 
 * 3. gRPC SERVER (Unit II — gRPC Communication):
 *    A gRPC server runs alongside the REST server on a separate port.
 *    It handles CreateDocument, GetDocument, SaveDocument RPCs.
 *    This demonstrates internal service-to-service communication using gRPC.
 * 
 * 4. PERSISTENT STORAGE LAYER:
 *    Maintains documents and sequential version history in MongoDB.
 */

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config({ path: '../.env' });

const documentRoutes = require('./routes/documentRoutes');
const { startGrpcServer } = require('./grpcServer');

const app = express();
const PORT = process.env.DOCUMENT_SERVICE_PORT || 5001;
const GRPC_PORT = process.env.GRPC_PORT || 5003;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/collaborative-notes';

// ============================================================
// MIDDLEWARE (Unit I — Middleware Concept)
// Express middleware pipeline for request processing
// ============================================================
app.use(cors());
app.use(express.json());

// Request logging middleware
app.use(function (req, res, next) {
    console.log('[Document Service]', new Date().toLocaleTimeString(), req.method, req.url);
    next();
});

// ============================================================
// ROUTES (REST API — still used for version history & health)
// ============================================================
app.use('/api/documents', documentRoutes);

// Health check endpoint (for diagnostics & gateway polling)
app.get('/health', function (req, res) {
    var isDbConnected = mongoose.connection.readyState === 1;
    res.json({
        status: isDbConnected ? 'ok' : 'degraded',
        service: 'document-service',
        port: PORT,
        grpcPort: GRPC_PORT,
        database: isDbConnected ? 'connected' : 'disconnected',
        timestamp: new Date().toISOString()
    });
});

// ============================================================
// MONGODB CONNECTION
// After connecting, start the gRPC server so it has DB access
// ============================================================
mongoose.connect(MONGODB_URI)
    .then(function () {
        console.log('============================================');
        console.log('[Document Service] Connected to MongoDB');
        console.log('[Document Service] Database:', MONGODB_URI);
        console.log('============================================');

        // Start gRPC server AFTER MongoDB is connected
        // This ensures the gRPC handlers can access the database
        startGrpcServer(GRPC_PORT);
    })
    .catch(function (error) {
        console.error('============================================');
        console.error('[Document Service] MongoDB connection FAILED:', error.message);
        console.error('Check that MongoDB is running locally (e.g. mongod or mongosh).');
        console.error('============================================');
    });

// ============================================================
// ERROR HANDLING MIDDLEWARE
// ============================================================
app.use(function (err, req, res, next) {
    console.error('[Document Service] Error:', err.message);
    res.status(500).json({
        success: false,
        message: 'Document Service error: ' + err.message,
        service: 'document-service',
        error: err.message
    });
});

// ============================================================
// START REST SERVER (port 5001)
// The gRPC server starts separately on port 5003 (see above)
// ============================================================
app.listen(PORT, '0.0.0.0', function () {
    console.log('============================================');
    console.log('[Document Service] REST Server running on port', PORT, '(0.0.0.0)');
    console.log('[Document Service] REST URL: http://localhost:' + PORT);
    console.log('[Document Service] gRPC Server will start on port', GRPC_PORT);
    console.log('============================================');
});
