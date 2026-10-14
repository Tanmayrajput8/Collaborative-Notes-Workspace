/**
 * home.js — Home Page & Shared Link Routing Controller
 * ======================================================
 * Handles user identity generation, document creation (via REST/gRPC),
 * direct document joining by ID, and shared-link name verification flow.
 * 
 * DISTRIBUTED SYSTEMS CONCEPTS:
 * - Client-Server Architecture: Browser connects to API Gateway via HTTP REST.
 * - Dynamic URL resolution: Uses window.location.origin for both local and LocalTunnel.
 */

const API_GATEWAY_URL = window.location.origin;

// DOM Elements: Normal Home View (Case 1)
const normalHomeView = document.getElementById('normalHomeView');
const userNameInput = document.getElementById('userName');
const nameError = document.getElementById('nameError');
const createDocBtn = document.getElementById('createDocBtn');
const joinDocBtn = document.getElementById('joinDocBtn');
const docIdInput = document.getElementById('docIdInput');
const docIdError = document.getElementById('docIdError');
const successMessage = document.getElementById('successMessage');
const generatedDocId = document.getElementById('generatedDocId');
const docLink = document.getElementById('docLink');
const copyLinkBtn = document.getElementById('copyLinkBtn');
const openDocBtn = document.getElementById('openDocBtn');

// DOM Elements: Shared Link View (Case 2)
const sharedLinkView = document.getElementById('sharedLinkView');
const sharedDocIdDisplay = document.getElementById('sharedDocIdDisplay');
const sharedUserName = document.getElementById('sharedUserName');
const sharedNameError = document.getElementById('sharedNameError');
const sharedDocError = document.getElementById('sharedDocError');
const continueBtn = document.getElementById('continueBtn');

// Common Elements
const toast = document.getElementById('toast');

// Helper: Show toast message
function showToast(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
}

// Helper: Generate unique user session ID
function generateUserId() {
    return 'user-' + Math.random().toString(16).substring(2, 7);
}

// Helper: Validate user name
function validateName(inputElement, errorElement) {
    const name = inputElement.value.trim();
    if (!name) {
        errorElement.style.display = 'block';
        return false;
    }
    errorElement.style.display = 'none';
    return true;
}

// Store user credentials in sessionStorage
function storeUserInfo(name, isCreator) {
    let existing = JSON.parse(sessionStorage.getItem('userInfo') || '{}');
    const userId = existing.userId || generateUserId();
    const userInfo = {
        userId: userId,
        name: name,
        isCreator: !!isCreator
    };
    sessionStorage.setItem('userInfo', JSON.stringify(userInfo));
    return userInfo;
}

// ============================================================
// ROUTING CHECK: SHARED LINK vs NORMAL HOME PAGE
// ============================================================
const urlParams = new URLSearchParams(window.location.search);
const sharedDocId = urlParams.get('docId');

if (sharedDocId && sharedDocId.trim().length >= 6) {
    // CASE 2: User opened a shared link (e.g. index.html?docId=ABC123)
    const cleanDocId = sharedDocId.trim().toUpperCase();

    if (normalHomeView) normalHomeView.style.display = 'none';
    if (sharedLinkView) sharedLinkView.style.display = 'flex';
    if (sharedDocIdDisplay) sharedDocIdDisplay.textContent = cleanDocId;

    // Check if user already has a saved name in sessionStorage
    const existingUser = JSON.parse(sessionStorage.getItem('userInfo') || '{}');
    if (existingUser.name && sharedUserName) {
        sharedUserName.value = existingUser.name;
    }

    // Continue button handler for shared document link
    if (continueBtn) {
        continueBtn.addEventListener('click', async function () {
            if (!validateName(sharedUserName, sharedNameError)) return;

            const name = sharedUserName.value.trim();
            storeUserInfo(name, false);

            try {
                continueBtn.disabled = true;
                continueBtn.textContent = 'Connecting...';
                if (sharedDocError) sharedDocError.style.display = 'none';

                // Verify document exists before redirecting
                const response = await fetch(`${API_GATEWAY_URL}/api/documents/${cleanDocId}`);
                const data = await response.json();

                if (response.ok && data.success) {
                    sessionStorage.setItem('currentDocId', cleanDocId);
                    window.location.href = `document.html?docId=${cleanDocId}`;
                } else {
                    if (sharedDocError) {
                        sharedDocError.textContent = data.message || 'Document not found. Please check the ID.';
                        sharedDocError.style.display = 'block';
                    }
                    showToast('Document not found.');
                }
            } catch (error) {
                console.error('[Home] Shared link join error:', error);
                showToast('Cannot connect to server.');
            } finally {
                continueBtn.disabled = false;
                continueBtn.textContent = 'Continue';
            }
        });
    }

    if (sharedUserName) {
        sharedUserName.addEventListener('input', () => {
            if (sharedNameError) sharedNameError.style.display = 'none';
            if (sharedDocError) sharedDocError.style.display = 'none';
        });
        sharedUserName.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && continueBtn) continueBtn.click();
        });
    }

} else {
    // CASE 1: Normal Home Page
    if (normalHomeView) normalHomeView.style.display = 'grid';
    if (sharedLinkView) sharedLinkView.style.display = 'none';

    // Populate existing name if available
    const existingUser = JSON.parse(sessionStorage.getItem('userInfo') || '{}');
    if (existingUser.name && userNameInput) {
        userNameInput.value = existingUser.name;
    }
}

// ============================================================
// CREATE NEW DOCUMENT (Case 1)
// ============================================================
if (createDocBtn) {
    createDocBtn.addEventListener('click', async function () {
        if (!validateName(userNameInput, nameError)) return;

        const name = userNameInput.value.trim();
        storeUserInfo(name, true);

        try {
            createDocBtn.disabled = true;
            createDocBtn.textContent = 'Creating document...';

            const response = await fetch(`${API_GATEWAY_URL}/api/documents`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: 'Untitled Document'
                })
            });

            const data = await response.json();

            if (response.ok && data.success) {
                const docId = data.document.documentId;
                generatedDocId.textContent = docId;

                const link = `${window.location.origin}/client/document.html?docId=${docId}`;
                docLink.value = link;
                successMessage.style.display = 'block';
                sessionStorage.setItem('currentDocId', docId);

                showToast(`Document ${docId} created successfully.`);
            } else {
                showToast(data.message || 'Failed to create document.');
            }
        } catch (error) {
            console.error('[Home] Document creation error:', error);
            showToast('Cannot connect to API Gateway.');
        } finally {
            createDocBtn.disabled = false;
            createDocBtn.textContent = 'Create Document';
        }
    });
}

// Copy link
if (copyLinkBtn) {
    copyLinkBtn.addEventListener('click', function () {
        docLink.select();
        navigator.clipboard.writeText(docLink.value).then(() => {
            showToast('Link copied to clipboard.');
        }).catch(() => {
            document.execCommand('copy');
            showToast('Link copied.');
        });
    });
}

// Open created document
if (openDocBtn) {
    openDocBtn.addEventListener('click', function () {
        const docId = sessionStorage.getItem('currentDocId');
        if (docId) {
            window.location.href = `document.html?docId=${docId}`;
        }
    });
}

// ============================================================
// JOIN EXISTING DOCUMENT (Case 1)
// ============================================================
if (joinDocBtn) {
    joinDocBtn.addEventListener('click', async function () {
        if (!validateName(userNameInput, nameError)) return;

        const docId = docIdInput.value.trim().toUpperCase();
        if (!docId || docId.length < 6) {
            docIdError.textContent = 'Please enter a valid 6-character Document ID.';
            docIdError.style.display = 'block';
            return;
        }
        docIdError.style.display = 'none';

        const name = userNameInput.value.trim();
        storeUserInfo(name, false);

        try {
            joinDocBtn.disabled = true;
            joinDocBtn.textContent = 'Joining...';

            const response = await fetch(`${API_GATEWAY_URL}/api/documents/${docId}`);
            const data = await response.json();

            if (response.ok && data.success) {
                sessionStorage.setItem('currentDocId', docId);
                window.location.href = `document.html?docId=${docId}`;
            } else {
                docIdError.textContent = data.message || 'Document not found.';
                docIdError.style.display = 'block';
                showToast('Document not found. Verify Document ID.');
            }
        } catch (error) {
            console.error('[Home] Join error:', error);
            showToast('Cannot connect to API Gateway.');
        } finally {
            joinDocBtn.disabled = false;
            joinDocBtn.textContent = 'Join Document';
        }
    });
}

// Clear input errors
if (userNameInput) userNameInput.addEventListener('input', () => { if (nameError) nameError.style.display = 'none'; });
if (docIdInput) docIdInput.addEventListener('input', () => { if (docIdError) docIdError.style.display = 'none'; });
