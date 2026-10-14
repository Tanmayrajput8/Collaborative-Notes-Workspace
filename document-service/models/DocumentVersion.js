/**
 * DocumentVersion Model (Mongoose Schema)
 * ========================================
 * Stores version history of documents in MongoDB.
 * Each time a user clicks "Save", a new version is created.
 * 
 * This allows users to view and restore previous versions
 * of a document, providing basic version control.
 */

const mongoose = require('mongoose');

const documentVersionSchema = new mongoose.Schema({
    // Reference to the parent document
    documentId: {
        type: String,
        required: true,
        index: true
    },

    // Sequential version number (1, 2, 3, ...)
    versionNumber: {
        type: Number,
        required: true
    },

    // Content snapshot at the time of saving
    content: {
        type: String,
        default: ''
    },

    // Title at the time of saving
    title: {
        type: String,
        default: ''
    },

    // Name of the user who saved this version
    savedBy: {
        type: String,
        default: 'Unknown'
    },

    // When this version was saved
    timestamp: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('DocumentVersion', documentVersionSchema);
