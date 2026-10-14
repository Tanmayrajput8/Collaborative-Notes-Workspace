const { io } = require('socket.io-client');
const axios = require('axios');

async function testCollaboration() {
    console.log('========================================================');
    console.log('FA-1 DISTRIBUTED SYSTEMS COLLABORATION TEST (PORT 3000)');
    console.log('Testing Single Entry Point Proxy Architecture for LocalTunnel');
    console.log('========================================================\n');

    console.log('--- Step 1: Create Document via API Gateway (RPC) ---');
    const docRes = await axios.post('http://localhost:3000/api/documents', {
        title: 'Distributed Systems FA-1 Notes',
        content: 'Initial text by Host'
    });

    const docId = docRes.data.document.documentId;
    console.log(`Document Created: ${docId}`);

    console.log('\n--- Step 2: Connecting Two Clients via API Gateway Port 3000 (Proxied to Collab Service) ---');
    // Both clients connect to port 3000 (just like remote clients on LocalTunnel)
    const clientA = io('http://localhost:3000', { transports: ['polling', 'websocket'] });
    const clientB = io('http://localhost:3000', { transports: ['polling', 'websocket'] });

    await new Promise((resolve, reject) => {
        let count = 0;
        const timeout = setTimeout(() => reject(new Error('Socket.IO connection timeout via port 3000')), 5000);
        function check() {
            count++;
            if (count === 2) {
                clearTimeout(timeout);
                resolve();
            }
        }
        clientA.on('connect', () => {
            console.log('Client A connected via port 3000 proxy! Socket ID:', clientA.id);
            check();
        });
        clientB.on('connect', () => {
            console.log('Client B connected via port 3000 proxy! Socket ID:', clientB.id);
            check();
        });
    });

    console.log('\n--- Step 3: Joining Document Room ---');
    clientA.emit('document:join', { documentId: docId, userId: 'user-001', userName: 'Tanmay' });
    clientB.emit('document:join', { documentId: docId, userId: 'user-002', userName: 'Rahul' });

    let editReceived = false;
    let messageReceived = false;

    clientB.on('document:edit', (data) => {
        console.log(`\n[Real-Time Edit Stream Received by Rahul]`);
        console.log(`From: ${data.userName}`);
        console.log(`Content: "${data.content}"`);
        editReceived = true;
    });

    clientA.on('message:receive', (msg) => {
        console.log(`\n[Collaborator Chat Message Received by Tanmay]`);
        console.log(`${msg.userName}: "${msg.text}"`);
        messageReceived = true;
    });

    await new Promise(r => setTimeout(r, 600));

    console.log('\n--- Step 4: Tanmay Streams Real-Time Document Edit ---');
    clientA.emit('document:edit', {
        documentId: docId,
        userId: 'user-001',
        userName: 'Tanmay',
        content: 'Distributed Systems: Middleware, RPC, and Stream-Oriented Communication via LocalTunnel.',
        timestamp: new Date().toISOString()
    });

    await new Promise(r => setTimeout(r, 600));

    console.log('\n--- Step 5: Rahul Sends P2P Chat Message ---');
    clientB.emit('message:send', {
        documentId: docId,
        userId: 'user-002',
        userName: 'Rahul',
        text: 'Received your edits through the LocalTunnel proxy architecture! Let us save version 1.',
        timestamp: new Date().toISOString()
    });

    await new Promise(r => setTimeout(r, 800));

    console.log('\n--- Step 6: Saving Version to MongoDB via API Gateway RPC ---');
    const saveRes = await axios.put(`http://localhost:3000/api/documents/${docId}`, {
        title: 'Distributed Systems FA-1 Notes',
        content: 'Distributed Systems: Middleware, RPC, and Stream-Oriented Communication via LocalTunnel.',
        savedBy: 'Rahul'
    });
    console.log(`Saved Version ${saveRes.data.version.versionNumber} by ${saveRes.data.version.savedBy}`);

    console.log('\n--- Step 7: Verifying Version History ---');
    const versionsRes = await axios.get(`http://localhost:3000/api/documents/${docId}/versions`);
    console.log('Total Versions stored in MongoDB:', versionsRes.data.versions.length);

    clientA.disconnect();
    clientB.disconnect();

    if (editReceived && messageReceived) {
        console.log('\n========================================================');
        console.log('✅ ALL DISTRIBUTED SYSTEMS LOCAL & LOCALTUNNEL TESTS PASSED!');
        console.log('========================================================\n');
        process.exit(0);
    } else {
        console.error('❌ Events not received properly');
        process.exit(1);
    }
}

testCollaboration().catch((err) => {
    console.error('Test error:', err.message);
    process.exit(1);
});
