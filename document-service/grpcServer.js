/**
 * gRPC Server for Document Service
 * ==================================
 * 
 * DISTRIBUTED SYSTEMS CONCEPT — gRPC / Remote Procedure Call (Unit II):
 * 
 * This file implements the gRPC server that runs INSIDE the Document Service.
 * It listens on port 5003 and handles RPC calls from the API Gateway.
 * 
 * The API Gateway acts as a gRPC CLIENT.
 * This Document Service acts as a gRPC SERVER.
 * 
 * Communication Flow:
 *   API Gateway (gRPC Client, port 3000)
 *       |
 *       | gRPC call (binary, fast)
 *       ↓
 *   Document Service (gRPC Server, port 5003)
 *       |
 *       | Mongoose query
 *       ↓
 *   MongoDB (Database)
 * 
 * This is similar to how large distributed systems like Google internally
 * use gRPC for service-to-service communication, while exposing REST
 * APIs to external clients (browsers).
 */

const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');

// Import the same Mongoose models used by the REST controllers
// This ensures gRPC and REST operate on the same MongoDB data
const Document = require('./models/Document');
const DocumentVersion = require('./models/DocumentVersion');

// ============================================================
// LOAD PROTOBUF DEFINITION
// The .proto file defines the contract between client and server
// ============================================================
const PROTO_PATH = path.join(__dirname, '..', 'proto', 'document.proto');

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,      // Keep field names as defined in .proto
    longs: String,       // Represent long values as strings
    enums: String,       // Represent enums as strings
    defaults: true,      // Use default values for missing fields
    oneofs: true
});

const documentProto = grpc.loadPackageDefinition(packageDefinition).document;

// ============================================================
// HELPER: Generate a 6-character document ID (same as REST controller)
// ============================================================
function generateDocumentId() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    var id = '';
    for (var i = 0; i < 6; i++) {
        id += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return id;
}

// ============================================================
// gRPC METHOD: CreateDocument
// 
// Called by API Gateway when a user creates a new document.
// This is the gRPC equivalent of POST /api/documents
// 
// RPC Flow:
//   1. API Gateway sends CreateDocumentRequest via gRPC
//   2. This handler creates the document in MongoDB
//   3. Returns CreateDocumentResponse back to API Gateway
//   4. API Gateway converts it to HTTP JSON response for the browser
// ============================================================
async function createDocument(call, callback) {
    try {
        console.log('[gRPC Server] CreateDocument RPC called');

        // Generate a unique 6-character document ID
        var documentId = generateDocumentId();
        var existing = await Document.findOne({ documentId: documentId });
        while (existing) {
            documentId = generateDocumentId();
            existing = await Document.findOne({ documentId: documentId });
        }

        // Create document in MongoDB
        var newDoc = new Document({
            documentId: documentId,
            title: call.request.title || 'Untitled Document',
            content: ''
        });

        await newDoc.save();

        console.log('[gRPC Server] Document created via gRPC:', documentId);

        // Send gRPC response back to the API Gateway
        callback(null, {
            success: true,
            message: 'Document created successfully via gRPC',
            documentId: newDoc.documentId,
            title: newDoc.title,
            content: newDoc.content,
            createdAt: newDoc.createdAt.toISOString(),
            updatedAt: newDoc.updatedAt.toISOString()
        });
    } catch (error) {
        console.error('[gRPC Server] CreateDocument error:', error.message);
        callback({
            code: grpc.status.INTERNAL,
            message: 'Failed to create document: ' + error.message
        });
    }
}

// ============================================================
// gRPC METHOD: GetDocument
// 
// Called by API Gateway when a user opens/joins a document.
// This is the gRPC equivalent of GET /api/documents/:documentId
// ============================================================
async function getDocument(call, callback) {
    try {
        var documentId = call.request.documentId;
        console.log('[gRPC Server] GetDocument RPC called for:', documentId);

        // Find document in MongoDB
        var doc = await Document.findOne({ documentId: documentId });

        if (!doc) {
            console.log('[gRPC Server] Document not found:', documentId);
            callback(null, {
                success: false,
                message: 'Document not found. Please check the Document ID.',
                documentId: '',
                title: '',
                content: '',
                createdAt: '',
                updatedAt: ''
            });
            return;
        }

        console.log('[gRPC Server] Document retrieved via gRPC:', documentId);

        callback(null, {
            success: true,
            message: 'Document retrieved successfully via gRPC',
            documentId: doc.documentId,
            title: doc.title,
            content: doc.content,
            createdAt: doc.createdAt.toISOString(),
            updatedAt: doc.updatedAt.toISOString()
        });
    } catch (error) {
        console.error('[gRPC Server] GetDocument error:', error.message);
        callback({
            code: grpc.status.INTERNAL,
            message: 'Failed to get document: ' + error.message
        });
    }
}

// ============================================================
// gRPC METHOD: SaveDocument
// 
// Called by API Gateway when a user saves a document.
// This is the gRPC equivalent of PUT /api/documents/:documentId
// Also creates a version snapshot (same as REST controller).
// ============================================================
async function saveDocument(call, callback) {
    try {
        var documentId = call.request.documentId;
        console.log('[gRPC Server] SaveDocument RPC called for:', documentId);

        // Find the document
        var doc = await Document.findOne({ documentId: documentId });

        if (!doc) {
            callback(null, {
                success: false,
                message: 'Document not found',
                documentId: '',
                title: '',
                content: '',
                updatedAt: '',
                versionNumber: 0,
                savedBy: '',
                versionTimestamp: ''
            });
            return;
        }

        // Update the document content
        doc.title = call.request.title || doc.title;
        doc.content = call.request.content !== undefined ? call.request.content : doc.content;
        doc.updatedAt = Date.now();
        await doc.save();

        // Count existing versions and create a new version snapshot
        var versionCount = await DocumentVersion.countDocuments({ documentId: documentId });

        var version = new DocumentVersion({
            documentId: documentId,
            versionNumber: versionCount + 1,
            content: doc.content,
            title: doc.title,
            savedBy: call.request.savedBy || 'Unknown',
            timestamp: Date.now()
        });
        await version.save();

        console.log('[gRPC Server] Document saved via gRPC:', documentId, '→ Version', version.versionNumber);

        callback(null, {
            success: true,
            message: 'Document saved successfully via gRPC',
            documentId: doc.documentId,
            title: doc.title,
            content: doc.content,
            updatedAt: doc.updatedAt.toISOString(),
            versionNumber: version.versionNumber,
            savedBy: version.savedBy,
            versionTimestamp: version.timestamp.toISOString()
        });
    } catch (error) {
        console.error('[gRPC Server] SaveDocument error:', error.message);
        callback({
            code: grpc.status.INTERNAL,
            message: 'Failed to save document: ' + error.message
        });
    }
}

// ============================================================
// START gRPC SERVER
// 
// This function is called from document-service/server.js
// It starts the gRPC server on a separate port (5003)
// alongside the existing Express REST server (port 5001).
// 
// Both servers share the same MongoDB connection and models.
// ============================================================
function startGrpcServer(port) {
    var server = new grpc.Server();

    // Register the DocumentService with its RPC method handlers
    server.addService(documentProto.DocumentService.service, {
        CreateDocument: createDocument,
        GetDocument: getDocument,
        SaveDocument: saveDocument
    });

    // Bind to the specified port on all interfaces
    server.bindAsync(
        '0.0.0.0:' + port,
        grpc.ServerCredentials.createInsecure(), // No TLS (local development)
        function (error, boundPort) {
            if (error) {
                console.error('[gRPC Server] Failed to start:', error.message);
                return;
            }
            console.log('============================================');
            console.log('[gRPC Server] Running on port', boundPort);
            console.log('[gRPC Server] Service: DocumentService');
            console.log('[gRPC Server] Methods: CreateDocument, GetDocument, SaveDocument');
            console.log('[gRPC Server] Proto file:', PROTO_PATH);
            console.log('============================================');
        }
    );

    return server;
}

module.exports = { startGrpcServer };
