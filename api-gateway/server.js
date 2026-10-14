/**
 * API Gateway — Server
 * =====================
 * The API Gateway is the SINGLE PUBLIC ENTRY POINT for all client traffic.
 * When deployed via LocalTunnel (e.g. https://example-name.loca.lt),
 * ONLY port 3000 is exposed publicly.
 * 
 * DISTRIBUTED SYSTEMS CONCEPTS:
 * 
 * 1. API GATEWAY PATTERN (Unit I — Distributed Architecture):
 *    - Serves frontend static assets (`/client`)
 *    - Forwards document operations to Document Service via gRPC (port 5003)
 *    - Falls back to REST/HTTP (port 5001) if gRPC is unavailable
 *    - Proxies Socket.IO events (`/socket.io`) to Collaboration Service (port 5002)
 * 
 * 2. MIDDLEWARE PIPELINE (Unit I):
 *    - CORS Handling (accepts requests from any origin / LocalTunnel domain)
 *    - Request Logging (traces all incoming methods and endpoints)
 *    - Request Validation (validates document ID format)
 *    - Service Error Translation (detects if downstream services or MongoDB fail)
 * 
 * 3. gRPC CLIENT (Unit II — gRPC/RPC Communication):
 *    - Internal service-to-service communication using gRPC:
 *      Browser → REST/HTTP → API Gateway → gRPC → Document Service → MongoDB
 *    - This demonstrates Remote Procedure Call (RPC) where the gateway
 *      calls functions on the Document Service as if they were local.
 * 
 * 4. FAULT TOLERANCE (Unit II):
 *    - If gRPC connection fails, the gateway falls back to HTTP/REST
 *    - This demonstrates basic fault tolerance in service communication
 * 
 * COMMUNICATION FLOW:
 *   Browser ──HTTP/REST──→ API Gateway ──gRPC──→ Document Service ──→ MongoDB
 *   Browser ──Socket.IO──→ API Gateway ──Proxy──→ Collaboration Service
 */

const express = require('express');
const http = require('http');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const httpProxy = require('http-proxy');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
require('dotenv').config({ path: '../.env' });

const app = express();
const PORT = process.env.API_GATEWAY_PORT || 3000;
const DOCUMENT_SERVICE_URL = process.env.DOCUMENT_SERVICE_URL || 'http://localhost:5001';
const COLLABORATION_SERVICE_URL = process.env.COLLABORATION_SERVICE_URL || 'http://localhost:5002';
const GRPC_PORT = process.env.GRPC_PORT || 5003;

// ============================================================
// gRPC CLIENT SETUP (Unit II — gRPC Communication)
// 
// The API Gateway acts as a gRPC CLIENT that connects to the
// Document Service's gRPC SERVER on port 5003.
// 
// This handles 3 operations:
//   - CreateDocument (POST /api/documents)
//   - GetDocument (GET /api/documents/:id)
//   - SaveDocument (PUT /api/documents/:id)
// 
// Version history (GET /api/documents/:id/versions) uses HTTP/axios.
// ============================================================
const PROTO_PATH = path.join(__dirname, '..', 'proto', 'document.proto');

var grpcClient = null;

try {
    var packageDefinition = protoLoader.loadSync(PROTO_PATH, {
        keepCase: true,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true
    });

    var documentProto = grpc.loadPackageDefinition(packageDefinition).document;

    // Create gRPC client connected to Document Service on port 5003
    grpcClient = new documentProto.DocumentService(
        'localhost:' + GRPC_PORT,
        grpc.credentials.createInsecure()
    );

    console.log('[API Gateway] gRPC Client created → localhost:' + GRPC_PORT);
} catch (error) {
    console.error('[API Gateway] Failed to initialize gRPC client:', error.message);
    console.error('[API Gateway] Will use HTTP fallback for all document operations.');
}

// ============================================================
// SOCKET.IO PROXY TO COLLABORATION SERVICE (Port 5002)
// This allows remote browsers to connect via the SINGLE LocalTunnel
// URL on port 3000 without exposing port 5002 publicly.
// ============================================================
const socketProxy = httpProxy.createProxyServer({
    target: COLLABORATION_SERVICE_URL,
    ws: true,
    changeOrigin: true
});

// Proxy HTTP polling requests for Socket.IO (/socket.io/*)
app.use('/socket.io', function (req, res) {
    req.url = req.originalUrl; // Preserve /socket.io path prefix for target server
    socketProxy.web(req, res, { target: COLLABORATION_SERVICE_URL }, function (err) {
        console.error('[API Gateway] Socket.IO HTTP proxy error:', err.message);
        if (!res.headersSent) {
            res.status(502).json({
                success: false,
                message: 'Collaboration Service is unavailable on port 5002.',
                service: 'collaboration-service',
                error: err.message
            });
        }
    });
});

// ============================================================
// MIDDLEWARE (Unit I — Middleware Concept)
// ============================================================

// Enable CORS for all origins (LocalTunnel, localhost, LAN)
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// Parse JSON request bodies
app.use(express.json());

// --- Request Logging Middleware ---
app.use(function (req, res, next) {
    console.log(
        '[API Gateway]',
        new Date().toLocaleTimeString(),
        req.method,
        req.url,
        '→ Incoming request'
    );
    next();
});

// --- Document ID Validation Middleware ---
function validateDocumentId(req, res, next) {
    var documentId = req.params.documentId;
    if (documentId && !/^[A-Z0-9]{6}$/i.test(documentId)) {
        return res.status(400).json({
            success: false,
            message: 'Invalid Document ID format. Must be 6 alphanumeric characters (e.g. ABC123).'
        });
    }
    next();
}

// ============================================================
// SERVE STATIC CLIENT FILES (Frontend)
// ============================================================
app.use('/client', express.static(path.join(__dirname, '..', 'client')));

// Redirect root to client home page
app.get('/', function (req, res) {
    res.redirect('/client/index.html');
});

// ============================================================
// API ROUTES — Forward requests to Document Service
// 
// PRIMARY: gRPC (port 5003) — fast binary protocol
// FALLBACK: HTTP/axios (port 5001) — if gRPC is unavailable
// ============================================================

// --- Create Document ---
app.post('/api/documents', async function (req, res) {
    if (grpcClient) {
        try {
            console.log('[API Gateway] → gRPC Call to Document Service: CreateDocument');

            var grpcResponse = await new Promise(function (resolve, reject) {
                grpcClient.CreateDocument(
                    { title: req.body.title || 'Untitled Document' },
                    { deadline: new Date(Date.now() + 5000) },
                    function (error, response) {
                        if (error) reject(error);
                        else resolve(response);
                    }
                );
            });

            console.log('[API Gateway] ← gRPC Response received: Document', grpcResponse.documentId);

            return res.status(201).json({
                success: grpcResponse.success,
                message: grpcResponse.message,
                document: {
                    documentId: grpcResponse.documentId,
                    title: grpcResponse.title,
                    content: grpcResponse.content,
                    createdAt: grpcResponse.createdAt,
                    updatedAt: grpcResponse.updatedAt
                },
                communicationMethod: 'gRPC'
            });
        } catch (grpcError) {
            console.error('[API Gateway] gRPC CreateDocument failed:', grpcError.message);
            console.log('[API Gateway] Falling back to HTTP/REST...');
        }
    }

    try {
        console.log('[API Gateway] → HTTP/REST Call to Document Service: CREATE document');
        var response = await axios.post(DOCUMENT_SERVICE_URL + '/api/documents', req.body);
        response.data.communicationMethod = 'HTTP/REST (gRPC fallback)';
        res.status(response.status).json(response.data);
    } catch (error) {
        handleServiceError(res, error, 'create document');
    }
});

// --- Get Document ---
app.get('/api/documents/:documentId', validateDocumentId, async function (req, res) {
    var documentId = req.params.documentId;

    if (grpcClient) {
        try {
            console.log('[API Gateway] → gRPC Call to Document Service: GetDocument', documentId);

            var grpcResponse = await new Promise(function (resolve, reject) {
                grpcClient.GetDocument(
                    { documentId: documentId },
                    { deadline: new Date(Date.now() + 5000) },
                    function (error, response) {
                        if (error) reject(error);
                        else resolve(response);
                    }
                );
            });

            if (!grpcResponse.success) {
                return res.status(404).json({
                    success: false,
                    message: grpcResponse.message
                });
            }

            console.log('[API Gateway] ← gRPC Response received: Document', grpcResponse.documentId);

            return res.status(200).json({
                success: grpcResponse.success,
                document: {
                    documentId: grpcResponse.documentId,
                    title: grpcResponse.title,
                    content: grpcResponse.content,
                    createdAt: grpcResponse.createdAt,
                    updatedAt: grpcResponse.updatedAt
                },
                communicationMethod: 'gRPC'
            });
        } catch (grpcError) {
            console.error('[API Gateway] gRPC GetDocument failed:', grpcError.message);
            console.log('[API Gateway] Falling back to HTTP/REST...');
        }
    }

    try {
        console.log('[API Gateway] → HTTP/REST Call to Document Service: GET document', documentId);
        var response = await axios.get(DOCUMENT_SERVICE_URL + '/api/documents/' + documentId);
        response.data.communicationMethod = 'HTTP/REST (gRPC fallback)';
        res.status(response.status).json(response.data);
    } catch (error) {
        handleServiceError(res, error, 'get document');
    }
});

// --- Update/Save Document ---
app.put('/api/documents/:documentId', validateDocumentId, async function (req, res) {
    var documentId = req.params.documentId;

    if (grpcClient) {
        try {
            console.log('[API Gateway] → gRPC Call to Document Service: SaveDocument', documentId);

            var grpcResponse = await new Promise(function (resolve, reject) {
                grpcClient.SaveDocument(
                    {
                        documentId: documentId,
                        title: req.body.title || '',
                        content: req.body.content !== undefined ? req.body.content : '',
                        savedBy: req.body.savedBy || 'Unknown'
                    },
                    { deadline: new Date(Date.now() + 5000) },
                    function (error, response) {
                        if (error) reject(error);
                        else resolve(response);
                    }
                );
            });

            if (!grpcResponse.success) {
                return res.status(404).json({
                    success: false,
                    message: grpcResponse.message
                });
            }

            console.log('[API Gateway] ← gRPC Response received: Saved', grpcResponse.documentId, 'v' + grpcResponse.versionNumber);

            return res.status(200).json({
                success: grpcResponse.success,
                message: grpcResponse.message,
                document: {
                    documentId: grpcResponse.documentId,
                    title: grpcResponse.title,
                    content: grpcResponse.content,
                    updatedAt: grpcResponse.updatedAt
                },
                version: {
                    versionNumber: grpcResponse.versionNumber,
                    savedBy: grpcResponse.savedBy,
                    timestamp: grpcResponse.versionTimestamp
                },
                communicationMethod: 'gRPC'
            });
        } catch (grpcError) {
            console.error('[API Gateway] gRPC SaveDocument failed:', grpcError.message);
            console.log('[API Gateway] Falling back to HTTP/REST...');
        }
    }

    try {
        console.log('[API Gateway] → HTTP/REST Call to Document Service: UPDATE document', documentId);
        var response = await axios.put(DOCUMENT_SERVICE_URL + '/api/documents/' + documentId, req.body);
        response.data.communicationMethod = 'HTTP/REST (gRPC fallback)';
        res.status(response.status).json(response.data);
    } catch (error) {
        handleServiceError(res, error, 'update document');
    }
});

// --- Get Version History ---
app.get('/api/documents/:documentId/versions', validateDocumentId, async function (req, res) {
    try {
        var documentId = req.params.documentId;
        console.log('[API Gateway] → HTTP/REST Call to Document Service: GET versions for', documentId);
        var response = await axios.get(DOCUMENT_SERVICE_URL + '/api/documents/' + documentId + '/versions');
        response.data.communicationMethod = 'HTTP/REST';
        res.status(response.status).json(response.data);
    } catch (error) {
        handleServiceError(res, error, 'get versions');
    }
});

// ============================================================
// SYNC HEALTH ENDPOINT (Unit III — Service Health Monitoring)
// Returns per-service health data for the frontend Distributed
// Synchronization panel. Tolerates unavailable downstream services.
// ============================================================
app.get('/api/sync/health', async function (req, res) {
    const results = {
        capturedAt: new Date().toISOString(),
        services: []
    };

    // 1. API Gateway (self — always reachable by definition)
    results.services.push({
        name:      'API Gateway',
        status:    'ok',
        port:      PORT,
        lastCheck: new Date().toISOString()
    });

    // 2. Document Service (REST health)
    try {
        const docHealth = await axios.get(DOCUMENT_SERVICE_URL + '/health', { timeout: 2000 });
        results.services.push({
            name:      'Document Service',
            status:    docHealth.data.status || 'ok',
            port:      5001,
            database:  docHealth.data.database || 'unknown',
            lastCheck: new Date().toISOString()
        });
    } catch (e) {
        results.services.push({
            name:      'Document Service',
            status:    'unreachable',
            port:      5001,
            database:  'unknown',
            lastCheck: new Date().toISOString(),
            error:     e.message
        });
    }

    // 3. Collaboration Service
    try {
        const collabHealth = await axios.get(COLLABORATION_SERVICE_URL + '/health', { timeout: 2000 });
        results.services.push({
            name:      'Collaboration Service',
            status:    collabHealth.data.status || 'ok',
            port:      5002,
            socketIO:  collabHealth.data.socketIO || 'unknown',
            lastCheck: new Date().toISOString()
        });
    } catch (e) {
        results.services.push({
            name:      'Collaboration Service',
            status:    'unreachable',
            port:      5002,
            socketIO:  'unknown',
            lastCheck: new Date().toISOString(),
            error:     e.message
        });
    }

    // 4. gRPC channel (Document Service, port 5003)
    if (grpcClient) {
        try {
            await new Promise(function (resolve) {
                grpcClient.GetDocument(
                    { documentId: 'HEALTH' },
                    { deadline: new Date(Date.now() + 2000) },
                    function () { resolve(); }
                );
            });
            results.services.push({
                name:      'gRPC Channel (Document Service)',
                status:    'ok',
                port:      GRPC_PORT,
                lastCheck: new Date().toISOString()
            });
        } catch (e) {
            results.services.push({
                name:      'gRPC Channel (Document Service)',
                status:    'unreachable',
                port:      GRPC_PORT,
                lastCheck: new Date().toISOString(),
                error:     e.message
            });
        }
    } else {
        results.services.push({
            name:      'gRPC Channel (Document Service)',
            status:    'not initialised',
            port:      GRPC_PORT,
            lastCheck: new Date().toISOString()
        });
    }

    res.json(results);
});

// ============================================================
// HEALTH CHECK ENDPOINT
// ============================================================
app.get('/health', async function (req, res) {
    var docServiceStatus = 'unknown';
    var collabServiceStatus = 'unknown';
    var grpcStatus = 'unknown';

    try {
        var docHealth = await axios.get(DOCUMENT_SERVICE_URL + '/health', { timeout: 2000 });
        docServiceStatus = docHealth.data.status || 'ok';
    } catch (e) {
        docServiceStatus = 'unreachable (port 5001)';
    }

    try {
        var collabHealth = await axios.get(COLLABORATION_SERVICE_URL + '/health', { timeout: 2000 });
        collabServiceStatus = collabHealth.data.status || 'ok';
    } catch (e) {
        collabServiceStatus = 'unreachable (port 5002)';
    }

    if (grpcClient) {
        try {
            await new Promise(function (resolve, reject) {
                grpcClient.GetDocument(
                    { documentId: 'HEALTH' },
                    { deadline: new Date(Date.now() + 2000) },
                    function (error, response) {
                        resolve();
                    }
                );
            });
            grpcStatus = 'connected (port ' + GRPC_PORT + ')';
        } catch (e) {
            grpcStatus = 'unreachable (port ' + GRPC_PORT + ')';
        }
    } else {
        grpcStatus = 'client not initialized';
    }

    res.json({
        status: 'ok',
        service: 'api-gateway',
        port: PORT,
        documentService: docServiceStatus,
        collaborationService: collabServiceStatus,
        grpcConnection: grpcStatus,
        timestamp: new Date().toISOString()
    });
});

// ============================================================
// ERROR HANDLING HELPER
// ============================================================
function handleServiceError(res, error, operation) {
    if (error.response) {
        console.error('[API Gateway] Document Service error response:', error.response.status);
        res.status(error.response.status).json(error.response.data);
    } else if (error.code === 'ECONNREFUSED') {
        console.error('[API Gateway] Document Service is UNAVAILABLE on port 5001');
        res.status(503).json({
            success: false,
            message: 'Document Service is unavailable. Please ensure it is running on port 5001.',
            service: 'document-service',
            error: 'Service unavailable'
        });
    } else {
        console.error('[API Gateway] Error during', operation + ':', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed to ' + operation + ': ' + error.message,
            error: error.message
        });
    }
}

// Error handling middleware
app.use(function (err, req, res, next) {
    console.error('[API Gateway] Unhandled error:', err.message);
    res.status(500).json({
        success: false,
        message: 'Internal gateway error: ' + err.message,
        error: err.message
    });
});

// ============================================================
// CREATE HTTP SERVER & ATTACH WEBSOCKET PROXY
// ============================================================
const server = http.createServer(app);

// Proxy WebSocket upgrade requests (/socket.io) to Collaboration Service
server.on('upgrade', function (req, socket, head) {
    if (req.url.startsWith('/socket.io')) {
        socketProxy.ws(req, socket, head, { target: COLLABORATION_SERVICE_URL }, function (err) {
            console.error('[API Gateway] Socket.IO WS proxy upgrade error:', err.message);
            socket.destroy();
        });
    }
});

// Listen on all network interfaces (0.0.0.0)
server.listen(PORT, '0.0.0.0', function () {
    console.log('============================================');
    console.log('[API Gateway] Running on port', PORT, '(0.0.0.0)');
    console.log('[API Gateway] Local URL: http://localhost:' + PORT);
    console.log('[API Gateway] Frontend: http://localhost:' + PORT + '/client/index.html');
    console.log('[API Gateway] Document Service (REST):', DOCUMENT_SERVICE_URL);
    console.log('[API Gateway] Document Service (gRPC): localhost:' + GRPC_PORT);
    console.log('[API Gateway] Collaboration Service:', COLLABORATION_SERVICE_URL);
    console.log('[API Gateway] Socket.IO Proxy: Forwarding /socket.io ->', COLLABORATION_SERVICE_URL);
    console.log('============================================');
});
