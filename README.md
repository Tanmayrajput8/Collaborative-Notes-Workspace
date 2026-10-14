# Real-Time Distributed Collaborative Notes and Document System

> **B.Tech Distributed Systems — FA-1 Project**  
> *A service-oriented, real-time collaborative document editor demonstrating Unit I (Distributed Systems Foundations & Architecture), Unit II (Communication, RPC, gRPC, Messaging, Streams & WebRTC), and Unit III (Synchronization: Logical Clocks, Vector Clocks, Distributed Mutual Exclusion, Global State Snapshot & Fault Tolerance), with support for both Local and Remote (LocalTunnel / WAN) multi-device collaboration.*

---

## Table of Contents

1. [Project Title & Problem Statement](#1-project-title--problem-statement)
2. [Why This Problem Is Important](#2-why-this-problem-is-important)
3. [Objectives](#3-objectives)
4. [Features](#4-features)
5. [Technology Stack](#5-technology-stack)
6. [System Architecture (Local & LocalTunnel)](#6-system-architecture-local--localtunnel)
7. [Architecture Explanation](#7-architecture-explanation)
8. [Explanation of API Gateway & Socket.IO Proxying](#8-explanation-of-api-gateway--socketio-proxying)
9. [Explanation of Document Service](#9-explanation-of-document-service)
10. [Explanation of Collaboration Service](#10-explanation-of-collaboration-service)
11. [Database Design](#11-database-design)
12. [Folder Structure](#12-folder-structure)
13. [Unit I Concepts (Distributed Foundations)](#13-unit-i-concepts-distributed-foundations)
14. [Unit II Concepts (Communication Paradigms)](#14-unit-ii-concepts-communication-paradigms)
15. [Unit III Concepts (Synchronization & Mutual Exclusion)](#15-unit-iii-concepts-synchronization--mutual-exclusion)
16. [Communication Flow](#16-communication-flow)
17. [REST API Endpoints](#17-rest-api-endpoints)
18. [gRPC / RPC Communication](#18-grpc--rpc-communication)
19. [Socket.IO Events & Sync Protocol](#19-socketio-events--sync-protocol)
20. [Distributed Mutual Exclusion (Mutex)](#20-distributed-mutual-exclusion-mutex)
21. [Logical & Vector Clocks](#21-logical--vector-clocks)
22. [Global State Snapshot](#22-global-state-snapshot)
23. [Distributed Health & Fault Tolerance](#23-distributed-health--fault-tolerance)
24. [Version History](#24-version-history)
25. [Installation Requirements](#25-installation-requirements)
26. [MongoDB Setup](#26-mongodb-setup)
27. [Environment Variables](#27-environment-variables)
28. [How to Start Each Service](#28-how-to-start-each-service)
29. [Automated Test Suites](#29-automated-test-suites)
30. [Running with LocalTunnel (Different Wi-Fi / Remote Access)](#30-running-with-localtunnel-different-wi-fi--remote-access)
31. [How Two Users Test the System](#31-how-two-users-test-the-system)
32. [Distributed Systems Syllabus Mapping Table](#32-distributed-systems-syllabus-mapping-table)
33. [Limitations and Future Scope](#33-limitations-and-future-scope)

---

## 1. Project Title & Problem Statement

### Project Title:
**Real-Time Distributed Collaborative Notes and Document System**

### Problem Statement:
In group projects, study circles, and academic environments, students frequently work together on shared notes, reports, and documentation across separate devices and network locations.

When multiple users edit shared content concurrently, fundamental distributed systems challenges arise:
- **Delayed Updates:** Unsynchronized clients work on stale copies.
- **Inconsistent Document States:** Concurrent edits cause data collision and lost updates.
- **Network Boundaries:** Users on different Wi-Fi networks / locations cannot easily collaborate without complex cloud deployment.

---

## 2. Why This Problem Is Important

1. **Practical Utility:** Academic collaboration demands real-time co-authoring tools with low friction (zero signup barrier).
2. **Clear Demonstration of Syllabus:** Naturally maps to core Distributed Systems topics: Service-Oriented Architecture, Middleware, REST Request-Response, Remote Procedure Calls (gRPC), WebSocket Event Streaming, P2P Messaging, and Distributed Multimedia via WebRTC.
3. **Multi-Network Flexibility:** Works seamlessly whether collaborators are on the same machine, same Wi-Fi LAN, or different networks via LocalTunnel.

---

## 3. Objectives

- Design and implement a multi-service distributed architecture separated into logical tiers.
- Enable single-origin exposure through LocalTunnel by proxying real-time WebSocket streams through the API Gateway.
- Demonstrate client-to-gateway request routing and service-to-service gRPC communication.
- Implement persistent stream-oriented real-time editing using WebSocket/Socket.IO.
- Enable in-document collaborator messaging and direct browser-to-browser WebRTC video/audio calls.
- Persist document snapshots and sequential version history in MongoDB.

---

## 4. Features

- **Zero-Friction Session Identification:** Temporary session ID and name (e.g. `Tanmay`, `Rahul`).
- **6-Character Document Rooms:** Unique alphanumeric document IDs (e.g. `ABC123`) for effortless sharing.
- **Real-Time Collaborative Editing:** Continuous stream of keystrokes synchronized across all active browser windows.
- **Live User Presence:** Dynamic list of connected collaborators with active connection status indicators.
- **Collaborator Chat:** Real-time messaging within the shared document space.
- **Two-Person WebRTC Video & Audio Call:** Direct P2P media stream with Socket.IO signaling.
- **Version History & Snapshot Restore:** MongoDB-backed version history with single-click previous version restoration.

---

## 5. Technology Stack

- **Frontend:** Vanilla HTML5, CSS3, JavaScript (Fetch API, WebRTC APIs).
- **API Gateway:** Node.js, Express.js, `http-proxy` (Socket.IO WS/HTTP proxying), gRPC Client.
- **Document Service:** Node.js, Express.js (Port 5001), gRPC Server (Port 5003), Mongoose / MongoDB.
- **Collaboration Service:** Node.js, Express.js, Socket.IO (Port 5002).
- **Database:** MongoDB (Port 27017).

---

## 6. System Architecture (Local & LocalTunnel)

```
                                    CLIENTS
                           (Browser / Remote User)
                                      |
                                      | HTTP/REST & WebSocket
                                      ↓
                   ┌──────────────────────────────────────┐
                   │          API GATEWAY :3000           │
                   │  - Serves static web frontend        │
                   │  - Validates document IDs            │
                   │  - Translates REST to gRPC calls     │
                   │  - Proxies Socket.IO traffic         │
                   └──────────────┬────────────────┬──────┘
                                  │                │
                        gRPC RPC  │                │ HTTP Proxy
                       (Port 5003)│                │ (/socket.io)
                                  ↓                ↓
          ┌──────────────────────────────┐   ┌──────────────────────────────┐
          │    DOCUMENT SERVICE :5001    │   │  COLLABORATION SERVICE :5002 │
          │  - gRPC Server (Port 5003)   │   │  - Socket.IO Event Engine    │
          │  - REST Fallback (Port 5001) │   │  - Stream-oriented editing   │
          │  - Mongoose Document Models  │   │  - In-document Chat Relay    │
          └──────────────┬───────────────┘   │  - WebRTC Signaling          │
                         │                   └──────────────┬───────────────┘
                         ↓                                  │
                   ┌───────────┐                            │ WebRTC Signaling
                   │  MongoDB  │                            ↓
                   │ Database  │                     ┌───────────────┐
                   └───────────┘                     │  Peer-to-Peer │
                                                     │ Audio / Video │
                                                     │ (Browser-to-  │
                                                     │   Browser)    │
                                                     └───────────────┘
```

---

## 7. Architecture Explanation

1. **API Gateway (Port 3000):** The single public entry point for all traffic. It serves static HTML/JS/CSS, handles REST document requests (translating them to gRPC calls), and proxies Socket.IO connections to the Collaboration Service.
2. **Document Service (Port 5001 / 5003):** Microservice managing document persistence and version history in MongoDB via gRPC and REST.
3. **Collaboration Service (Port 5002):** Microservice managing active document rooms, streaming keystroke edits, in-room chat messages, and WebRTC signaling.
4. **WebRTC P2P Channel:** Once signaling is completed via Socket.IO, media frames flow directly between user browsers without passing through backend servers.

---

## 8. Explanation of API Gateway & Socket.IO Proxying

When exposing the application over LocalTunnel (e.g. `https://my-notes.loca.lt`), only **one port (port 3000)** is exposed publicly.
- Standard HTTP requests for frontend static assets (`/client`) and REST APIs are handled by the Gateway.
- All WebSocket / Socket.IO upgrade requests (`/socket.io`) are transparently forwarded to the Collaboration Service on port 5002 via `http-proxy`.

---

## 9. Explanation of Document Service

The Document Service is responsible for:
- Creating new documents with unique 6-character alphanumeric IDs.
- Storing document titles and text content in MongoDB.
- Maintaining an immutable sequential version history log (`DocumentVersion` model).
- Exposing gRPC RPC methods on port 5003 (`CreateDocument`, `GetDocument`, `SaveDocument`).

---

## 10. Explanation of Collaboration Service

The Collaboration Service runs on port 5002 using Socket.IO:
- Tracks connected users in document-specific rooms.
- Broadcasts real-time text edits as users type.
- Relays in-document chat messages.
- Relays WebRTC signaling payloads (SDP Offers, SDP Answers, ICE Candidates).

---

## 11. Database Design

### MongoDB Collections:
1. **`documents`**:
   - `documentId`: String (Unique 6-character ID, e.g. `ABC123`)
   - `title`: String
   - `content`: String
   - `createdAt`: Date
   - `updatedAt`: Date
2. **`documentversions`**:
   - `documentId`: String
   - `versionNumber`: Number (Sequential: 1, 2, 3...)
   - `title`: String
   - `content`: String
   - `savedBy`: String
   - `timestamp`: Date

---

## 12. Folder Structure

```
Notes_sharing/
├── api-gateway/
│   └── server.js                  # Gateway on port 3000 (Proxy + gRPC Client)
├── collaboration-service/
│   ├── socket/
│   │   └── socketHandler.js       # Real-time editing & WebRTC signaling
│   └── server.js                  # Collab Service on port 5002 (Socket.IO)
├── document-service/
│   ├── controllers/
│   │   └── documentController.js  # Mongoose CRUD logic
│   ├── models/
│   │   ├── Document.js            # MongoDB Document schema
│   │   └── DocumentVersion.js     # MongoDB Version History schema
│   ├── routes/
│   │   └── documentRoutes.js      # REST routes
│   ├── grpcServer.js              # gRPC Server on port 5003
│   └── server.js                  # Document Service on port 5001
├── client/
│   ├── css/
│   │   └── style.css              # Frontend styling
│   ├── js/
│   │   ├── document.js            # Document editing & Socket.IO client
│   │   ├── home.js                # Home page create/join client
│   │   └── webrtc.js              # WebRTC P2P audio/video client
│   ├── document.html              # Collaborative document workspace
│   └── index.html                 # Home entry page
├── proto/
│   └── document.proto             # Protocol Buffers interface definition
├── scripts/
│   ├── test-api.js                # Automated REST / gRPC test
│   └── test-collaboration.js      # Automated Socket.IO & LocalTunnel test
├── .env                           # Environment configuration
├── package.json                   # Dependencies & npm scripts
└── README.md                      # Project documentation
```

---

## 13. Unit I Concepts (Distributed Foundations)

- **Definition of Distributed Systems:** Autonomous computers communicating over a network that appear to the user as a single coherent system.
- **Goals:** Resource sharing (shared document access), Openness (standard protocols REST, gRPC, WebSocket), Concurrency.
- **Distributed Architectures:** Tiered Service-Oriented Architecture (SOA) with an API Gateway pattern.
- **Middleware:** Express middleware pipeline (CORS, logging, validation, error handling) and Socket.IO middleware.
- **Distributed Multimedia Systems:** Synchronized text collaboration combined with audio/video media streams via WebRTC.

---

## 14. Unit II Concepts (Communication Paradigms)

- **Client–Server Model:** Request-response communication between client browsers and API Gateway.
- **Remote Procedure Call (RPC) & gRPC:** API Gateway executing remote procedures on Document Service via Protocol Buffers over port 5003.
- **Message-Oriented Communication:** Asynchronous event messages via Socket.IO (`document:join`, `message:send`, `room:users`).
- **Stream-Oriented Communication:** Continuous WebSocket keystroke edit streams (`document:edit`).
- **Peer-to-Peer (P2P) Communication:** Direct WebRTC media streaming between client browsers.

---

## 15. Unit III Concepts (Synchronization & Mutual Exclusion)

- **Clock Synchronization & Logical Clocks (Lamport's Algorithm):** Because distributed physical clocks suffer from clock skew and drift, Lamport logical clocks assign a monotonically increasing integer timestamp $L(e)$ to events to establish a partial "happens-before" ($a \to b$) order.
  - *Local event:* $L \leftarrow L + 1$
  - *Receive event:* $L \leftarrow \max(L, L_{msg}) + 1$
- **Vector Clocks & Causality Tracking:** Overcomes Lamport clock limitation (where $L(a) < L(b)$ does not guarantee $a \to b$). Each node maintains a vector $V$ of size $N$. Events capture causal dependencies, allowing clients and servers to distinguish causally ordered operations from concurrent ones ($a \parallel b$).
- **Distributed Mutual Exclusion (Mutex / Lease Pattern):** Protects critical editing operations (e.g. atomic bulk-save or document restore) against race conditions. A server-authoritative lease model ensures:
  - **Safety:** At most one collaborator holds the lock at any instant.
  - **Liveness & Crash Recovery:** Locks auto-expire after a 30-second TTL to prevent deadlocks if a client crashes or disconnects.
  - **Idempotency:** Re-requests by the existing lock holder are cleanly handled without error.
  - **Disconnect Cleanup:** The server immediately frees the lock if the holding socket drops.
- **Consistent Global State Snapshot:** Captures an instantaneous, coherent cut of the distributed system (connected nodes, lock state, Lamport clock, vector clock, and event history ring buffer).
- **Distributed Health & Fault Tolerance:** Centralized `/api/sync/health` diagnostics that monitor connectivity across all microservices (API Gateway, Document Service, Collaboration Service, gRPC channel, MongoDB).

---

## 16. Communication Flow

```
Browser                     API Gateway (3000)        Document Service (5003)        MongoDB (27017)
   |                                |                           |                           |
   |--- POST /api/documents ------->|                           |                           |
   |    (REST Request)              |--- gRPC: CreateDocument ->|                           |
   |                                |    (Binary Protobuf)      |--- Document.create() ---->|
   |                                |                           |<-- Saved Document --------|
   |                                |<-- gRPC Response ---------|                           |
   |<-- HTTP 201 Response ----------|                           |                           |
```

---

## 17. REST API Endpoints

- `POST /api/documents` — Create a new document in MongoDB (routed via gRPC).
- `GET /api/documents/:documentId` — Retrieve document content by ID (routed via gRPC).
- `PUT /api/documents/:documentId` — Update document and create an immutable version snapshot (routed via gRPC).
- `GET /api/documents/:documentId/versions` — Get version history snapshots.
- `GET /api/sync/health` — Distributed system health checking across all services, database, and gRPC channels.
- `GET /health` — Service health diagnostics for API Gateway.

---

## 18. gRPC / RPC Communication

Defined in `proto/document.proto`:
- `CreateDocument(CreateDocumentRequest) -> CreateDocumentResponse`
- `GetDocument(GetDocumentRequest) -> GetDocumentResponse`
- `SaveDocument(SaveDocumentRequest) -> SaveDocumentResponse`

All high-frequency or structured internal communication between API Gateway (port 3000) and Document Service (port 5003) uses binary Protocol Buffers over HTTP/2.

---

## 19. Socket.IO Events & Sync Protocol

| Event Name | Direction | Payload | Distributed Concept |
|---|---|---|---|
| `document:join` | Client → Server | `{ documentId, userId, userName }` | Group membership & presence |
| `room:users` | Server → Room | `Array<{ userId, userName }>` | Coordinated active collaborator list |
| `document:edit` | Client ⇄ Room | `{ documentId, content, lamportTime, vector }` | Stream-oriented editing with logical clocks |
| `document:title` | Client ⇄ Room | `{ documentId, title, lamportTime, vector }` | Metadata synchronization |
| `document:save` | Client ⇄ Room | `{ documentId, versionNumber, lamportTime, vector }` | Snapshot commit notification |
| `message:send` | Client ⇄ Room | `{ documentId, text, userName, lamportTime, vector }` | P2P chat message with causal stamp |
| `lock:acquire` | Client → Server | `{ documentId, userId, userName, lamportTime, vector }` | Request exclusive critical-section lease |
| `lock:acquire:response` | Server → Client | `{ granted, reason, lock }` | Authoritative mutual exclusion grant/denial |
| `lock:release` | Client → Server | `{ documentId, userId, lamportTime, vector }` | Explicit lease relinquishment |
| `lock:state` | Server → Room | `{ locked, holder, expiresAt, lamportTime, vector }` | Broadcast lock status changes |
| `snapshot:request` | Client → Server | `{ documentId }` | On-demand global state inquiry |
| `snapshot:response` | Server → Client | `{ capturedAt, connectedUsers, lock, lamportClock, vectorClock, recentEvents }` | Coherent global cut returned |
| `sync:events` | Server → Room | `Array<EventRecord>` | Ring-buffer distributed event history |
| `user:left` | Server → Room | `{ userId, userName, lamportTime, vector }` | Disconnection notification & mutex cleanup |

---

## 20. Distributed Mutual Exclusion (Mutex)

Critical document operations (such as bulk save or restores) are protected against race conditions using a server-authoritative lease pattern:
1. **Request:** A client emits `lock:acquire`.
2. **Evaluation:** If the lock is unheld, it is granted. If the same user re-requests, the call is idempotent. If held by another client, it is rejected with a descriptive conflict notification.
3. **Lease TTL:** The server arms a 30-second timer (`LOCK_TTL_MS = 30000`). If the client crashes or loses connectivity before releasing, the lease automatically expires.
4. **Crash Recovery:** If a client abruptly closes their browser tab, the `disconnect` handler detects the socket ID and releases the lock immediately for other collaborators.

---

## 21. Logical & Vector Clocks

- **Lamport Logical Clock:** Every document room maintains a scalar clock. Each local user action increments the counter. Transmitted messages carry the sender's clock. Receivers execute `clock = max(local, received) + 1`, ensuring that all events are partially ordered consistently across nodes without relying on synchronized physical hardware clocks.
- **Vector Clocks:** A vector $V[u]$ tracks the number of events produced by each distinct collaborator $u$. Every event includes the client's current vector. On message receipt, the node performs component-wise merge: $\forall k: V_{local}[k] = \max(V_{local}[k], V_{msg}[k])$, followed by incrementing its own entry. This enables rigorous causal relationship detection (`before`, `after`, or `concurrent`).

---

## 22. Global State Snapshot

At any point, a collaborator or administrator can inspect the coherent distributed state of the room by issuing `snapshot:request`:
- Returns active connected nodes.
- Current lock ownership and expiration.
- Current Lamport scalar clock and full vector clock.
- Monotonically ordered recent event log.

---

## 23. Distributed Health & Fault Tolerance

The `/api/sync/health` endpoint performs real-time health checks across the distributed topology:
- **API Gateway (Port 3000):** Process liveness and uptime.
- **Document Service (Port 5001):** HTTP liveness and MongoDB connection status.
- **Collaboration Service (Port 5002):** Socket.IO server status.
- **gRPC Channel (Port 5003):** RPC channel connectivity to Document Service.

---

## 24. Distributed Multimedia System & WebRTC

- **Signaling via Socket.IO:** Relays `webrtc:join-call`, `webrtc:offer`, `webrtc:answer`, `webrtc:ice-candidate`, `webrtc:end-call`.
- **Direct P2P Media Stream:** Media flows directly between browser video elements using STUN servers (`stun.l.google.com:19302`).
- Combines synchronous real-time text co-authoring with simultaneous low-latency peer-to-peer audio and video calling.

---

## 25. Version History

Every save operation creates an immutable snapshot in MongoDB with sequential numbering (`Version 1`, `Version 2`...). Users can click any previous version to restore the document content.

---

## 25. Installation Requirements

- **Node.js:** v16+
- **MongoDB:** Running locally on `mongodb://localhost:27017`

---

## 26. MongoDB Setup

Ensure MongoDB is running locally:
```bash
# In PowerShell / Command Prompt
mongod
# Or verify with mongosh
mongosh
```

---

## 27. Environment Variables

Configured in `.env`:
```env
MONGODB_URI=mongodb://localhost:27017/collaborative-notes
API_GATEWAY_PORT=3000
DOCUMENT_SERVICE_PORT=5001
COLLABORATION_SERVICE_PORT=5002
GRPC_PORT=5003
DOCUMENT_SERVICE_URL=http://localhost:5001
COLLABORATION_SERVICE_URL=http://localhost:5002
```

---

## 28. How to Start Each Service

Open **3 separate terminal windows**:

**Terminal 1 — Document Service (REST :5001 & gRPC :5003):**
```bash
npm run start:document
```

**Terminal 2 — Collaboration Service (Socket.IO :5002):**
```bash
npm run start:collab
```

**Terminal 3 — API Gateway (Port :3000):**
```bash
npm run start:gateway
```

Access the frontend at:
```
http://localhost:3000/client/index.html
```

---

---

## 29. Automated Test Suites

Three comprehensive automated test suites are included to verify every tier of the distributed architecture:

1. **REST & gRPC Integration Test:**
   ```bash
   npm run test:api
   ```
   *Verifies document creation, gRPC binary call execution, database persistence, and sequential version history.*

2. **Real-Time Collaboration & LocalTunnel Single-Entry Test:**
   ```bash
   npm run test:collab
   ```
   *Simulates two remote clients connecting through the API Gateway port 3000 proxy, streaming real-time edits, and exchanging P2P chat messages.*

3. **Distributed Systems Unit III Synchronization & Mutex Test:**
   ```bash
   npm run test:sync
   ```
   *Validates Lamport logical clock advancement, vector clock causality merge, server-authoritative mutual exclusion lock acquisition and rejection under contention, idempotency, lock release handoff, crash recovery upon client disconnection, global state snapshot coherence, and distributed service health diagnostics.*

---

## 30. Running with LocalTunnel (Different Wi-Fi / Remote Access)

To collaborate with teammates on different Wi-Fi networks or mobile phones:

```bash
npx localtunnel --port 3000 --subdomain my-collab-notes
```

Share the generated URL (e.g. `https://my-collab-notes.loca.lt`) with your teammates. Because the application uses dynamic origin resolution (`window.location.origin`) and proxies WebSockets through port 3000, remote users connect with zero configuration.

---

## 31. How Two Users Test the System

1. **User 1 (Host):**
   - Open `http://localhost:3000/client/index.html`.
   - Enter name `Tanmay` → Click **"Create New Document"**.
   - Copy the 6-character Document ID (e.g. `ABC123`) and click **"Open Document"**.

2. **User 2 (Collaborator):**
   - Open an Incognito window or second browser at `http://localhost:3000/client/index.html`.
   - Enter name `Rahul`, enter Document ID `ABC123` → Click **"Join Document"**.

3. **Verify Real-Time Collaboration (Unit II):**
   - Both users see each other in the "Connected Users" list.
   - Typing in one window instantly appears in the other window.
   - Send chat messages in the chat box.
   - Click "Save" to record a snapshot in MongoDB and verify the Version History list.
   - Click "Start Video Call" to establish direct P2P audio/video streaming.

4. **Verify Distributed Synchronization & Mutex (Unit III):**
   - Expand the **"Distributed Synchronization"** sidebar panel on both windows.
   - Notice the **Lamport Logical Clock** and **Vector Clock** badges updating in real time with each keystroke or chat message.
   - Click **"Acquire Document Lock"** in User 1's window.
     - User 1's status displays: `Lock Status: Held by You (Tanmay)`.
     - User 2's status immediately updates to: `Locked by Tanmay`.
   - In User 2's window, attempt to click **"Acquire Document Lock"**:
     - System displays an alert: *Document is currently being modified by Tanmay.*
   - In User 1's window, click **"Release Document Lock"**:
     - Lock status frees for all participants.
   - Test **Fault Tolerance & Crash Recovery**:
     - User 2 acquires the lock, then closes their browser tab.
     - Observe User 1's window: the server detects the disconnection and automatically frees the lock.
   - Click **"Capture Global State Snapshot"**:
     - Displays the instantaneous coherent state cut (active nodes, clocks, and lock status).
   - Click **"Check Services Health"**:
     - Confirms live operational status for API Gateway, Document Service, Collaboration Service, and gRPC.

---

## 32. Distributed Systems Syllabus Mapping Table

| Syllabus Topic | Unit | Implementation in Project | File / Component |
|---|---|---|---|
| **Distributed Architecture** | Unit I | Microservice-oriented design (API Gateway, Document Service, Collaboration Service) | `api-gateway/`, `document-service/`, `collaboration-service/` |
| **Client–Server Model** | Unit I | Browser client communicates with backend services via API Gateway | `client/` ↔ `api-gateway/server.js` |
| **Middleware Pipeline** | Unit I | Express middleware (CORS, logging, validation, error handling) and proxy pipelines | `api-gateway/server.js` |
| **Distributed Multimedia Systems** | Unit I | Synchronous real-time co-authoring combined with P2P audio/video | `client/document.html`, `client/js/webrtc.js` |
| **REST Communication** | Unit II | HTTP GET, POST, PUT request-response for document operations | `document-service/routes/documentRoutes.js` |
| **Remote Procedure Call (RPC)** | Unit II | API Gateway invoking Document Service methods over the network | `api-gateway/server.js` ↔ `document-service/` |
| **gRPC Communication** | Unit II | Binary Protocol Buffers communication on internal TCP port 5003 | `proto/document.proto`, `document-service/grpcServer.js` |
| **Message-Oriented Communication** | Unit II | Socket.IO event messages (`document:join`, `message:send`, `room:users`) | `collaboration-service/socket/socketHandler.js` |
| **Stream-Oriented Communication** | Unit II | Persistent WebSocket stream for real-time keystroke synchronization | `client/js/document.js` (`document:edit` event) |
| **Peer-to-Peer (P2P) Communication** | Unit II | WebRTC direct browser-to-browser media stream | `client/js/webrtc.js` |
| **Clock Synchronization (Logical Clocks)** | Unit III | Lamport's algorithm stamping all distributed events; monotone advance | `collaboration-service/socket/socketHandler.js`, `client/js/document.js` |
| **Vector Clocks & Causality** | Unit III | Vector clock per collaborator, component-wise max merge, causality tracking | `collaboration-service/socket/socketHandler.js`, `client/js/dsync.js` |
| **Distributed Mutual Exclusion** | Unit III | Server-authoritative document lease/lock for critical section operations | `collaboration-service/socket/socketHandler.js` (`lock:acquire`, `lock:release`) |
| **Crash Recovery & Fault Tolerance** | Unit III | 30s lease TTL expiry timer + socket disconnect listener ensuring no deadlocks | `collaboration-service/socket/socketHandler.js` (`disconnect`, `LOCK_TTL_MS`) |
| **Consistent Global State Snapshot** | Unit III | Coherent global cut capture of connected nodes, lock state, and clocks | `collaboration-service/socket/socketHandler.js` (`snapshot:request`) |
| **Distributed System Health Monitoring** | Unit III | Multi-service health diagnostics verifying Gateway, Services, DB, and gRPC | `api-gateway/server.js` (`/api/sync/health`), `client/js/dsync.js` |
| **Persistent Distributed State** | Foundations | MongoDB document snapshots and sequential version history | `document-service/models/` |

---

## 33. Limitations and Future Scope

- **NAT Traversal:** Uses Google's public STUN servers for WebRTC; production deployments with symmetric NATs require TURN relay servers.
- **Concurrent Conflict Resolution:** Uses last-write-wins WebSocket stream synchronization; advanced industrial tools use Operational Transformation (OT) or CRDTs.
- **Single Database Node:** MongoDB runs as a standalone instance rather than a replica set.
