/**
 * dsync.js — Distributed Synchronization Panel Controller
 * =========================================================
 * Manages the "Distributed Synchronization" sidebar panel in the
 * document editor.  All data in this panel comes from the live
 * running system — no hardcoded or fake values.
 *
 * Features (Unit III Distributed Systems):
 *   1. Mutual Exclusion — Document Lock
 *   2. Lamport Logical Clock display
 *   3. Recent Distributed Events log
 *   4. Vector Clock / Causality display
 *   5. Global State Snapshot
 *   6. Service Health monitoring
 *
 * This module reads window.collabSocket, window.currentDocId,
 * window.currentUserInfo, window.dsLocalClock, and window.dsLocalVector
 * set by document.js before this script loads.
 */

'use strict';

// ============================================================
// WAIT FOR DOCUMENT.JS TO INITIALISE (runs after it)
// ============================================================
(function () {
    const socket   = window.collabSocket;
    const docId    = window.currentDocId;
    const userInfo = window.currentUserInfo;

    if (!socket || !docId || !userInfo) {
        console.warn('[dsync] Required globals not available. Panel disabled.');
        return;
    }

    // ============================================================
    // DOM REFS
    // ============================================================
    const dsLockStatus   = document.getElementById('dsLockStatus');
    const dsLockHolder   = document.getElementById('dsLockHolder');
    const dsLockWaiting  = document.getElementById('dsLockWaiting');
    const dsLockExpiry   = document.getElementById('dsLockExpiry');
    const dsAcquireBtn   = document.getElementById('dsAcquireBtn');
    const dsReleaseBtn   = document.getElementById('dsReleaseBtn');
    const dsLockMsg      = document.getElementById('dsLockMsg');

    const dsLamportTime  = document.getElementById('dsLamportTime');
    const dsLocalClock   = document.getElementById('dsLocalClock');

    const dsEventsTbody  = document.getElementById('dsEventsTbody');
    const dsVectorClock  = document.getElementById('dsVectorClock');
    const dsCausality    = document.getElementById('dsCausality');

    const dsCaptureSnapshotBtn = document.getElementById('dsCaptureSnapshotBtn');
    const dsSnapshotWrap = document.getElementById('dsSnapshotWrap');
    const dsSnapshotPre  = document.getElementById('dsSnapshotPre');

    const dsRefreshHealthBtn = document.getElementById('dsRefreshHealthBtn');
    const dsHealthTbody  = document.getElementById('dsHealthTbody');

    const dsPanelToggle  = document.getElementById('dsPanelToggle');
    const dsPanelBody    = document.getElementById('dsPanelBody');
    const dsChevron      = document.getElementById('dsChevron');

    // ============================================================
    // COLLAPSIBLE PANEL TOGGLE
    // ============================================================
    if (dsPanelToggle) {
        dsPanelToggle.addEventListener('click', function () {
            const isOpen = dsPanelBody.style.display !== 'none';
            dsPanelBody.style.display = isOpen ? 'none' : '';
            dsChevron.innerHTML = isOpen ? '&#9660;' : '&#9650;';
            dsPanelToggle.setAttribute('aria-expanded', String(!isOpen));
        });

        dsPanelToggle.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                dsPanelToggle.click();
            }
        });
    }

    // ============================================================
    // CLOCK DISPLAY UPDATER
    // Refreshes the Lamport / local clock display periodically
    // from the values document.js maintains on `window`.
    // ============================================================
    function refreshClockDisplay() {
        if (dsLamportTime) dsLamportTime.textContent = typeof window.dsLocalClock === 'number'
            ? window.dsLocalClock
            : '0';
        if (dsLocalClock) dsLocalClock.textContent = typeof window.dsLocalClock === 'number'
            ? window.dsLocalClock
            : '0';
    }
    setInterval(refreshClockDisplay, 500);

    // ============================================================
    // VECTOR CLOCK DISPLAY
    // ============================================================
    let lastVectorReceived = null;
    let prevVectorReceived = null;

    function renderVectorClock(vc) {
        if (!dsVectorClock) return;
        if (!vc || Object.keys(vc).length === 0) {
            dsVectorClock.innerHTML = '<span class="ds-empty">No vector data yet</span>';
            return;
        }
        let html = '<table class="ds-vc-table"><tbody>';
        for (const [uid, val] of Object.entries(vc)) {
            const isMe = uid === userInfo.userId;
            html += `<tr>
                <td class="ds-vc-uid${isMe ? ' ds-vc-me' : ''}" title="${escapeHtml(uid)}">${escapeHtml(uid.substring(0, 8))}${isMe ? '*' : ''}</td>
                <td class="ds-vc-val">${val}</td>
            </tr>`;
        }
        html += '</tbody></table>';
        dsVectorClock.innerHTML = html;
    }

    function computeCausality(va, vb) {
        if (!va || !vb) return '—';
        const keys = new Set([...Object.keys(va), ...Object.keys(vb)]);
        let aLe = true, bLe = true;
        for (const k of keys) {
            const a = va[k] || 0, b = vb[k] || 0;
            if (a > b) bLe = false;
            if (b > a) aLe = false;
        }
        if (aLe && bLe) return 'same';
        if (aLe) return 'before';
        if (bLe) return 'after';
        return 'concurrent';
    }

    // ============================================================
    // EVENTS TABLE
    // ============================================================
    function renderEvents(events) {
        if (!dsEventsTbody) return;
        if (!events || events.length === 0) {
            dsEventsTbody.innerHTML = '<tr><td colspan="3" class="ds-empty">No events yet</td></tr>';
            return;
        }
        // Show newest first, limit to 15 rows
        const rows = [...events].reverse().slice(0, 15);
        dsEventsTbody.innerHTML = rows.map(ev => `
            <tr>
                <td class="ds-mono">${ev.lamportTime}</td>
                <td>${escapeHtml((ev.userName || ev.userId || '?').substring(0, 12))}</td>
                <td>${escapeHtml(ev.type)}</td>
            </tr>
        `).join('');
    }

    // ============================================================
    // LOCK STATE DISPLAY
    // ============================================================
    let lockExpiryInterval = null;
    let currentLockState   = null;

    function renderLockState(state) {
        currentLockState = state;

        if (!state) return;

        const isLocked = !!state.locked;
        const socketId = socket && socket.id;
        const iAmHolder = isLocked && state.holder && (
            state.holder.socketId ? state.holder.socketId === socketId : state.holder.userId === userInfo.userId
        );
        const waitingList = Array.isArray(state.waitingUsers) ? state.waitingUsers : [];
        const amInWaitingQueue = waitingList.includes(userInfo.name);

        if (dsLockStatus) {
            dsLockStatus.textContent = isLocked ? 'Locked' : 'Available';
            dsLockStatus.className   = 'ds-val ' + (isLocked ? 'ds-status-locked' : 'ds-status-available');
        }
        if (dsLockHolder) {
            dsLockHolder.textContent = isLocked && state.holder
                ? state.holder.userName + (iAmHolder ? ' (You)' : '')
                : '—';
        }
        if (dsLockWaiting) {
            dsLockWaiting.textContent = waitingList.length > 0 ? waitingList.join(', ') : '—';
        }

        // Live countdown for expiry
        if (lockExpiryInterval) clearInterval(lockExpiryInterval);
        if (isLocked && state.expiresAt) {
            function updateExpiry() {
                const remaining = Math.max(0, new Date(state.expiresAt) - Date.now());
                if (dsLockExpiry) {
                    dsLockExpiry.textContent = remaining > 0
                        ? Math.ceil(remaining / 1000) + 's'
                        : 'Expired';
                }
                if (remaining <= 0) clearInterval(lockExpiryInterval);
            }
            updateExpiry();
            lockExpiryInterval = setInterval(updateExpiry, 500);
        } else {
            if (dsLockExpiry) dsLockExpiry.textContent = '—';
        }

        // Button states:
        // If lock is available:
        //   Acquire Lock -> enabled
        //   Release Lock -> disabled
        // If current user owns lock:
        //   Acquire Lock -> disabled
        //   Release Lock -> enabled
        // If another user owns lock:
        //   Acquire Lock -> enabled for waiting (or disabled if already in waiting queue)
        //   Release Lock -> disabled
        if (dsAcquireBtn) {
            if (!isLocked) {
                dsAcquireBtn.disabled = false;
                dsAcquireBtn.textContent = 'Acquire Lock';
                dsAcquireBtn.title = 'Acquire exclusive editing lock';
            } else if (iAmHolder) {
                dsAcquireBtn.disabled = true;
                dsAcquireBtn.textContent = 'Acquire Lock';
                dsAcquireBtn.title = 'You already hold the lock';
            } else {
                if (amInWaitingQueue) {
                    dsAcquireBtn.disabled = true;
                    dsAcquireBtn.textContent = 'Waiting in Queue';
                    dsAcquireBtn.title = 'You are in the waiting queue for this lock';
                } else {
                    dsAcquireBtn.disabled = false;
                    dsAcquireBtn.textContent = 'Acquire Lock';
                    dsAcquireBtn.title = 'Request lock and join waiting queue';
                }
            }
        }

        if (dsReleaseBtn) {
            dsReleaseBtn.disabled = !iAmHolder;
            dsReleaseBtn.title = iAmHolder ? 'Release the editing lock' : 'Only the current lock holder can release';
        }

        // Synchronize with middle editor canvas if available
        if (typeof window.applyEditorLockState === 'function') {
            window.applyEditorLockState(state);
        }

        // Update clock display
        if (state.lamportTime) {
            window.dsLocalClock = Math.max(window.dsLocalClock || 0, state.lamportTime);
        }
        if (state.vector) {
            prevVectorReceived = lastVectorReceived;
            lastVectorReceived = state.vector;
            renderVectorClock(state.vector);
            if (prevVectorReceived && lastVectorReceived) {
                const rel = computeCausality(prevVectorReceived, lastVectorReceived);
                if (dsCausality) dsCausality.textContent = rel;
            }
        }
    }

    function setLockMessage(msg, isError) {
        if (!dsLockMsg) return;
        dsLockMsg.textContent = msg;
        dsLockMsg.className   = 'ds-lock-msg ' + (isError ? 'ds-lock-msg-error' : 'ds-lock-msg-ok');
        setTimeout(() => { dsLockMsg.textContent = ''; dsLockMsg.className = 'ds-lock-msg'; }, 5000);
    }

    // ============================================================
    // LOCK — ACQUIRE
    // ============================================================
    if (dsAcquireBtn) {
        dsAcquireBtn.addEventListener('click', function () {
            dsAcquireBtn.disabled = true;

            // Tick clock before requesting
            if (typeof window.dsLocalClock === 'number') window.dsLocalClock += 1;
            const lt = window.dsLocalClock;
            const vc = Object.assign({}, window.dsLocalVector || {});

            socket.emit('lock:acquire', {
                documentId:  docId,
                userId:      userInfo.userId,
                userName:    userInfo.name,
                lamportTime: lt,
                vector:      vc
            });
        });
    }

    socket.on('lock:acquire:response', function (data) {
        if (data.granted) {
            setLockMessage('Lock acquired. You have exclusive editing access.', false);
        } else {
            setLockMessage(data.reason || 'Lock not granted.', true);
        }
        if (data.lock) renderLockState(data.lock);
    });

    socket.on('lock:eligible', function (data) {
        setLockMessage(data.message || 'You can now acquire the lock!', false);
        if (dsAcquireBtn && (!currentLockState || !currentLockState.locked)) {
            dsAcquireBtn.disabled = false;
            dsAcquireBtn.textContent = 'Acquire Lock';
        }
    });

    // ============================================================
    // LOCK — RELEASE
    // ============================================================
    if (dsReleaseBtn) {
        dsReleaseBtn.addEventListener('click', function () {
            dsReleaseBtn.disabled = true;

            if (typeof window.dsLocalClock === 'number') window.dsLocalClock += 1;
            const lt = window.dsLocalClock;
            const vc = Object.assign({}, window.dsLocalVector || {});

            socket.emit('lock:release', {
                documentId:  docId,
                userId:      userInfo.userId,
                lamportTime: lt,
                vector:      vc
            });
        });
    }

    socket.on('lock:release:response', function (data) {
        if (data.released) {
            setLockMessage('Lock released.', false);
        } else {
            setLockMessage(data.reason || 'Release failed.', true);
        }
    });

    // ============================================================
    // LOCK STATE BROADCAST (from server to all room members)
    // ============================================================
    socket.on('lock:state', function (state) {
        renderLockState(state);
    });

    // ============================================================
    // SYNC EVENTS (server broadcasts after every distributed event)
    // ============================================================
    socket.on('sync:events', function (events) {
        renderEvents(events);

        // Update vector clock from latest event
        if (events && events.length > 0) {
            const latest = events[events.length - 1];
            if (latest.vector) {
                prevVectorReceived = lastVectorReceived;
                lastVectorReceived = latest.vector;
                renderVectorClock(latest.vector);
                if (prevVectorReceived && lastVectorReceived) {
                    const rel = computeCausality(prevVectorReceived, lastVectorReceived);
                    if (dsCausality) dsCausality.textContent = rel;
                }
            }
        }
    });

    // ============================================================
    // GLOBAL STATE SNAPSHOT
    // ============================================================
    if (dsCaptureSnapshotBtn) {
        dsCaptureSnapshotBtn.addEventListener('click', function () {
            dsCaptureSnapshotBtn.disabled = true;
            dsCaptureSnapshotBtn.textContent = 'Capturing...';

            socket.emit('snapshot:request', { documentId: docId });
        });
    }

    socket.on('snapshot:response', function (snapshot) {
        if (dsCaptureSnapshotBtn) {
            dsCaptureSnapshotBtn.disabled = false;
            dsCaptureSnapshotBtn.textContent = 'Capture Global State';
        }

        if (!snapshot.success) {
            if (dsSnapshotWrap) {
                dsSnapshotWrap.style.display = '';
                dsSnapshotPre.textContent = 'Error: ' + (snapshot.reason || 'Unknown error');
            }
            return;
        }

        // Build a readable display object
        const display = {
            documentId:     snapshot.documentId,
            capturedAt:     snapshot.capturedAt,
            connectedUsers: (snapshot.connectedUsers || []).map(u => u.userName),
            lock:           snapshot.lock ? {
                holder:     snapshot.lock.holder ? snapshot.lock.holder.userName : null,
                acquiredAt: snapshot.lock.acquiredAt,
                expiresAt:  snapshot.lock.expiresAt
            } : 'Available',
            lamportClock:   snapshot.lamportClock,
            vectorClock:    snapshot.vectorClock,
            recentEventCount: (snapshot.recentEvents || []).length
        };

        if (dsSnapshotWrap) {
            dsSnapshotWrap.style.display = '';
            dsSnapshotPre.textContent = JSON.stringify(display, null, 2);
        }
    });

    // ============================================================
    // SERVICE HEALTH
    // ============================================================
    async function refreshHealth() {
        if (!dsHealthTbody) return;
        dsHealthTbody.innerHTML = '<tr><td colspan="3" class="ds-empty">Checking...</td></tr>';

        try {
            const res  = await fetch(window.location.origin + '/api/sync/health', { signal: AbortSignal.timeout(8000) });
            const data = await res.json();

            if (!data.services || data.services.length === 0) {
                dsHealthTbody.innerHTML = '<tr><td colspan="3" class="ds-empty">No data</td></tr>';
                return;
            }

            dsHealthTbody.innerHTML = data.services.map(svc => {
                const statusCls = svc.status === 'ok' ? 'ds-health-ok'
                    : svc.status === 'unreachable'    ? 'ds-health-err'
                    : 'ds-health-warn';
                const time = new Date(svc.lastCheck).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                return `<tr>
                    <td>${escapeHtml(svc.name)}</td>
                    <td><span class="ds-health-badge ${statusCls}">${escapeHtml(svc.status)}</span></td>
                    <td class="ds-muted">${time}</td>
                </tr>`;
            }).join('');
        } catch (err) {
            dsHealthTbody.innerHTML = `<tr><td colspan="3" class="ds-empty ds-health-err">${escapeHtml(err.message)}</td></tr>`;
        }
    }

    if (dsRefreshHealthBtn) {
        dsRefreshHealthBtn.addEventListener('click', refreshHealth);
    }

    // Initial health load after short delay (let services settle)
    setTimeout(refreshHealth, 1500);

    // Auto-refresh health every 30 s
    setInterval(refreshHealth, 30000);

    // ============================================================
    // HELPER
    // ============================================================
    function escapeHtml(text) {
        if (!text) return '';
        const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
        return String(text).replace(/[&<>"']/g, m => map[m]);
    }

})();
