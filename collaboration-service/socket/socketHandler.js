/**
 * Socket.IO Handler for Collaboration Service
 * ============================================
 * Handles real-time communication events between distributed clients.
 *
 * DISTRIBUTED SYSTEMS CONCEPTS DEMONSTRATED (Unit III):
 *
 * 1. MESSAGE-ORIENTED COMMUNICATION (Unit II):
 *    Socket.IO events for real-time document editing, chat, and notifications.
 *
 * 2. STREAM-ORIENTED COMMUNICATION (Unit II):
 *    Continuous editing updates over a persistent WebSocket connection.
 *
 * 3. PEER-TO-PEER (P2P) MESSAGING (Unit II):
 *    Collaborator chat inside the document.
 *
 * 4. WEBRTC SIGNALING (Unit II):
 *    Relays SDP/ICE candidates between peers.
 *
 * 5. MUTUAL EXCLUSION — Document Lock (Unit III):
 *    A server-authoritative per-document lock controls access to a
 *    protected editing operation (e.g., bulk save / restore). Only one
 *    user may hold the lock at a time. The lock expires automatically
 *    after LOCK_TTL_MS to recover from crashes or network failures.
 *    The server is the authority; clients never self-grant the lock.
 *
 * 6. LAMPORT LOGICAL CLOCK (Unit III):
 *    Each document room maintains a monotonically increasing logical
 *    clock. Every distributed event is stamped. On receiving a remote
 *    event: clock = max(local, received) + 1.
 *
 * 7. VECTOR CLOCK / CAUSALITY (Unit III):
 *    Each document room maintains a vector clock indexed by userId.
 *    Events include the sender's vector. Receivers merge (component-wise
 *    max) and advance their own entry. Concurrent vs. causal ordering
 *    is computed on the server and sent back to clients.
 *
 * 8. GLOBAL STATE SNAPSHOT (Unit III):
 *    On demand, the server collects the complete distributed state of a
 *    document room (users, lock, clocks, recent events) and returns it.
 */

'use strict';

// ============================================================
// CONSTANTS
// ============================================================
const LOCK_TTL_MS = 30000;       // Lock auto-expires after 30 s
const EVENT_HISTORY_SIZE = 50;   // Keep last N distributed events per room

// ============================================================
// PER-DOCUMENT ROOM STATE
//
// documentRooms : Map<documentId, RoomState>
//
// RoomState = {
//   users      : Map<socketId, { userId, userName }>,
//   lock       : null | { holder:{ userId, userName, socketId },
//                         acquiredAt: Date, expiresAt: Date,
//                         timer: TimeoutHandle },
//   lamport    : number,          // Lamport logical clock
//   vector     : Map<userId, number>,  // Vector clock
//   events     : EventRecord[],   // Recent distributed events
// }
// ============================================================
const documentRooms = new Map();

// ============================================================
// HELPERS
// ============================================================

function getRoom(documentId) {
    if (!documentRooms.has(documentId)) {
        documentRooms.set(documentId, {
            users:        new Map(),
            lock:         null,
            waitingQueue: [],
            lamport:      0,
            vector:       new Map(),
            events:       []
        });
    }
    const r = documentRooms.get(documentId);
    if (!r.waitingQueue) r.waitingQueue = [];
    return r;
}

/**
 * Lamport clock — local increment (called before emitting a local event).
 * Returns the new clock value.
 */
function lamportIncrement(room) {
    room.lamport += 1;
    return room.lamport;
}

/**
 * Lamport clock — receive rule.
 * clock = max(local, received) + 1
 */
function lamportReceive(room, received) {
    room.lamport = Math.max(room.lamport, typeof received === 'number' ? received : 0) + 1;
    return room.lamport;
}

/**
 * Vector clock — increment own entry, return snapshot copy.
 */
function vectorIncrement(room, userId) {
    const cur = room.vector.get(userId) || 0;
    room.vector.set(userId, cur + 1);
    return vectorSnapshot(room);
}

/**
 * Vector clock — merge received vector (component-wise max), then
 * increment the local userId entry.  Returns snapshot after merge.
 */
function vectorMerge(room, userId, receivedVector) {
    if (receivedVector && typeof receivedVector === 'object') {
        for (const [uid, val] of Object.entries(receivedVector)) {
            const existing = room.vector.get(uid) || 0;
            room.vector.set(uid, Math.max(existing, typeof val === 'number' ? val : 0));
        }
    }
    // Increment our own entry after merge
    const cur = room.vector.get(userId) || 0;
    room.vector.set(userId, cur + 1);
    return vectorSnapshot(room);
}

/**
 * Return vector clock as a plain object (safe for JSON serialisation).
 */
function vectorSnapshot(room) {
    const obj = {};
    for (const [uid, val] of room.vector.entries()) {
        obj[uid] = val;
    }
    return obj;
}

/**
 * Determine the causal relationship between two vector clocks.
 * Returns: 'before' | 'after' | 'concurrent' | 'same'
 */
function causalRelation(va, vb) {
    if (!va || !vb) return 'unknown';
    const keys = new Set([...Object.keys(va), ...Object.keys(vb)]);
    let aLessOrEqual = true;
    let bLessOrEqual = true;
    for (const k of keys) {
        const a = va[k] || 0;
        const b = vb[k] || 0;
        if (a > b) bLessOrEqual = false;
        if (b > a) aLessOrEqual = false;
    }
    if (aLessOrEqual && bLessOrEqual) return 'same';
    if (aLessOrEqual) return 'before';
    if (bLessOrEqual) return 'after';
    return 'concurrent';
}

/**
 * Append an event record to the room's history ring-buffer.
 */
function recordEvent(room, { type, userId, userName, lamportTime, vector }) {
    room.events.push({
        type,
        userId,
        userName,
        lamportTime,
        vector,
        wallTime: new Date().toISOString()
    });
    if (room.events.length > EVENT_HISTORY_SIZE) {
        room.events.shift();
    }
}

/**
 * Release the lock for a document room (internal helper).
 * Clears the expiry timer and nulls the lock field.
 */
function releaseLock(room, documentId, io, reason) {
    if (!room.lock) return;
    clearTimeout(room.lock.timer);
    const prevHolder = room.lock.holder;
    room.lock = null;

    // Lamport tick for lock-release event
    const lt = lamportIncrement(room);
    const vc = vectorSnapshot(room);

    recordEvent(room, {
        type:        'Lock Released',
        userId:      prevHolder.userId,
        userName:    prevHolder.userName,
        lamportTime: lt,
        vector:      vc
    });

    // Broadcast lock state to the room
    io.to(documentId).emit('lock:state', buildLockState(room, lt, vc));
    console.log(
        `[Lock] Released for doc ${documentId} — holder was ${prevHolder.userName} (${reason})`
    );

    // Notify next in waiting queue if any
    if (room.waitingQueue && room.waitingQueue.length > 0) {
        const nextUser = room.waitingQueue[0];
        io.to(nextUser.socketId).emit('lock:eligible', {
            documentId,
            userName: nextUser.userName,
            message: `The lock was released by ${prevHolder.userName}. You are next in line to acquire the lock.`
        });
    }
}

function buildLockState(room, lamportTime, vc) {
    const waitingUsers = [];
    if (room.waitingQueue && Array.isArray(room.waitingQueue)) {
        for (const item of room.waitingQueue) {
            waitingUsers.push(item.userName);
        }
    }
    return {
        locked:       room.lock !== null,
        holder:       room.lock ? room.lock.holder : null,
        acquiredAt:   room.lock ? room.lock.acquiredAt : null,
        expiresAt:    room.lock ? room.lock.expiresAt : null,
        waitingUsers: waitingUsers,
        lamportTime:  lamportTime !== undefined ? lamportTime : room.lamport,
        vector:       vc !== undefined ? vc : vectorSnapshot(room)
    };
}

// ============================================================
// MAIN SETUP
// ============================================================
function setupSocketHandlers(io) {
    io.on('connection', function (socket) {
        console.log('[Collaboration Service] Client connected:', socket.id);

        let currentDocumentId = null;
        let currentUser = null;

        // ============================================================
        // EVENT: document:join
        // ============================================================
        socket.on('document:join', function (data) {
            const { documentId, userId, userName } = data;
            if (!documentId || !userId || !userName) return;

            currentDocumentId = documentId;
            currentUser = { userId, userName, socketId: socket.id };

            socket.join(documentId);

            const room = getRoom(documentId);
            room.users.set(socket.id, { userId, userName });

            // Lamport + Vector
            const lt = lamportIncrement(room);
            const vc = vectorIncrement(room, userId);

            recordEvent(room, {
                type:        'User Joined',
                userId,
                userName,
                lamportTime: lt,
                vector:      vc
            });

            const userList = Array.from(room.users.values());
            console.log(`[Collaboration Service] ${userName} (${userId}) joined room: ${documentId}`);

            // Broadcast updated user list and sync clocks
            io.to(documentId).emit('room:users', userList);

            socket.to(documentId).emit('user:joined', {
                userId, userName,
                timestamp:   new Date().toISOString(),
                lamportTime: lt,
                vector:      vc
            });

            // Send current lock state to the joining user
            socket.emit('lock:state', buildLockState(room, lt, vc));

            // Send recent events to the joining user
            socket.emit('sync:events', room.events.slice(-20));
        });

        // ============================================================
        // EVENT: document:edit
        // Backend Authoritative Lock Enforcement:
        // If a lock is held, only the current lock holder socket/user
        // is allowed to broadcast document edits.
        // ============================================================
        socket.on('document:edit', function (data) {
            const room = documentRooms.get(data.documentId);
            if (!room) return;

            // Reject if locked by someone else
            if (room.lock && room.lock.holder.socketId !== socket.id && room.lock.holder.userId !== data.userId) {
                console.warn(
                    `[Lock Violation] Blocked document:edit on ${data.documentId} from ${data.userName} (${socket.id}) — lock held by ${room.lock.holder.userName}`
                );
                socket.emit('lock:violation', {
                    message: `Editing is locked by ${room.lock.holder.userName}. Your changes were not applied.`,
                    lock: buildLockState(room, room.lamport, vectorSnapshot(room))
                });
                return;
            }

            // If current lock holder is editing, refresh lease timer (inactivity reset)
            if (room.lock && (room.lock.holder.socketId === socket.id || room.lock.holder.userId === data.userId)) {
                clearTimeout(room.lock.timer);
                room.lock.expiresAt = new Date(Date.now() + LOCK_TTL_MS);
                room.lock.timer = setTimeout(function () {
                    const r = documentRooms.get(data.documentId);
                    if (r && r.lock && r.lock.holder.socketId === socket.id) {
                        releaseLock(r, data.documentId, io, 'TTL expiry');
                    }
                }, LOCK_TTL_MS);
            }

            const lt = lamportReceive(room, data.lamportTime);
            const vc = vectorMerge(room, data.userId, data.vector);

            recordEvent(room, {
                type:        'Document Edit',
                userId:      data.userId,
                userName:    data.userName,
                lamportTime: lt,
                vector:      vc
            });

            socket.to(data.documentId).emit('document:edit', {
                documentId:  data.documentId,
                userId:      data.userId,
                userName:    data.userName,
                content:     data.content,
                timestamp:   data.timestamp || new Date().toISOString(),
                lamportTime: lt,
                vector:      vc
            });

            // Broadcast updated event log
            io.to(data.documentId).emit('sync:events', room.events.slice(-20));
        });

        // ============================================================
        // EVENT: document:title
        // Protected by lock if active.
        // ============================================================
        socket.on('document:title', function (data) {
            const room = documentRooms.get(data.documentId);
            if (!room) return;

            if (room.lock && room.lock.holder.socketId !== socket.id && room.lock.holder.userId !== data.userId) {
                socket.emit('lock:violation', {
                    message: `Title editing is locked by ${room.lock.holder.userName}.`,
                    lock: buildLockState(room, room.lamport, vectorSnapshot(room))
                });
                return;
            }

            const lt = lamportReceive(room, data.lamportTime);
            const vc = vectorMerge(room, data.userId || 'unknown', data.vector);

            recordEvent(room, {
                type:        'Title Update',
                userId:      data.userId || 'unknown',
                userName:    data.userName || 'Unknown',
                lamportTime: lt,
                vector:      vc
            });

            socket.to(data.documentId).emit('document:title', {
                documentId:  data.documentId,
                title:       data.title,
                lamportTime: lt,
                vector:      vc
            });
        });

        // ============================================================
        // EVENT: document:save
        // ============================================================
        socket.on('document:save', function (data) {
            const room = documentRooms.get(data.documentId);
            if (!room) return;

            if (room.lock && room.lock.holder.socketId !== socket.id && room.lock.holder.userId !== data.userId) {
                socket.emit('lock:violation', {
                    message: `Saving is locked by ${room.lock.holder.userName}.`,
                    lock: buildLockState(room, room.lamport, vectorSnapshot(room))
                });
                return;
            }

            const lt = lamportReceive(room, data.lamportTime);
            const vc = vectorMerge(room, data.userId || 'unknown', data.vector);

            recordEvent(room, {
                type:        'Document Saved',
                userId:      data.userId || 'unknown',
                userName:    data.savedBy || 'Unknown',
                lamportTime: lt,
                vector:      vc
            });

            socket.to(data.documentId).emit('document:saved', {
                documentId:    data.documentId,
                savedBy:       data.savedBy,
                versionNumber: data.versionNumber,
                timestamp:     data.timestamp,
                lamportTime:   lt,
                vector:        vc
            });
        });

        // ============================================================
        // EVENT: message:send
        // Chat remains open and unrestricted even during document locks.
        // ============================================================
        socket.on('message:send', function (data) {
            console.log(
                `[Collaboration Service] Chat in ${data.documentId} from ${data.userName}: ${data.text}`
            );

            const room = documentRooms.get(data.documentId);
            if (!room) return;

            const lt = lamportReceive(room, data.lamportTime);
            const vc = vectorMerge(room, data.userId, data.vector);

            recordEvent(room, {
                type:        'Chat Message',
                userId:      data.userId,
                userName:    data.userName,
                lamportTime: lt,
                vector:      vc
            });

            io.to(data.documentId).emit('message:receive', {
                userId:      data.userId,
                userName:    data.userName,
                text:        data.text,
                timestamp:   data.timestamp || new Date().toISOString(),
                lamportTime: lt,
                vector:      vc
            });

            io.to(data.documentId).emit('sync:events', room.events.slice(-20));
        });

        // ============================================================
        // MUTUAL EXCLUSION — Lock Acquire
        //
        // AUTHORITATIVE BACKEND RULES:
        // 1. If currently held by the same socket: return idempotent success.
        // 2. If held by the same user in a DIFFERENT socket/tab: reject
        //    to prevent split-brain state across tabs.
        // 3. If held by another user:
        //    - Do NOT overwrite the lock.
        //    - Append the user to the waiting queue (if not already queued).
        //    - Broadcast updated lock state with waiting list.
        //    - Return granted: false with clear reason.
        // 4. If free:
        //    - If there is a waiting queue, only the head of the queue can acquire.
        //    - Otherwise grant the lock immediately.
        //    - Set an expiry timer (LOCK_TTL_MS) to recover from crashes/hangs.
        // ============================================================
        socket.on('lock:acquire', function (data) {
            const { documentId, userId, userName, lamportTime, vector: receivedVector } = data;
            if (!documentId || !userId || !userName) {
                socket.emit('lock:acquire:response', {
                    granted: false,
                    reason:  'Missing required fields'
                });
                return;
            }

            const room = getRoom(documentId);
            const lt   = lamportReceive(room, lamportTime);
            const vc   = vectorMerge(room, userId, receivedVector);

            // Already held by this exact socket — idempotent
            if (room.lock && room.lock.holder.socketId === socket.id) {
                socket.emit('lock:acquire:response', {
                    granted: true,
                    reason:  'Already held by you',
                    lock:    buildLockState(room, lt, vc)
                });
                return;
            }

            // Held by same user ID from another browser tab
            if (room.lock && room.lock.holder.userId === userId && room.lock.holder.socketId !== socket.id) {
                socket.emit('lock:acquire:response', {
                    granted: false,
                    reason:  'Document lock is already held by another browser tab or session of your account.',
                    lock:    buildLockState(room, lt, vc)
                });
                return;
            }

            // Held by someone else
            if (room.lock) {
                const inQueue = room.waitingQueue.some(u => u.socketId === socket.id || u.userId === userId);
                if (!inQueue) {
                    room.waitingQueue.push({
                        userId,
                        userName,
                        socketId: socket.id,
                        lamportTime: lt,
                        requestedAt: new Date().toISOString()
                    });
                    recordEvent(room, {
                        type:        'Lock Queued',
                        userId,
                        userName,
                        lamportTime: lt,
                        vector:      vc
                    });
                } else {
                    recordEvent(room, {
                        type:        'Lock Request Denied',
                        userId,
                        userName,
                        lamportTime: lt,
                        vector:      vc
                    });
                }

                const lockState = buildLockState(room, lt, vc);
                io.to(documentId).emit('lock:state', lockState);
                io.to(documentId).emit('sync:events', room.events.slice(-20));

                socket.emit('lock:acquire:response', {
                    granted: false,
                    reason:  `Document is currently being modified by ${room.lock.holder.userName}. You are in the waiting queue.`,
                    lock:    lockState
                });
                return;
            }

            // Lock is free: check waiting queue priority
            if (room.waitingQueue && room.waitingQueue.length > 0) {
                const queueHead = room.waitingQueue[0];
                if (queueHead.userId !== userId && queueHead.socketId !== socket.id) {
                    const inQueue = room.waitingQueue.some(u => u.socketId === socket.id || u.userId === userId);
                    if (!inQueue) {
                        room.waitingQueue.push({
                            userId,
                            userName,
                            socketId: socket.id,
                            lamportTime: lt,
                            requestedAt: new Date().toISOString()
                        });
                    }
                    const lockState = buildLockState(room, lt, vc);
                    io.to(documentId).emit('lock:state', lockState);
                    socket.emit('lock:acquire:response', {
                        granted: false,
                        reason:  `${queueHead.userName} is next in the waiting queue. Please wait your turn.`,
                        lock:    lockState
                    });
                    return;
                } else {
                    // Current requester is head of queue — pop from queue
                    room.waitingQueue.shift();
                }
            }

            // Grant the lock
            const acquiredAt = new Date();
            const expiresAt  = new Date(acquiredAt.getTime() + LOCK_TTL_MS);
            const expiryTimer = setTimeout(function () {
                const r = documentRooms.get(documentId);
                if (r && r.lock && r.lock.holder.socketId === socket.id) {
                    releaseLock(r, documentId, io, 'TTL expiry');
                }
            }, LOCK_TTL_MS);

            room.lock = {
                holder:     { userId, userName, socketId: socket.id },
                acquiredAt,
                expiresAt,
                timer:      expiryTimer
            };

            recordEvent(room, {
                type:        'Lock Acquired',
                userId,
                userName,
                lamportTime: lt,
                vector:      vc
            });

            const lockState = buildLockState(room, lt, vc);
            io.to(documentId).emit('lock:state', lockState);
            io.to(documentId).emit('sync:events', room.events.slice(-20));

            socket.emit('lock:acquire:response', {
                granted: true,
                reason:  'Lock granted',
                lock:    lockState
            });

            console.log(`[Lock] Acquired for doc ${documentId} by ${userName} (${socket.id}) (expires ${expiresAt.toISOString()})`);
        });

        // ============================================================
        // MUTUAL EXCLUSION — Lock Release
        //
        // Rules:
        //   - Only the current holder may release the lock.
        //   - Ignore duplicate releases (already free).
        //   - The server validates the requester identity.
        // ============================================================
        socket.on('lock:release', function (data) {
            const { documentId, userId, lamportTime, vector: receivedVector } = data;
            if (!documentId || !userId) return;

            const room = documentRooms.get(documentId);
            if (!room) return;

            const lt = lamportReceive(room, lamportTime);
            const vc = vectorMerge(room, userId, receivedVector);

            // Not locked — silently return success (idempotent)
            if (!room.lock) {
                socket.emit('lock:release:response', {
                    released: true,
                    reason:   'Lock was already free'
                });
                return;
            }

            // Only the holder may release
            if (room.lock.holder.userId !== userId && room.lock.holder.socketId !== socket.id) {
                socket.emit('lock:release:response', {
                    released: false,
                    reason:   'You do not hold the lock'
                });
                return;
            }

            releaseLock(room, documentId, io, 'explicit release');
            io.to(documentId).emit('sync:events', room.events.slice(-20));

            socket.emit('lock:release:response', {
                released: true,
                reason:   'Lock released'
            });
        });

        // ============================================================
        // LOCK HEARTBEAT / LEASE RENEWAL
        // ============================================================
        socket.on('lock:heartbeat', function (data) {
            const room = documentRooms.get(data.documentId);
            if (!room || !room.lock) return;

            if (room.lock.holder.socketId === socket.id || room.lock.holder.userId === data.userId) {
                clearTimeout(room.lock.timer);
                room.lock.expiresAt = new Date(Date.now() + LOCK_TTL_MS);
                room.lock.timer = setTimeout(function () {
                    const r = documentRooms.get(data.documentId);
                    if (r && r.lock && r.lock.holder.socketId === socket.id) {
                        releaseLock(r, data.documentId, io, 'TTL expiry');
                    }
                }, LOCK_TTL_MS);
                socket.emit('lock:heartbeat:ack', {
                    expiresAt: room.lock.expiresAt
                });
            }
        });

        // ============================================================
        // GLOBAL STATE SNAPSHOT (Unit III — Consistent Global State)
        //
        // Returns a coherent snapshot of the distributed state for this
        // document room: users, lock, logical clocks, recent events.
        // All values come from the live server state — no fake data.
        // ============================================================
        socket.on('snapshot:request', function (data) {
            const { documentId } = data;
            if (!documentId) return;

            const room = documentRooms.get(documentId);
            if (!room) {
                socket.emit('snapshot:response', {
                    success:     false,
                    documentId,
                    reason:      'No active room for this document'
                });
                return;
            }

            const lt = lamportIncrement(room);
            const vc = vectorSnapshot(room);

            const snapshot = {
                success:       true,
                documentId,
                capturedAt:    new Date().toISOString(),
                connectedUsers: Array.from(room.users.values()),
                lock:          room.lock ? {
                    holder:       room.lock.holder,
                    acquiredAt:   room.lock.acquiredAt,
                    expiresAt:    room.lock.expiresAt,
                    waitingUsers: (room.waitingQueue || []).map(u => u.userName)
                } : null,
                lamportClock:  lt,
                vectorClock:   vc,
                recentEvents:  room.events.slice(-20)
            };

            socket.emit('snapshot:response', snapshot);
            console.log(`[Snapshot] Captured for doc ${documentId} at LT=${lt}`);
        });

        // ============================================================
        // WEBRTC SIGNALING EVENTS (Unit II)
        // ============================================================

        socket.on('webrtc:join-call', function (data) {
            const docId = (data && data.documentId) || currentDocumentId;
            if (!docId) return;
            console.log(`[WebRTC Signaling] Call initiated in doc: ${docId} by ${(data && data.userName) || 'User'}`);
            socket.to(docId).emit('webrtc:user-calling', {
                callerId: socket.id,
                userName: data && data.userName
            });
        });

        socket.on('webrtc:offer', function (data) {
            const docId = (data && data.documentId) || currentDocumentId;
            if (!docId || !data || !data.offer) return;
            console.log(`[WebRTC Signaling] Relaying SDP Offer in doc: ${docId}`);
            socket.to(docId).emit('webrtc:offer', {
                offer:    data.offer,
                senderId: socket.id
            });
        });

        socket.on('webrtc:answer', function (data) {
            const docId = (data && data.documentId) || currentDocumentId;
            if (!docId || !data || !data.answer) return;
            console.log(`[WebRTC Signaling] Relaying SDP Answer in doc: ${docId}`);
            socket.to(docId).emit('webrtc:answer', {
                answer:   data.answer,
                senderId: socket.id
            });
        });

        socket.on('webrtc:ice-candidate', function (data) {
            const docId = (data && data.documentId) || currentDocumentId;
            if (!docId || !data || !data.candidate) return;
            console.log(`[WebRTC Signaling] Relaying ICE Candidate in doc: ${docId}`);
            socket.to(docId).emit('webrtc:ice-candidate', {
                candidate: data.candidate,
                senderId:  socket.id
            });
        });

        socket.on('webrtc:end-call', function (data) {
            const docId = (data && data.documentId) || currentDocumentId;
            if (!docId) return;
            console.log(`[WebRTC Signaling] Call ended in doc: ${docId}`);
            socket.to(docId).emit('webrtc:call-ended', {
                senderId: socket.id
            });
        });

        // ============================================================
        // EVENT: disconnect
        // Handles lock release for disconnected holders, removes socket
        // from waiting queue, and performs user cleanup.
        // ============================================================
        socket.on('disconnect', function () {
            console.log('[Collaboration Service] Client disconnected:', socket.id);

            if (!currentDocumentId) return;

            // Notify peer that call ended if active
            socket.to(currentDocumentId).emit('webrtc:call-ended', {
                senderId: socket.id
            });

            const room = documentRooms.get(currentDocumentId);
            if (!room) return;

            const user = room.users.get(socket.id);
            room.users.delete(socket.id);

            // Clean up waiting queue if this socket was queued
            if (room.waitingQueue && room.waitingQueue.length > 0) {
                const prevLen = room.waitingQueue.length;
                room.waitingQueue = room.waitingQueue.filter(u => u.socketId !== socket.id);
                if (room.waitingQueue.length !== prevLen) {
                    io.to(currentDocumentId).emit('lock:state', buildLockState(room, room.lamport, vectorSnapshot(room)));
                }
            }

            // If this socket held the lock, release it on disconnect (crash recovery)
            if (room.lock && room.lock.holder.socketId === socket.id) {
                releaseLock(room, currentDocumentId, io, 'holder disconnected');
            }

            if (user) {
                const lt = lamportIncrement(room);
                const vc = vectorSnapshot(room);

                recordEvent(room, {
                    type:        'User Left',
                    userId:      user.userId,
                    userName:    user.userName,
                    lamportTime: lt,
                    vector:      vc
                });

                console.log(`[Collaboration Service] ${user.userName} left room ${currentDocumentId}`);

                socket.to(currentDocumentId).emit('user:left', {
                    userId:      user.userId,
                    userName:    user.userName,
                    timestamp:   new Date().toISOString(),
                    lamportTime: lt,
                    vector:      vc
                });

                const updatedList = Array.from(room.users.values());
                io.to(currentDocumentId).emit('room:users', updatedList);
                io.to(currentDocumentId).emit('sync:events', room.events.slice(-20));
            }

            if (room.users.size === 0) {
                // Keep room state briefly in case all users refresh simultaneously;
                // but clean up if truly empty after a grace period.
                setTimeout(function () {
                    const r = documentRooms.get(currentDocumentId);
                    if (r && r.users.size === 0) {
                        if (r.lock) clearTimeout(r.lock.timer);
                        documentRooms.delete(currentDocumentId);
                        console.log(`[Collaboration Service] Room ${currentDocumentId} cleaned up`);
                    }
                }, 60000); // 60 s grace period
            }
        });
    });
}

module.exports = { setupSocketHandlers };
