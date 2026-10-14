/**
 * test-two-browsers-flow.js
 * Exactly replicates the two-browser flow described in Section 6:
 * Browser 1: User A
 * Browser 2: User B
 * Step 1: Both open same doc.
 * Step 2: User A clicks Acquire Lock -> User A enabled, User B read-only.
 * Step 3: User B tries to type -> typing rejected / cannot modify.
 * Step 4: User B requests lock -> User B appears as waiting.
 * Step 5: User A releases lock -> User B acquires lock and can edit.
 */

const { io } = require('socket.io-client');
const axios = require('axios');

async function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

async function runTwoBrowsersSimulation() {
    console.log('--- Step 1: Both users open document ---');
    const docRes = await axios.post('http://localhost:3000/api/documents', {
        title: 'Two Browser Simulation Document',
        content: 'Original document content.'
    });
    const docId = docRes.data.document.documentId;
    console.log(`Document ID: ${docId}`);

    const browser1 = io('http://localhost:3000', { transports: ['websocket'] });
    const browser2 = io('http://localhost:3000', { transports: ['websocket'] });

    await new Promise(r => {
        let c = 0;
        function check() { c++; if (c === 2) r(); }
        browser1.on('connect', check);
        browser2.on('connect', check);
    });

    browser1.emit('document:join', { documentId: docId, userId: 'user-a', userName: 'User A' });
    browser2.emit('document:join', { documentId: docId, userId: 'user-b', userName: 'User B' });
    await sleep(300);

    // Step 2: User A clicks Acquire Lock
    console.log('--- Step 2: User A clicks Acquire Lock ---');
    let b2LockState = null;
    browser2.on('lock:state', (st) => { b2LockState = st; });

    let aAcquire = await new Promise(res => {
        browser1.once('lock:acquire:response', res);
        browser1.emit('lock:acquire', { documentId: docId, userId: 'user-a', userName: 'User A', lamportTime: 1 });
    });
    console.log('User A Acquire Result:', aAcquire.granted, '| Reason:', aAcquire.reason);
    await sleep(300);
    console.log('User B sees locked:', b2LockState.locked, '| Holder:', b2LockState.holder.userName);
    if (!b2LockState.locked || b2LockState.holder.userId !== 'user-a') {
        throw new Error('User B did not receive locked state!');
    }

    // Step 3: User B tries to type
    console.log('--- Step 3: User B tries to type ---');
    let bViolation = false;
    browser2.once('lock:violation', (data) => {
        console.log('User B edit rejected by backend:', data.message);
        bViolation = true;
    });
    browser2.emit('document:edit', {
        documentId: docId,
        userId: 'user-b',
        userName: 'User B',
        content: 'Attempted edit from User B while User A holds lock',
        lamportTime: 5
    });
    await sleep(300);
    if (!bViolation) throw new Error('User B edit was not rejected!');

    // Step 4: User B requests lock
    console.log('--- Step 4: User B requests lock ---');
    let bAcquireReq = await new Promise(res => {
        browser2.once('lock:acquire:response', res);
        browser2.emit('lock:acquire', { documentId: docId, userId: 'user-b', userName: 'User B', lamportTime: 10 });
    });
    console.log('User B acquire granted:', bAcquireReq.granted, '| Waiting users:', bAcquireReq.lock.waitingUsers);
    if (bAcquireReq.granted) throw new Error('User B was mistakenly granted lock!');
    if (!bAcquireReq.lock.waitingUsers.includes('User B')) throw new Error('User B is not in waiting queue!');

    // Step 5: User A releases lock
    console.log('--- Step 5: User A releases lock ---');
    let aRelease = await new Promise(res => {
        browser1.once('lock:release:response', res);
        browser1.emit('lock:release', { documentId: docId, userId: 'user-a', lamportTime: 15 });
    });
    console.log('User A Release Result:', aRelease.released);
    await sleep(300);
    console.log('User B observes lock state after release: locked =', b2LockState.locked);
    if (b2LockState.locked) throw new Error('Lock should be free after User A released!');

    // Result: User B can acquire lock and edit
    console.log('--- Result: User B acquires lock and edits ---');
    let bAcquireFinal = await new Promise(res => {
        browser2.once('lock:acquire:response', res);
        browser2.emit('lock:acquire', { documentId: docId, userId: 'user-b', userName: 'User B', lamportTime: 20 });
    });
    console.log('User B Acquire Granted:', bAcquireFinal.granted, '| Holder:', bAcquireFinal.lock.holder.userName);
    if (!bAcquireFinal.granted || bAcquireFinal.lock.holder.userId !== 'user-b') {
        throw new Error('User B could not acquire lock!');
    }

    let bEditReceived = false;
    browser1.once('document:edit', (d) => {
        if (d.content === 'Valid edit by User B after acquiring lock.') bEditReceived = true;
    });
    browser2.emit('document:edit', {
        documentId: docId,
        userId: 'user-b',
        userName: 'User B',
        content: 'Valid edit by User B after acquiring lock.',
        lamportTime: 25
    });
    await sleep(300);
    if (!bEditReceived) throw new Error('User B edit after lock was not received by User A!');
    console.log('✅ User B edit successfully delivered to User A!');

    browser1.disconnect();
    browser2.disconnect();
    console.log('🎉 Two-browser simulation completed with 100% success!');
}

runTwoBrowsersSimulation().catch(e => {
    console.error('Simulation error:', e);
    process.exit(1);
});
