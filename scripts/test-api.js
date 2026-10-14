const axios = require('axios');

async function test() {
    try {
        console.log('--- Testing API Gateway Health ---');
        const health = await axios.get('http://localhost:3000/health');
        console.log('Health:', health.data);

        console.log('\n--- Testing Document Creation via RPC ---');
        const createRes = await axios.post('http://localhost:3000/api/documents', {
            title: 'FA-1 Distributed Systems Notes',
            content: 'Hello Distributed World!'
        });
        console.log('Created Document:', createRes.data);

        const docId = createRes.data.document.documentId;

        console.log('\n--- Testing Document Fetch via RPC ---');
        const getRes = await axios.get(`http://localhost:3000/api/documents/${docId}`);
        console.log('Fetched Document:', getRes.data);

        console.log('\n--- Testing Document Save / Update (Version 1) ---');
        const updateRes = await axios.put(`http://localhost:3000/api/documents/${docId}`, {
            title: 'FA-1 Distributed Systems Notes - Updated',
            content: 'Distributed Systems Unit I and Unit II content added.',
            savedBy: 'Tanmay'
        });
        console.log('Update Result:', updateRes.data);

        console.log('\n--- Testing Version History Fetch ---');
        const versionsRes = await axios.get(`http://localhost:3000/api/documents/${docId}/versions`);
        console.log('Versions Result:', versionsRes.data);

        console.log('\n✅ ALL REST & RPC TESTS PASSED SUCCESSFULLY!');
    } catch (err) {
        console.error('Test Failed:', err.response ? err.response.data : err.message);
    }
}

test();
