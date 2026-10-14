/**
 * Document Model (Mongoose Schema)
 * =================================
 * Stores document data in MongoDB.
 * 
 * DISTRIBUTED SYSTEMS CONCEPT:
 * This model is managed ONLY by the Document Service (port 5001).
 * The API Gateway does NOT access MongoDB directly — it makes
 * an HTTP request (RPC-style) to the Document Service instead.
 * This separation is a key design principle of distributed systems.
 */

const mongoose = require('mongoose');

const documentSchema = new mongoose.Schema({
    // Unique 6-character document ID (e.g., "ABC123")
    // This is the ID users share to collaborate on the same document
    documentId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },

    // Document title
    title: {
        type: String,
        default: 'Untitled Document'
    },

    // The actual text content of the document
    content: {
        type: String,
        default: ''
    },

    // When the document was first created
    createdAt: {
        type: Date,
        default: Date.now
    },

    // When the document was last updated
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

// Automatically update the `updatedAt` field before saving
documentSchema.pre('save', function (next) {
    this.updatedAt = Date.now();
    next();
});

module.exports = mongoose.model('Document', documentSchema);
