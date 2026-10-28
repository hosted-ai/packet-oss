# Service Exposure Architecture

## System Architecture Diagrams

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Internet / Public                         │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                                │ HTTPS
                                ▼
                    ┌───────────────────────┐
                    │   dash.packet.ai      │
                    │   (Next.js Frontend)  │
                    └───────────┬───────────┘
                                │
                                │ REST API
                                │ (JWT Auth)
                                ▼
                    ┌───────────────────────┐
                    │  /api/services/*      │
                    │  (Backend Routes)     │
                    └───────────┬───────────┘
                                │
                                │ HTTP
                                ▼
                    ┌───────────────────────┐
                    │   hosted.ai API       │
                    │   (GPUaaS Platform)   │
                    └───────────┬───────────┘
                                │
                                │ Kubernetes API
                                ▼
        ┌───────────────────────────────────────────┐
        │         Kubernetes Cluster                 │
        │                                            │
        │  ┌──────────────────────────────────┐     │
        │  │  Kubernetes Service              │     │
        │  │                                  │     │
        │  │  External IP: 34.123.45.67       │     │
        │  │  External Port: 31234            │     │
        │  └───────────────┬──────────────────┘     │
        │                  │                         │
        │                  │ Routes traffic to       │
        │                  ▼                         │
        │  ┌──────────────────────────────────┐     │
        │  │  GPU Pod                         │     │
        │  │                                  │     │
        │  │  ┌────────────────────────┐      │     │
        │  │  │ vLLM Server            │      │     │
        │  │  │ Listening on:          │      │     │
        │  │  │ 0.0.0.0:8000          │      │     │
        │  │  └────────────────────────┘      │     │
        │  │                                  │     │
        │  │  ┌────────────────────────┐      │     │
        │  │  │ NVIDIA A100 GPU        │      │     │
        │  │  └────────────────────────┘      │     │
        │  └──────────────────────────────────┘     │
        └───────────────────────────────────────────┘
```

---

## User Flow: Exposing a Service

```
┌─────────┐       ┌─────────────┐       ┌──────────────┐       ┌─────────────┐
│  User   │       │  Dashboard  │       │  Backend API │       │  hosted.ai  │
│ Browser │       │   (React)   │       │   (Next.js)  │       │     API     │
└────┬────┘       └──────┬──────┘       └──────┬───────┘       └──────┬──────┘
     │                   │                     │                       │
     │ 1. Click          │                     │                       │
     │ "+ Expose Port"   │                     │                       │
     ├──────────────────>│                     │                       │
     │                   │                     │                       │
     │                   │ 2. Show form        │                       │
     │<──────────────────┤                     │                       │
     │                   │                     │                       │
     │ 3. Fill & submit  │                     │                       │
     │ (name, port, etc) │                     │                       │
     ├──────────────────>│                     │                       │
     │                   │                     │                       │
     │                   │ 4. POST /api/services                      │
     │                   │ (JWT token + data)  │                       │
     │                   ├────────────────────>│                       │
     │                   │                     │                       │
     │                   │                     │ 5. Verify JWT         │
     │                   │                     │ & permissions         │
     │                   │                     │                       │
     │                   │                     │ 6. POST               │
     │                   │                     │ /pods/expose-service  │
     │                   │                     ├──────────────────────>│
     │                   │                     │                       │
     │                   │                     │                       │ 7. Create
     │                   │                     │                       │ K8s Service
     │                   │                     │                       │
     │                   │                     │                       │ 8. Allocate
     │                   │                     │                       │ External IP
     │                   │                     │                       │
     │                   │                     │ 9. Return service     │
     │                   │                     │ record                │
     │                   │                     │<──────────────────────│
     │                   │                     │                       │
     │                   │ 10. Return service  │                       │
     │                   │<────────────────────┤                       │
     │                   │                     │                       │
     │ 11. Show success  │                     │                       │
     │<──────────────────┤                     │                       │
     │                   │                     │                       │
     │                   │ 12. Refresh list    │                       │
     │                   │ GET /api/services   │                       │
     │                   ├────────────────────>│                       │
     │                   │                     │                       │
     │                   │                     │ 13. Fetch exposed     │
     │                   │                     │ services              │
     │                   │                     ├──────────────────────>│
     │                   │                     │                       │
     │                   │                     │ 14. Return services   │
     │                   │                     │ with external IP/port │
     │                   │                     │<──────────────────────│
     │                   │                     │                       │
     │                   │ 15. Return list     │                       │
     │                   │<────────────────────┤                       │
     │                   │                     │                       │
     │ 16. Display       │                     │                       │
     │ external URL      │                     │                       │
     │<──────────────────┤                     │                       │
     │                   │                     │                       │
```

---

## Network Traffic Flow

### Without Service Exposure (SSH Tunnel)
```
Developer's Laptop                        GPU Pod
┌─────────────────┐                  ┌──────────────┐
│                 │                  │              │
│  Application    │───SSH Tunnel────>│  vLLM :8000  │
│                 │   (fragile)      │              │
│  localhost:8000 │                  │  GPU Server  │
└─────────────────┘                  └──────────────┘

Problems:
❌ Tunnel breaks on disconnect
❌ Can't share with team
❌ Not suitable for production
❌ Requires SSH access
```

### With Service Exposure
```
Internet                 Kubernetes Cluster              GPU Pod
┌─────────┐         ┌─────────────────────────┐    ┌──────────────┐
│         │         │                         │    │              │
│  Client ├────────>│  Exposed Service        ├───>│  vLLM :8000  │
│         │  HTTP   │  External: 34.45.67:31234│    │              │
│         │         │  Internal: pod:8000     │    │  GPU Server  │
└─────────┘         └─────────────────────────┘    └──────────────┘

Benefits:
✅ Always available
✅ Public URL
✅ No SSH needed
✅ Team can access
```

UDP services can additionally be routed through a LoadBalancer service type (selected in the expose form when the protocol is UDP).

---

## Component Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                     Frontend (React/Next.js)                      │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  GPU Instance Card Component                                │  │
│  │                                                             │  │
│  │  ┌──────────────────────────────────────────────────────┐  │  │
│  │  │  Exposed Services Section                            │  │  │
│  │  │                                                       │  │  │
│  │  │  State:                                              │  │  │
│  │  │  - exposedServices[]                                 │  │  │
│  │  │  - showExposeServiceForm                             │  │  │
│  │  │  - serviceForm { name, port, protocol, type }       │  │  │
│  │  │  - loadingServices                                   │  │  │
│  │  │                                                       │  │  │
│  │  │  UI Elements:                                        │  │  │
│  │  │  [+ Expose Port] Button                              │  │  │
│  │  │  Service Form (name, port, protocol, type)           │  │  │
│  │  │  Services List (with edit/delete buttons)            │  │  │
│  │  │                                                       │  │  │
│  │  │  Handlers:                                           │  │  │
│  │  │  - handleExposeService()                             │  │  │
│  │  │  - handleEditService()                               │  │  │
│  │  │  - handleDeleteService()                             │  │  │
│  │  └───────────────────────────────────────────────────────┘  │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  API Calls:                                                       │
│  - GET  /api/services?instanceId={id}                            │
│  - POST /api/services                                             │
│  - PUT  /api/services                                             │
│  - DELETE /api/services?id={id}                                  │
└───────────────────────────────────┬───────────────────────────────┘
                                    │
                                    │ HTTP (JWT Auth)
                                    ▼
┌──────────────────────────────────────────────────────────────────┐
│                     Backend API Routes                            │
│                                                                   │
│  /api/services/route.ts                                          │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  GET Handler:                                              │  │
│  │  1. Verify JWT token                                       │  │
│  │  2. Extract instanceId from query                          │  │
│  │  3. Call getExposedServices(instanceId)                    │  │
│  │  4. Return { services: [...] }                             │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  POST Handler:                                             │  │
│  │  1. Verify JWT token                                       │  │
│  │  2. Validate request body                                  │  │
│  │  3. Call exposeService({ pod_name, port, ... })           │  │
│  │  4. Return { service: { id, status, ... } }               │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  /api/services/status/route.ts                                   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  GET Handler:                                              │  │
│  │  1. Verify JWT token                                       │  │
│  │  2. Extract serviceName, poolSubscriptionId, operationId   │  │
│  │  3. Call getExposeServiceStatus(...)                       │  │
│  │  4. Return { status: { status, node_port, ... } }         │  │
│  └────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────┬───────────────────────────────┘
                                    │
                                    │ HTTP
                                    ▼
┌──────────────────────────────────────────────────────────────────┐
│                   hosted.ai Library (src/lib/hostedai.ts)         │
│                                                                   │
│  export async function exposeService(opts)                       │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  return hostedaiRequest(                                    │  │
│  │    "POST",                                                  │  │
│  │    "/pods/expose-service",                                  │  │
│  │    { pod_name, port, service_name, protocol, type }        │  │
│  │  )                                                          │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  export async function getExposedServices(instanceId)            │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  return hostedaiRequest(                                    │  │
│  │    "GET",                                                   │  │
│  │    `/instances/unified/${instanceId}/exposed-services`      │  │
│  │  )                                                          │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  export async function updateExposedService(opts)                │
│  export async function deleteExposedService(id)                  │
│  export async function getExposeServiceStatus(...)               │
└───────────────────────────────────┬───────────────────────────────┘
                                    │
                                    │ HTTPS
                                    ▼
┌──────────────────────────────────────────────────────────────────┐
│                     hosted.ai GPUaaS API                          │
│                                                                   │
│  POST /pods/expose-service                                        │
│  GET  /pods/expose-service/status                                │
│  GET  /instances/unified/{id}/exposed-services                   │
│  PUT  /pods/update-exposed-service                               │
│  DELETE /pods/delete-exposed-service/{id}                        │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  Kubernetes Service Creation Logic                         │  │
│  │  1. Validate pod exists                                    │  │
│  │  2. Create Service manifest                                │  │
│  │  3. Apply to cluster                                       │  │
│  │  4. Wait for external IP assignment                        │  │
│  │  5. Return the service record                              │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

---

## Data Flow: Expose Service Request

```
Frontend Form Data
┌──────────────────────────────────┐
│ {                                │
│   pod_name: "gpu-pool-abc-0"     │ ← From the instance card
│   pool_subscription_id: 456      │ ← Instance/subscription ID
│   service_name: "vllm-api"       │
│   port: 8000                     │
│   protocol: "TCP"                │
│   service_type: "http"           │
│ }                                │
└────────────┬─────────────────────┘
             │
             ▼
Backend Normalisation
┌──────────────────────────────────┐
│ {                                │
│   pod_name: "gpu-pool-abc-0"     │ ← Instance ID used for i-… pods
│   pool_subscription_id: 456      │
│   port: 8000                     │
│   service_name: "vllm-api"       │
│   protocol: "TCP"                │ ← Normalised to TCP or UDP
│   service_type: "http"           │ ← http/https/none (TCP) or
│ }                                │   NodePort/loadbalancer (UDP)
└────────────┬─────────────────────┘
             │
             ▼
hosted.ai API
┌──────────────────────────────────┐
│ POST /pods/expose-service        │
│                                  │
│ Creates Kubernetes manifest:     │
│ {                                │
│   apiVersion: v1                 │
│   kind: Service                  │
│   metadata:                      │
│     name: vllm-api               │
│   spec:                          │
│     type: NodePort               │
│     selector:                    │
│       pod: gpu-pool-abc-0        │
│     ports:                       │
│     - port: 8000                 │
│       targetPort: 8000           │
│       protocol: TCP              │
│ }                                │
└────────────┬─────────────────────┘
             │
             ▼
Kubernetes Cluster
┌──────────────────────────────────┐
│ 1. Service created               │
│ 2. NodePort allocated: 31234     │
│ 3. External IP: 34.123.45.67     │
│                                  │
│ Routing rule:                    │
│ 34.123.45.67:31234 → pod:8000   │
└────────────┬─────────────────────┘
             │
             ▼
Response to Frontend
┌──────────────────────────────────┐
│ {                                │
│   service: {                     │
│     id: 123                      │
│     service_name: "vllm-api"     │
│     ip: "34.123.45.67"           │
│     node_port: 31234             │
│     pod_port: 8000               │
│     protocol: "TCP"              │
│     service_type: "http"         │
│     status: "ready"              │
│   }                              │
│ }                                │
└──────────────────────────────────┘
```

---

## Security Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                        Security Layers                          │
└────────────────────────────────────────────────────────────────┘

Layer 1: Authentication
┌──────────────────────────────────────────────────────────────┐
│  ✓ JWT token verification on all API requests               │
│  ✓ Token includes customer email and Stripe customer ID     │
│  ✓ Tokens expire after configured duration                  │
│  ✓ Secret key rotation supported                            │
└──────────────────────────────────────────────────────────────┘
                            │
                            ▼
Layer 2: Authorization
┌──────────────────────────────────────────────────────────────┐
│  ✓ Team-role permission checks on every request:            │
│    viewing services requires GPU access; exposing,          │
│    updating, and deleting require provisioning permission   │
│  ✓ Services are resolved through your team's instances      │
└──────────────────────────────────────────────────────────────┘
                            │
                            ▼
Layer 3: Input Validation
┌──────────────────────────────────────────────────────────────┐
│  ✓ Required fields checked (pod name, port, service name,   │
│    protocol, service type)                                   │
│  ✓ Protocol normalised to TCP or UDP                        │
│  ✓ Service type normalised per protocol: http/https/none    │
│    for TCP; NodePort/loadbalancer for UDP                   │
└──────────────────────────────────────────────────────────────┘
                            │
                            ▼
Layer 4: Network Isolation
┌──────────────────────────────────────────────────────────────┐
│  ✓ Each pod runs in isolated namespace                      │
│  ✓ Network policies prevent cross-pod access                │
│  ✓ Services only route to specific pod                      │
└──────────────────────────────────────────────────────────────┘
                            │
                            ▼
Layer 5: Application Security (User's Responsibility)
┌──────────────────────────────────────────────────────────────┐
│  ⚠ User must implement authentication in their service      │
│  ⚠ API keys, passwords, tokens are user's responsibility    │
│  ⚠ Rate limiting and DDoS protection                        │
│  ⚠ HTTPS/TLS if handling sensitive data                     │
└──────────────────────────────────────────────────────────────┘
```

---

## Deployment Architecture

```
Client Browser
      │ HTTPS
      ▼
┌────────────────────────────────────────────────────────────────┐
│              dash.packet.ai (Next.js dashboard)                 │
│                                                                 │
│  ├─ /dashboard (GPU instance cards, Exposed Services UI)       │
│  ├─ /api/services (CRUD endpoints)                             │
│  └─ /api/services/status (status checks)                       │
└────────────┬────────────────────────────────────────────────────┘
             │ HTTPS
             ▼
┌────────────────────────────────────────────────────────────────┐
│                     hosted.ai GPUaaS API                        │
│                                                                 │
│  Manages the Kubernetes services that route external           │
│  traffic to your GPU pods                                      │
└────────────────────────────────────────────────────────────────┘
```

The dashboard's `/api/services/*` routes proxy service-exposure requests to the hosted.ai platform, which creates and manages the underlying Kubernetes services.

---

## State Management Flow

```
Component Lifecycle:

1. Component Mount
   ┌───────────────────────────┐
   │ PoolSubscriptionCard      │
   │ - expanded = false        │
   │ - exposedServices = []    │
   └───────────┬───────────────┘
               │
               ▼
2. User Expands Card
   ┌───────────────────────────┐
   │ setExpanded(true)         │
   │                           │
   │ Triggers useEffect        │
   └───────────┬───────────────┘
               │
               ▼
3. Fetch Services
   ┌───────────────────────────┐
   │ setLoadingServices(true)  │
   │                           │
   │ GET /api/services?        │
   │   instanceId={id}         │
   │                           │
   │ setExposedServices(data)  │
   │ setLoadingServices(false) │
   └───────────┬───────────────┘
               │
               ▼
4. Display Services
   ┌───────────────────────────┐
   │ Render service list       │
   │ - Show each service       │
   │ - Show external URLs      │
   │ - Show delete button      │
   └───────────────────────────┘

5. User Actions
   ├─ Click "+ Expose Port"
   │  ┌───────────────────────────┐
   │  │ setShowExposeServiceForm  │
   │  │ (true)                    │
   │  │                           │
   │  │ Show form with inputs     │
   │  └───────────────────────────┘
   │
   ├─ Fill & Submit Form
   │  ┌───────────────────────────┐
   │  │ setSubmittingService(true)│
   │  │                           │
   │  │ POST /api/services        │
   │  │                           │
   │  │ Refetch services          │
   │  │ setSubmittingService(false│
   │  │ setShowExposeServiceForm  │
   │  │ (false)                   │
   │  └───────────────────────────┘
   │
   └─ Click Delete
      ┌───────────────────────────┐
      │ Confirm dialog            │
      │                           │
      │ DELETE /api/services?id=  │
      │                           │
      │ Refetch services          │
      └───────────────────────────┘
```

---

## Error Handling Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                     Error Handling Stack                         │
└─────────────────────────────────────────────────────────────────┘

Frontend (React)
┌──────────────────────────────────────────────────────────────┐
│  try {                                                        │
│    const response = await fetch('/api/services')            │
│    if (!response.ok) {                                       │
│      const data = await response.json()                     │
│      alert(data.error || 'Failed to...')  ← User sees this │
│    }                                                         │
│  } catch (error) {                                           │
│    console.error('Failed:', error)                          │
│    alert('Failed to...')                                    │
│  }                                                           │
└──────────────────────────────────────────────────────────────┘
                            │
                            ▼
Backend API Route
┌──────────────────────────────────────────────────────────────┐
│  try {                                                        │
│    // Verify auth                                            │
│    if (!token) {                                             │
│      return NextResponse.json(                              │
│        { error: "Unauthorized" },                           │
│        { status: 401 }                                      │
│      )                                                       │
│    }                                                         │
│                                                              │
│    // Validate input                                         │
│    if (!service_name || !port) {                            │
│      return NextResponse.json(                              │
│        { error: "Missing required fields" },                │
│        { status: 400 }                                      │
│      )                                                       │
│    }                                                         │
│                                                              │
│    // Call hosted.ai                                         │
│    const service = await exposeService(opts)                │
│                                                              │
│  } catch (error) {                                           │
│    console.error('Failed:', error)                          │
│    return NextResponse.json(                                │
│      { error: error.message || "Failed" },                 │
│      { status: 500 }                                        │
│    )                                                         │
│  }                                                           │
└──────────────────────────────────────────────────────────────┘
                            │
                            ▼
hosted.ai Library
┌──────────────────────────────────────────────────────────────┐
│  async function hostedaiRequest(method, path, body) {        │
│    const response = await fetch(url, options)               │
│                                                              │
│    if (!response.ok) {                                       │
│      const errorMessage = await response.text()             │
│      throw new Error(                                        │
│        `Hosted.ai API error (${response.status}): ` +       │
│          errorMessage                                        │
│      )                                                       │
│    }                                                         │
│                                                              │
│    return response.json()                                   │
│  }                                                           │
└──────────────────────────────────────────────────────────────┘
```

---

**Diagrams Version**: 1.1
**Last Updated**: July 2026

These diagrams are designed to be copy-pasted into documentation, wikis, or converted to visual diagrams using tools like draw.io, Lucidchart, or Mermaid.
