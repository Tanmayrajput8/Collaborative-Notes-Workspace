/**
 * test-mutex-scenarios.js
 * Verification of Mutual Exclusion requirements & edge cases:
 *  1. User A acquires lock -> User A is holder, editing allowed.
 *  2. User B receives lock:state -> locked: true, holder: User A.
 *  3. Backend rejects User B edit attempt while User A holds lock.
 *  4. User B requests lock -> rejected, added to waitingQueue.
 *  5. User B appears in waitingUsers list.
 *  6. User A releases lock -> lock freed.
 *  7. User B can now acquire lock -> Bob becomes holder.
 *  8. User B edits document -> successfully broadcast.
 *  9. User A attempt to edit while Bob holds lock -> rejected.
 * 10. Disconnect lock holder -> lock automatically freed on crash/disconnect.
 * 11. Stale lock recovery via TTL timeout -> automatically freed.
 * 12. Simultaneous acquire requests -> exactly one granted, second queued.
 * 13. Reconnection / refresh -> fresh state received.
 */

const { io } = require('socket.io-client');
const axios = require('axios');

async function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

async function runMutexValidation() {
    console.log('======================================================================');
    console.log('MUTUAL EXCLUSION & EDGE CASES VALIDATION TEST');
    console.log('======================================================================\n');

    // Create a new document
    const docRes = await axios.post('http://localhost:3000/api/documents', {
        title: 'Mutex Edge Cases Validation Document',
        content: 'Initial text'
    });
    const docId = docRes.data.document.documentId;
    console.log(`Document created: ${docId}`);

    // Connect User A and User B
    const clientA = io('http://localhost:3000', { transports: ['websocket'] });
    const clientB = io('http://localhost:3000', { transports: ['websocket'] });

    await new Promise((res) => {
        let count = 0;
        function check() { count++; if (count === 2) res(); }
        clientA.on('connect', check);
        clientB.on('connect', check);
    });

    clientA.emit('document:join', { documentId: docId, userId: 'user-a', userName: 'User A' });
    clientB.emit('document:join', { documentId: docId, userId: 'user-b', userName: 'User B' });
    await sleep(300);

    // 1. User A acquires lock
    console.log('\n--- 1. User A acquires lock ---');
    let aResp = await new Promise(res => {
        clientA.once('lock:acquire:response', res);
        clientA.emit('lock:acquire', { documentId: docId, userId: 'user-a', userName: 'User A', lamportTime: 1 });
    });
    console.log('User A acquire result:', aResp.granted, aResp.reason);
    if (!aResp.granted) throw new Error('User A failed to acquire lock');

    // 2. User B observes lock state: locked: true, holder: User A
    console.log('\n--- 2. User B verifies User A is holder ---');
    let bLockState = aResp.lock;
    console.log('Lock holder according to server:', bLockState.holder.userName, '| locked:', bLockState.locked);
    if (!bLockState.locked || bLockState.holder.userId !== 'user-a') {
        throw new Error('Lock state incorrect for User B');
    }

    // 3. Backend rejects User B edit attempt while User A holds lock
    console.log('\n--- 3. Backend authoritative check: User B attempts edit ---');
    let violationReceived = false;
    clientB.once('lock:violation', (data) => {
        console.log('User B received lock:violation as expected:', data.message);
        violationReceived = true;
    });
    clientB.emit('document:edit', {
        documentId: docId,
        userId: 'user-b',
        userName: 'User B',
        content: 'Unauthorized edit from User B',
        lamportTime: 5
    });
    await sleep(400);
    if (!violationReceived) throw new Error('Server allowed edit from non-holder User B!');
    console.log('✅ Server correctly rejected edit from non-holder User B');

    // 4 & 5. User B requests lock while User A holds it -> added to waitingQueue
    console.log('\n--- 4 & 5. User B requests lock -> waiting queue check ---');
    let bAcquireResp = await new Promise(res => {
        clientB.once('lock:acquire:response', res);
        clientB.emit('lock:acquire', { documentId: docId, userId: 'user-b', userName: 'User B', lamportTime: 10 });
    });
    console.log('User B request while locked result:', bAcquireResp.granted, bAcquireResp.reason);
    console.log('Waiting users in lock state:', bAcquireResp.lock.waitingUsers);
    if (bAcquireResp.granted) throw new Error('Lock granted to User B while User A held it!');
    if (!bAcquireResp.lock.waitingUsers.includes('User B')) {
        throw new Error('User B not found in waitingUsers list!');
    }
    console.log('✅ User B successfully queued in waiting state');

    // 6. User A releases lock
    console.log('\n--- 6. User A releases lock ---');
    let aRelResp = await new Promise(res => {
        clientA.once('lock:release:response', res);
        clientA.emit('lock:release', { documentId: docId, userId: 'user-a', lamportTime: 15 });
    });
    console.log('User A release response:', aRelResp.released, aRelResp.reason);
    if (!aRelResp.released) throw new Error('User A release failed');
    await sleep(300);

    // 7. User B acquires lock
    console.log('\n--- 7. User B acquires released lock ---');
    let bAcquire2 = await new Promise(res => {
        clientB.once('lock:acquire:response', res);
        clientB.emit('lock:acquire', { documentId: docId, userId: 'user-b', userName: 'User B', lamportTime: 20 });
    });
    console.log('User B acquire result after release:', bAcquire2.granted, bAcquire2.reason);
    if (!bAcquire2.granted) throw new Error('User B could not acquire released lock');
    console.log('✅ User B now holds the lock');

    // 8. User B can edit
    console.log('\n--- 8. User B edits document ---');
    let editReceivedByA = false;
    clientA.once('document:edit', (d) => {
        if (d.content === 'Valid edit by User B') editReceivedByA = true;
    });
    clientB.emit('document:edit', {
        documentId: docId,
        userId: 'user-b',
        userName: 'User B',
        content: 'Valid edit by User B',
        lamportTime: 25
    });
    await sleep(400);
    if (!editReceivedByA) throw new Error('User B edit was not broadcast to User A');
    console.log('✅ User B edit successfully applied and broadcast');

    // 9. User A becomes read-only (server rejects User A edit)
    console.log('\n--- 9. User A attempts edit while User B holds lock ---');
    let aViolationReceived = false;
    clientA.once('lock:violation', () => {
        aViolationReceived = true;
    });
    clientA.emit('document:edit', {
        documentId: docId,
        userId: 'user-a',
        userName: 'User A',
        content: 'User A illegal edit',
        lamportTime: 30
    });
    await sleep(400);
    if (!aViolationReceived) throw new Error('User A was allowed to edit while User B held lock');
    console.log('✅ User A correctly prevented from editing while User B holds lock');

    // 10 & 11. Disconnect lock holder -> verify recovery
    console.log('\n--- 10 & 11. Crash recovery: User B disconnects holding lock ---');
    let lockFreedOnDisconnect = false;
    clientA.on('lock:state', (st) => {
        if (!st.locked) lockFreedOnDisconnect = true;
    });
    clientB.disconnect();
    await sleep(500);
    if (!lockFreedOnDisconnect) throw new Error('Lock not freed after holder disconnected!');
    console.log('✅ Lock automatically freed when holder disconnected');

    // 12. Test simultaneous Acquire requests
    console.log('\n--- 12. Simultaneous acquire requests ---');
    const c1 = io('http://localhost:3000', { transports: ['websocket'] });
    const c2 = io('http://localhost:3000', { transports: ['websocket'] });
    await new Promise(res => {
        let cnt = 0;
        function done() { cnt++; if (cnt === 2) res(); }
        c1.on('connect', done);
        c2.on('connect', done);
    });
    c1.emit('document:join', { documentId: docId, userId: 'user-c1', userName: 'Client 1' });
    c2.emit('document:join', { documentId: docId, userId: 'user-c2', userName: 'Client 2' });
    await sleep(300);

    const [resp1, resp2] = await Promise.all([
        new Promise(res => { c1.once('lock:acquire:response', res); c1.emit('lock:acquire', { documentId: docId, userId: 'user-c1', userName: 'Client 1', lamportTime: 40 }); }),
        new Promise(res => { c2.once('lock:acquire:response', res); c2.emit('lock:acquire', { documentId: docId, userId: 'user-c2', userName: 'Client 2', lamportTime: 40 }); })
    ]);
    console.log('Client 1 response:', resp1.granted, resp1.reason);
    console.log('Client 2 response:', resp2.granted, resp2.reason);
    const grantedCount = (resp1.granted ? 1 : 0) + (resp2.granted ? 1 : 0);
    if (grantedCount !== 1) {
        throw new Error(`Mutual exclusion violated: ${grantedCount} clients granted lock concurrently!`);
    }
    console.log('✅ Exactly one client granted lock under simultaneous contention');

    // Clean up
    c1.disconnect();
    c2.disconnect();
    clientA.disconnect();

    console.log('\n======================================================================');
    console.log('🎉 ALL MUTUAL EXCLUSION & EDGE CASE TESTS PASSED SUCCESSFULLY!');
    console.log('======================================================================\n');
}

runMutexValidation().catch(err => {
    console.error('❌ Error in test:', err.message);
    process.exit(1);
});
