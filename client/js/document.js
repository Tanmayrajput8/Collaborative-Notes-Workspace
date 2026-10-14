/**
 * document.js — Client-Side Document Editor Controller
 * =====================================================
 * Handles real-time document editing, user presence, in-document chat,
 * and version snapshot management.
 *
 * Distributed Systems additions (Unit III):
 *   - Each outgoing Socket.IO event is stamped with the local Lamport
 *     clock and the local vector clock entry.
 *   - Incoming events update the local clocks (max + 1 rule).
 *   - These clocks are shared with dsync.js for display.
 */

'use strict';

const API_GATEWAY_URL = window.location.origin;

// Parse document ID from URL query string (?docId=ABC123)
const urlParams = new URLSearchParams(window.location.search);
const docId = urlParams.get('docId');

// Retrieve user identity from sessionStorage
let userInfo = JSON.parse(sessionStorage.getItem('userInfo') || '{}');

// Redirect to home if user has no name (e.g., direct link)
if (!userInfo.name) {
    window.location.href = `index.html?docId=${docId}`;
}

// ============================================================
// LOCAL LAMPORT CLOCK
// Shared with dsync.js via window.dsLocalClock
// ============================================================
window.dsLocalClock = 0;

function localClockTick() {
    window.dsLocalClock += 1;
    return window.dsLocalClock;
}

function localClockReceive(received) {
    window.dsLocalClock = Math.max(window.dsLocalClock, typeof received === 'number' ? received : 0) + 1;
    return window.dsLocalClock;
}

// ============================================================
// LOCAL VECTOR CLOCK (own entry only, keyed by userId)
// Full merging happens server-side; we carry our own component.
// ============================================================
window.dsLocalVector = {};

function vectorTick(userId) {
    window.dsLocalVector[userId] = (window.dsLocalVector[userId] || 0) + 1;
    return Object.assign({}, window.dsLocalVector);
}

function vectorMerge(received) {
    if (received && typeof received === 'object') {
        for (const [uid, val] of Object.entries(received)) {
            window.dsLocalVector[uid] = Math.max(
                window.dsLocalVector[uid] || 0,
                typeof val === 'number' ? val : 0
            );
        }
    }
}

// ============================================================
// DOM ELEMENTS
// ============================================================
const docTitle        = document.getElementById('docTitle');
const docIdDisplay    = document.getElementById('docIdDisplay');
const titleInput      = document.getElementById('titleInput');
const editor          = document.getElementById('editor');
const saveBtn         = document.getElementById('saveBtn');
const lastSaved       = document.getElementById('lastSaved');
const connectionStatus = document.getElementById('connectionStatus');
const usersList       = document.getElementById('usersList');
const messagesContainer = document.getElementById('messagesContainer');
const messageInput    = document.getElementById('messageInput');
const sendMsgBtn      = document.getElementById('sendMsgBtn');
const versionList     = document.getElementById('versionList');
const shareBtn        = document.getElementById('shareBtn');
const backBtn         = document.getElementById('backBtn');
const toast           = document.getElementById('toast');

// Center Editor Lock Banner Elements
const editorLockBanner = document.getElementById('editorLockBanner');
const editorLockBadge  = document.getElementById('editorLockBadge');
const editorLockMsg    = document.getElementById('editorLockMsg');
const editorLockSub    = document.getElementById('editorLockSub');

// Track lock holder state for typing interception
let currentLockHolderName = null;
let currentIsLockedByOther = false;
if (docIdDisplay) docIdDisplay.textContent = docId;

// Helper: Toast Notifications
function showToast(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// Helper: Get User Initials for Avatar
function getInitials(name) {
    if (!name) return 'U';
    const parts = name.trim().split(' ');
    if (parts.length >= 2) {
        return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
}

// ============================================================
// SOCKET.IO CONNECTION
// ============================================================
const socket = io(API_GATEWAY_URL, {
    transports: ['polling', 'websocket'],
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000
});

// Expose socket globally for dsync.js
window.collabSocket  = socket;
window.currentDocId  = docId;
window.currentUserInfo = userInfo;

// Connection Status Handlers
socket.on('connect', function () {
    console.log('[Socket.IO] Connected. Socket ID:', socket.id);
    if (connectionStatus) {
        connectionStatus.innerHTML = '<span class="status-dot connected"></span> Connected';
    }

    // Join document room — Lamport tick before sending
    const lt = localClockTick();
    const vc = vectorTick(userInfo.userId);

    socket.emit('document:join', {
        documentId:  docId,
        userId:      userInfo.userId,
        userName:    userInfo.name,
        lamportTime: lt,
        vector:      vc
    });
});

socket.on('disconnect', function () {
    console.log('[Socket.IO] Disconnected');
    if (connectionStatus) {
        connectionStatus.innerHTML = '<span class="status-dot disconnected"></span> Disconnected';
    }
});

socket.on('connect_error', function () {
    if (connectionStatus) {
        connectionStatus.innerHTML = '<span class="status-dot reconnecting"></span> Reconnecting...';
    }
});

// ============================================================
// USER PRESENCE
// ============================================================
socket.on('room:users', function (users) {
    renderUsersList(users);
});

socket.on('user:joined', function (data) {
    localClockReceive(data.lamportTime);
    vectorMerge(data.vector);
    showToast(`${data.userName} joined the document.`);
});

socket.on('user:left', function (data) {
    localClockReceive(data.lamportTime);
    vectorMerge(data.vector);
    showToast(`${data.userName} left the document.`);
});

function renderUsersList(users) {
    if (!usersList) return;
    usersList.innerHTML = '';
    if (!users || users.length === 0) {
        usersList.innerHTML = '<li class="text-muted" style="font-size:12px;">No users online</li>';
        return;
    }
    users.forEach(u => {
        const li = document.createElement('li');
        const isSelf = u.userId === userInfo.userId ? ' (You)' : '';
        const initials = getInitials(u.userName);
        li.innerHTML = `
            <div class="user-avatar">${escapeHtml(initials)}</div>
            <span>${escapeHtml(u.userName)}${isSelf}</span>
            <span class="user-status-dot"></span>
        `;
        usersList.appendChild(li);
    });
}

// ============================================================
// MUTUAL EXCLUSION: EDITOR LOCK STATE HANDLER
// ============================================================
window.applyEditorLockState = function (state) {
    if (!state) return;

    const isLocked = !!state.locked;
    const socketId = socket && socket.id;
    const iAmHolder = isLocked && state.holder && (
        state.holder.socketId ? state.holder.socketId === socketId : state.holder.userId === userInfo.userId
    );

    currentIsLockedByOther = isLocked && !iAmHolder;
    currentLockHolderName  = (isLocked && state.holder) ? state.holder.userName : null;

    if (currentIsLockedByOther) {
        // Locked by another user -> Read-only mode
        editor.readOnly = true;
        editor.classList.add('editor-locked');
        editor.classList.remove('editor-locked-owner');

        titleInput.readOnly = true;
        titleInput.classList.add('editor-locked');

        saveBtn.disabled = true;
        saveBtn.title = `Editing is locked by ${state.holder.userName}`;

        if (editorLockBanner) {
            editorLockBanner.style.display = 'flex';
            editorLockBanner.className = 'editor-lock-banner locked-by-other';
            if (editorLockBadge) editorLockBadge.textContent = 'Locked';
            if (editorLockMsg) editorLockMsg.textContent = `Editing locked by ${state.holder.userName}`;

            const waiting = Array.isArray(state.waitingUsers) ? state.waitingUsers : [];
            const amInQueue = waiting.includes(userInfo.name);
            if (editorLockSub) {
                if (amInQueue) {
                    const queuePos = waiting.indexOf(userInfo.name) + 1;
                    editorLockSub.textContent = `You are in the waiting queue (position #${queuePos}). The editor is in read-only mode until the lock is released.`;
                } else {
                    editorLockSub.textContent = `Document editing is locked by ${state.holder.userName}. You can view changes in real-time, but typing is disabled.`;
                }
            }
        }
    } else if (isLocked && iAmHolder) {
        // Current user holds the lock -> Exclusive editing mode
        editor.readOnly = false;
        editor.classList.remove('editor-locked');
        editor.classList.add('editor-locked-owner');

        titleInput.readOnly = false;
        titleInput.classList.remove('editor-locked');

        saveBtn.disabled = false;
        saveBtn.title = 'Save your changes';

        if (editorLockBanner) {
            editorLockBanner.style.display = 'flex';
            editorLockBanner.className = 'editor-lock-banner locked-by-me';
            if (editorLockBadge) editorLockBadge.textContent = 'Lock Held';
            if (editorLockMsg) editorLockMsg.textContent = 'You have the editing lock';
            if (editorLockSub) {
                editorLockSub.textContent = 'You have exclusive editing access. Other collaborators are in read-only mode.';
            }
        }
    } else {
        // Lock available -> Standard collaborative editing mode
        editor.readOnly = false;
        editor.classList.remove('editor-locked', 'editor-locked-owner');

        titleInput.readOnly = false;
        titleInput.classList.remove('editor-locked');

        saveBtn.disabled = false;
        saveBtn.title = 'Save to Database';

        if (editorLockBanner) {
            editorLockBanner.style.display = 'none';
        }
    }
};

// ============================================================
// REAL-TIME DOCUMENT EDITING STREAM
// ============================================================
let isRemoteUpdate = false;

// Intercept typing attempts when locked by another user
editor.addEventListener('keydown', function (e) {
    if (currentIsLockedByOther) {
        // Allow navigation keys & copy commands
        if (
            ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown', 'Tab'].includes(e.key) ||
            ((e.ctrlKey || e.metaKey) && ['c', 'a'].includes(e.key.toLowerCase()))
        ) {
            return;
        }
        e.preventDefault();
        showToast(`Editing is locked by ${currentLockHolderName || 'another user'}.`);
    }
});

editor.addEventListener('paste', function (e) {
    if (currentIsLockedByOther) {
        e.preventDefault();
        showToast(`Editing is locked by ${currentLockHolderName || 'another user'}.`);
    }
});

titleInput.addEventListener('keydown', function (e) {
    if (currentIsLockedByOther) {
        if (
            ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key) ||
            ((e.ctrlKey || e.metaKey) && ['c', 'a'].includes(e.key.toLowerCase()))
        ) {
            return;
        }
        e.preventDefault();
        showToast(`Editing is locked by ${currentLockHolderName || 'another user'}.`);
    }
});

editor.addEventListener('input', function () {
    if (isRemoteUpdate) return;
    if (currentIsLockedByOther) {
        showToast(`Editing is locked by ${currentLockHolderName || 'another user'}.`);
        return;
    }

    if (lastSaved) lastSaved.textContent = 'Unsaved changes...';

    const lt = localClockTick();
    const vc = vectorTick(userInfo.userId);

    socket.emit('document:edit', {
        documentId:  docId,
        userId:      userInfo.userId,
        userName:    userInfo.name,
        content:     editor.value,
        timestamp:   new Date().toISOString(),
        lamportTime: lt,
        vector:      vc
    });
});

socket.on('document:edit', function (data) {
    if (data.userId === userInfo.userId) return;

    localClockReceive(data.lamportTime);
    vectorMerge(data.vector);

    isRemoteUpdate = true;
    const start = editor.selectionStart;
    const end   = editor.selectionEnd;

    editor.value = data.content;
    editor.setSelectionRange(start, end);
    if (lastSaved) lastSaved.textContent = `Edited by ${data.userName}`;
    isRemoteUpdate = false;
});

titleInput.addEventListener('input', function () {
    if (currentIsLockedByOther) {
        showToast(`Editing is locked by ${currentLockHolderName || 'another user'}.`);
        return;
    }

    if (docTitle) docTitle.textContent = titleInput.value || 'Untitled Document';

    const lt = localClockTick();
    const vc = vectorTick(userInfo.userId);

    socket.emit('document:title', {
        documentId:  docId,
        userId:      userInfo.userId,
        userName:    userInfo.name,
        title:       titleInput.value,
        lamportTime: lt,
        vector:      vc
    });
});

socket.on('document:title', function (data) {
    localClockReceive(data.lamportTime);
    vectorMerge(data.vector);
    titleInput.value = data.title;
    if (docTitle) docTitle.textContent = data.title || 'Untitled Document';
});

// Socket.IO Lock Listeners in document.js
socket.on('lock:state', function (state) {
    window.applyEditorLockState(state);
});

socket.on('lock:violation', function (data) {
    showToast(data.message);
    if (data.lock) window.applyEditorLockState(data.lock);
});

socket.on('lock:eligible', function (data) {
    showToast(data.message || 'You can now acquire the document lock!');
});

// ============================================================
// IN-DOCUMENT CHAT
// ============================================================
function sendMessage() {
    const text = messageInput.value.trim();
    if (!text) return;

    const lt = localClockTick();
    const vc = vectorTick(userInfo.userId);

    socket.emit('message:send', {
        documentId:  docId,
        userId:      userInfo.userId,
        userName:    userInfo.name,
        text:        text,
        timestamp:   new Date().toISOString(),
        lamportTime: lt,
        vector:      vc
    });

    messageInput.value = '';
}

sendMsgBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', function (e) {
    if (e.key === 'Enter') sendMessage();
});

socket.on('message:receive', function (data) {
    localClockReceive(data.lamportTime);
    vectorMerge(data.vector);

    const msgDiv = document.createElement('div');
    msgDiv.className = 'chat-msg';
    const time = new Date(data.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    msgDiv.innerHTML = `<span class="chat-msg-sender">${escapeHtml(data.userName)}:</span> ${escapeHtml(data.text)} <span class="chat-msg-time">${time}</span>`;
    messagesContainer.appendChild(msgDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
});

// ============================================================
// REST API: LOAD & SAVE DOCUMENT
// ============================================================
async function loadDocument() {
    try {
        const response = await fetch(`${API_GATEWAY_URL}/api/documents/${docId}`);
        const data = await response.json();

        if (response.ok && data.success && data.document) {
            titleInput.value = data.document.title || 'Untitled Document';
            if (docTitle) docTitle.textContent = data.document.title || 'Untitled Document';
            editor.value = data.document.content || '';
            if (lastSaved) lastSaved.textContent = 'Loaded from database';
        } else {
            if (lastSaved) lastSaved.textContent = 'New Document';
        }
    } catch (error) {
        console.error('[Document] Load error:', error);
        if (lastSaved) lastSaved.textContent = 'Offline';
    }
}

async function loadVersionHistory() {
    try {
        const response = await fetch(`${API_GATEWAY_URL}/api/documents/${docId}/versions`);
        const data = await response.json();

        if (response.ok && data.success && data.versions) {
            renderVersionHistory(data.versions);
        }
    } catch (error) {
        console.error('[Document] Version load error:', error);
    }
}

function renderVersionHistory(versions) {
    if (!versionList) return;
    versionList.innerHTML = '';
    if (!versions || versions.length === 0) {
        versionList.innerHTML = '<li class="text-muted" style="font-size:12px;">No versions saved yet.</li>';
        return;
    }

    versions.forEach(v => {
        const li = document.createElement('li');
        li.className = 'version-item';
        const time = new Date(v.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        li.innerHTML = `
            <div class="version-header">
                <span class="version-badge">Version ${v.versionNumber}</span>
                <span class="version-time">${time}</span>
            </div>
            <div class="version-author">Saved by ${escapeHtml(v.savedBy)}</div>
        `;
        li.addEventListener('click', function () {
            if (confirm(`Restore snapshot from Version ${v.versionNumber}?`)) {
                editor.value = v.content;
                titleInput.value = v.title || titleInput.value;
                if (docTitle) docTitle.textContent = v.title || docTitle.textContent;

                const lt = localClockTick();
                const vc = vectorTick(userInfo.userId);

                socket.emit('document:edit', {
                    documentId:  docId,
                    userId:      userInfo.userId,
                    userName:    userInfo.name,
                    content:     editor.value,
                    timestamp:   new Date().toISOString(),
                    lamportTime: lt,
                    vector:      vc
                });
                showToast(`Restored Version ${v.versionNumber}.`);
            }
        });
        versionList.appendChild(li);
    });
}

// Save Document
saveBtn.addEventListener('click', async function () {
    try {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';

        const response = await fetch(`${API_GATEWAY_URL}/api/documents/${docId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title:   titleInput.value || 'Untitled Document',
                content: editor.value,
                savedBy: userInfo.name
            })
        });

        const data = await response.json();

        if (response.ok && data.success) {
            const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            if (lastSaved) lastSaved.textContent = `Saved at ${time} (v${data.version.versionNumber})`;
            showToast(`Document saved (Version ${data.version.versionNumber}).`);

            const lt = localClockTick();
            const vc = vectorTick(userInfo.userId);

            socket.emit('document:save', {
                documentId:    docId,
                userId:        userInfo.userId,
                savedBy:       userInfo.name,
                versionNumber: data.version.versionNumber,
                timestamp:     data.version.timestamp,
                lamportTime:   lt,
                vector:        vc
            });

            loadVersionHistory();
        } else {
            showToast(data.message || 'Failed to save.');
        }
    } catch (error) {
        console.error('[Document] Save error:', error);
        showToast('Error saving to server.');
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save to Database';
    }
});

socket.on('document:saved', function (data) {
    localClockReceive(data.lamportTime);
    vectorMerge(data.vector);
    showToast(`${data.savedBy} saved Version ${data.versionNumber}.`);
    loadVersionHistory();
});

// Header Actions
shareBtn.addEventListener('click', function () {
    const url = window.location.href;
    navigator.clipboard.writeText(url).then(() => {
        showToast('Document link copied.');
    }).catch(() => {
        showToast(`Document ID: ${docId}`);
    });
});

if (docIdDisplay) {
    docIdDisplay.addEventListener('click', function () {
        navigator.clipboard.writeText(docId).then(() => {
            showToast(`Document ID ${docId} copied.`);
        });
    });
}

backBtn.addEventListener('click', function () {
    window.location.href = 'index.html';
});

// Helper: Escape HTML
function escapeHtml(text) {
    if (!text) return '';
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return text.toString().replace(/[&<>"']/g, function (m) { return map[m]; });
}

// Initial Load
loadDocument();
loadVersionHistory();
