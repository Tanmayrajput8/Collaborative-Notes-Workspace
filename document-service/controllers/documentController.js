/**
 * Document Controller
 * ====================
 * Handles the business logic for document operations.
 * 
 * DISTRIBUTED SYSTEMS CONCEPT — RPC (Remote Procedure Call):
 * The API Gateway calls these endpoints via HTTP, similar to how
 * RPC works. The gateway doesn't know HOW the document is stored —
 * it just calls the Document Service and gets a result back.
 * 
 * API Endpoints handled:
 *   POST   /api/documents          → Create a new document
 *   GET    /api/documents/:id      → Get a document by ID
 *   PUT    /api/documents/:id      → Update a document (and save version)
 *   GET    /api/documents/:id/versions → Get version history
 */

const Document = require('../models/Document');
const DocumentVersion = require('../models/DocumentVersion');

// ============================================================
// HELPER: Generate a 6-character document ID (e.g., "ABC123")
// ============================================================
function generateDocumentId() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let id = '';
    for (let i = 0; i < 6; i++) {
        id += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return id;
}

// ============================================================
// CREATE: Create a new document
// REST: POST /api/documents
// ============================================================
async function createDocument(req, res) {
    try {
        // Generate a unique document ID
        let documentId = generateDocumentId();

        // Make sure the ID doesn't already exist in the database
        let existing = await Document.findOne({ documentId: documentId });
        while (existing) {
            documentId = generateDocumentId();
            existing = await Document.findOne({ documentId: documentId });
        }

        // Create a new document in MongoDB
        const newDoc = new Document({
            documentId: documentId,
            title: req.body.title || 'Untitled Document',
            content: req.body.content || ''
        });

        await newDoc.save();

        console.log('[Document Service] Document created:', documentId);

        // Send back the created document info
        res.status(201).json({
            success: true,
            message: 'Document created successfully',
            document: {
                documentId: newDoc.documentId,
                title: newDoc.title,
                content: newDoc.content,
                createdAt: newDoc.createdAt,
                updatedAt: newDoc.updatedAt
            }
        });
    } catch (error) {
        console.error('[Document Service] Error creating document:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed to create document',
            error: error.message
        });
    }
}

// ============================================================
// GET: Get a document by its ID
// REST: GET /api/documents/:documentId
// 
// This is the endpoint the API Gateway calls (RPC-style).
// The gateway requests document data WITHOUT accessing MongoDB directly.
// ============================================================
async function getDocument(req, res) {
    try {
        const documentId = req.params.documentId;

        // Find the document in MongoDB
        const doc = await Document.findOne({ documentId: documentId });

        if (!doc) {
            return res.status(404).json({
                success: false,
                message: 'Document not found. Please check the Document ID.'
            });
        }

        console.log('[Document Service] Document retrieved:', documentId);

        res.status(200).json({
            success: true,
            document: {
                documentId: doc.documentId,
                title: doc.title,
                content: doc.content,
                createdAt: doc.createdAt,
                updatedAt: doc.updatedAt
            }
        });
    } catch (error) {
        console.error('[Document Service] Error getting document:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve document',
            error: error.message
        });
    }
}

// ============================================================
// UPDATE: Update a document's content and save a version
// REST: PUT /api/documents/:documentId
// ============================================================
async function updateDocument(req, res) {
    try {
        const documentId = req.params.documentId;

        // Find the document
        const doc = await Document.findOne({ documentId: documentId });

        if (!doc) {
            return res.status(404).json({
                success: false,
                message: 'Document not found'
            });
        }

        // Update the document content
        doc.title = req.body.title || doc.title;
        doc.content = req.body.content !== undefined ? req.body.content : doc.content;
        doc.updatedAt = Date.now();
        await doc.save();

        // Count existing versions to determine the next version number
        const versionCount = await DocumentVersion.countDocuments({ documentId: documentId });

        // Create a new version snapshot
        const version = new DocumentVersion({
            documentId: documentId,
            versionNumber: versionCount + 1,
            content: doc.content,
            title: doc.title,
            savedBy: req.body.savedBy || 'Unknown',
            timestamp: Date.now()
        });
        await version.save();

        console.log('[Document Service] Document updated:', documentId, '→ Version', version.versionNumber);

        res.status(200).json({
            success: true,
            message: 'Document saved successfully',
            document: {
                documentId: doc.documentId,
                title: doc.title,
                content: doc.content,
                updatedAt: doc.updatedAt
            },
            version: {
                versionNumber: version.versionNumber,
                savedBy: version.savedBy,
                timestamp: version.timestamp
            }
        });
    } catch (error) {
        console.error('[Document Service] Error updating document:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed to update document',
            error: error.message
        });
    }
}

// ============================================================
// VERSIONS: Get version history for a document
// REST: GET /api/documents/:documentId/versions
// ============================================================
async function getVersions(req, res) {
    try {
        const documentId = req.params.documentId;

        // Check document exists
        const doc = await Document.findOne({ documentId: documentId });
        if (!doc) {
            return res.status(404).json({
                success: false,
                message: 'Document not found'
            });
        }

        // Get all versions sorted by version number (newest first)
        const versions = await DocumentVersion.find({ documentId: documentId })
            .sort({ versionNumber: -1 });

        console.log('[Document Service] Retrieved', versions.length, 'versions for:', documentId);

        res.status(200).json({
            success: true,
            documentId: documentId,
            versions: versions.map(function (v) {
                return {
                    versionNumber: v.versionNumber,
                    title: v.title,
                    content: v.content,
                    savedBy: v.savedBy,
                    timestamp: v.timestamp
                };
            })
        });
    } catch (error) {
        console.error('[Document Service] Error getting versions:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve version history',
            error: error.message
        });
    }
}

module.exports = {
    createDocument,
    getDocument,
    updateDocument,
    getVersions
};
