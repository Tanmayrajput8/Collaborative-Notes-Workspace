/**
 * Document Routes
 * ================
 * Defines the REST API endpoints for the Document Service.
 * 
 * DISTRIBUTED SYSTEMS CONCEPT — REST Communication (Unit II):
 * These routes follow the HTTP request-response communication model.
 * A client sends a request (GET, POST, PUT) and receives a response.
 * This is different from WebSocket communication, which is persistent
 * and allows the server to push updates without a client request.
 * 
 * Routes:
 *   POST   /api/documents              → Create a new document
 *   GET    /api/documents/:documentId   → Get a document
 *   PUT    /api/documents/:documentId   → Update and save version
 *   GET    /api/documents/:documentId/versions → Get version history
 */

const express = require('express');
const router = express.Router();
const documentController = require('../controllers/documentController');

// Create a new document
router.post('/', documentController.createDocument);

// Get a document by ID
router.get('/:documentId', documentController.getDocument);

// Update a document (and create a version)
router.put('/:documentId', documentController.updateDocument);

// Get version history for a document
router.get('/:documentId/versions', documentController.getVersions);

module.exports = router;
