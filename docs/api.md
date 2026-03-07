# API Documentation

Programmatically manage your GPU instances with the GPU Cloud Platform API.

## Authentication

All API requests require an API key. Generate one from **Settings → API Keys** in the dashboard.

Include your API key in the `X-API-Key` header:

```bash
curl https://YOUR_DOMAIN/api/v1/instances \
  -H "X-API-Key: your-api-key-here"
```

## Base URL

```
https://YOUR_DOMAIN/api/v1
```

## Endpoints

### Instances

#### List Instances

```http
GET /api/v1/instances
```

Returns all your GPU instances.

**Response:**

```json
{
  "instances": [
    {
      "id": 123,
      "name": "my-gpu",
      "status": "subscribed",
      "gpu_model": "NVIDIA L4",
      "vgpu_count": 1,
      "created_at": "2024-01-15T10:30:00Z",
      "connection": {
        "host": "35.190.160.152",
        "port": 30123
      }
    }
  ]
}
```

#### Get Instance

```http
GET /api/v1/instances/:id
```

Get details for a specific instance.

**Response:**

```json
{
  "instance": {
    "id": 123,
    "name": "my-gpu",
    "status": "subscribed",
    "gpu_model": "NVIDIA L4",
    "vgpu_count": 1,
    "storage": {
      "ephemeral_gb": 50,
      "persistent_gb": 100
    },
    "connection": {
      "host": "35.190.160.152",
      "port": 30123,
      "username": "ubuntu"
    }
  }
}
```

#### Create Instance

```http
POST /api/v1/instances
```

Launch a new GPU instance.

**Request Body:**

```json
{
  "name": "my-new-gpu",
  "pool_id": "pool-123",
  "vgpus": 1,
  "instance_type_id": "type-medium",
  "ephemeral_storage_block_id": "storage-50",
  "persistent_storage_block_id": "storage-100"
}
```

**Response:**

```json
{
  "success": true,
  "instance": {
    "id": 124,
    "name": "my-new-gpu",
    "status": "subscribing"
  }
}
```

#### Restart Instance

```http
POST /api/v1/instances/:id/restart
```

Restart a running instance.

**Response:**

```json
{
  "success": true,
  "message": "Instance restarting"
}
```

#### Scale Instance

```http
POST /api/v1/instances/:id/scale
```

Change the number of GPUs.

**Request Body:**

```json
{
  "vgpus": 2
}
```

#### Delete Instance

```http
DELETE /api/v1/instances/:id
```

Terminate an instance.

**Response:**

```json
{
  "success": true,
  "message": "Instance terminated"
}
```

### Launch Options

#### Get Launch Options

```http
GET /api/v1/launch-options
```

Get available GPU pools, instance types, and storage options.

**Response:**

```json
{
  "pools": [
    {
      "id": "pool-123",
      "name": "NVIDIA L4",
      "gpu_model": "NVIDIA L4",
      "available_gpus": 10,
      "price_per_hour": 0.50
    }
  ],
  "instanceTypes": [
    {
      "id": "type-medium",
      "name": "Medium",
      "description": "16GB RAM, 4 vCPU"
    }
  ],
  "ephemeralStorageBlocks": [
    {
      "id": "storage-50",
      "name": "50GB SSD",
      "size_gb": 50
    }
  ],
  "persistentStorageBlocks": [
    {
      "id": "storage-100",
      "name": "100GB Persistent",
      "size_gb": 100,
      "price_per_hour": 0.02
    }
  ]
}
```

### SSH Keys

#### List SSH Keys

```http
GET /api/v1/ssh-keys
```

**Response:**

```json
{
  "keys": [
    {
      "id": "key-1",
      "name": "MacBook Pro",
      "fingerprint": "SHA256:abc123...",
      "created_at": "2024-01-10T08:00:00Z"
    }
  ]
}
```

#### Add SSH Key

```http
POST /api/v1/ssh-keys
```

**Request Body:**

```json
{
  "name": "Work Laptop",
  "public_key": "ssh-ed25519 AAAAC3NzaC1..."
}
```

#### Delete SSH Key

```http
DELETE /api/v1/ssh-keys/:id
```

### Account

#### Get Account Info

```http
GET /api/v1/account
```

**Response:**

```json
{
  "email": "user@example.com",
  "balance": 150.00,
  "currency": "USD",
  "subscription": {
    "plan": "pro",
    "status": "active"
  }
}
```

### Billing

#### Get Billing Stats

```http
GET /api/v1/billing
```

**Response:**

```json
{
  "current_period": {
    "start": "2024-01-01T00:00:00Z",
    "end": "2024-01-31T23:59:59Z",
    "usage": 45.50,
    "currency": "USD"
  },
  "balance": 150.00,
  "usage_by_resource": [
    {
      "type": "gpu",
      "amount": 40.00
    },
    {
      "type": "storage",
      "amount": 5.50
    }
  ]
}
```

### Services (Port Exposure)

#### List Exposed Services

```http
GET /api/v1/services?instanceId=123
```

**Response:**

```json
{
  "services": [
    {
      "id": "svc-1",
      "port": 8888,
      "protocol": "tcp",
      "public_url": "https://abc123.your-domain.com"
    }
  ]
}
```

#### Expose Service

```http
POST /api/v1/services
```

**Request Body:**

```json
{
  "instanceId": 123,
  "port": 8888,
  "protocol": "tcp"
}
```

## Error Responses

All errors follow this format:

```json
{
  "error": "Error message here",
  "code": "ERROR_CODE"
}
```

### HTTP Status Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 400 | Bad request - check your parameters |
| 401 | Unauthorized - invalid or missing API key |
| 403 | Forbidden - insufficient permissions |
| 404 | Not found - resource doesn't exist |
| 429 | Rate limited - too many requests |
| 500 | Server error - contact support |

## Rate Limits

- **100 requests per minute** per API key
- Exceeded limits return `429 Too Many Requests`

## Code Examples

### Python

```python
import requests

API_KEY = "your-api-key"
BASE_URL = "https://YOUR_DOMAIN/api/v1"

headers = {"X-API-Key": API_KEY}

# List instances
response = requests.get(f"{BASE_URL}/instances", headers=headers)
instances = response.json()["instances"]

# Create instance
new_instance = requests.post(
    f"{BASE_URL}/instances",
    headers=headers,
    json={
        "name": "my-gpu",
        "pool_id": "pool-123",
        "vgpus": 1
    }
)
```

### JavaScript/TypeScript

```typescript
const API_KEY = 'your-api-key';
const BASE_URL = 'https://YOUR_DOMAIN/api/v1';

async function listInstances() {
  const response = await fetch(`${BASE_URL}/instances`, {
    headers: { 'X-API-Key': API_KEY }
  });
  return response.json();
}

async function createInstance(name: string, poolId: string) {
  const response = await fetch(`${BASE_URL}/instances`, {
    method: 'POST',
    headers: {
      'X-API-Key': API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name,
      pool_id: poolId,
      vgpus: 1
    })
  });
  return response.json();
}
```

### cURL

```bash
# List instances
curl https://YOUR_DOMAIN/api/v1/instances \
  -H "X-API-Key: your-api-key"

# Create instance
curl -X POST https://YOUR_DOMAIN/api/v1/instances \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"name":"my-gpu","pool_id":"pool-123","vgpus":1}'

# Delete instance
curl -X DELETE https://YOUR_DOMAIN/api/v1/instances/123 \
  -H "X-API-Key: your-api-key"
```

## Webhooks (Coming Soon)

Receive notifications when instance status changes. Stay tuned for webhook support.

## Need Help?

Contact us at [support@example.com](mailto:support@example.com)
