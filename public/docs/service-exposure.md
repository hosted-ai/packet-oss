# Service Exposure Guide

## Overview

The Service Exposure feature allows you to expose network ports from your GPU instances to the internet, making services running on your pods accessible via public URLs. This eliminates the need for SSH tunneling and provides a professional way to access web UIs, APIs, and other services.

## Table of Contents

- [What is Service Exposure?](#what-is-service-exposure)
- [Common Use Cases](#common-use-cases)
- [How to Access](#how-to-access)
- [Exposing a Service](#exposing-a-service)
- [Managing Services](#managing-services)
- [Service Types](#service-types)
- [Best Practices](#best-practices)
- [Troubleshooting](#troubleshooting)
- [API Reference](#api-reference)

## What is Service Exposure?

Service Exposure creates a Kubernetes Service resource that routes external traffic to a specific port on your GPU pod. When you expose a service, the system:

1. Creates a Kubernetes Service for your pod
2. Assigns an external IP address and port (the external port is chosen by the platform)
3. Routes traffic from the internet to your pod
4. Provides you with a public URL to access the service

## Common Use Cases

### 1. **vLLM API Server**
Expose your vLLM OpenAI-compatible API server to access it from external applications.

- **Port**: `8000`
- **Protocol**: `TCP`
- **Service Type**: `HTTP`
- **Example URL**: `http://34.123.45.67:31234`

```bash
# In your pod, vLLM runs on:
python -m vllm.entrypoints.openai.api_server --host 0.0.0.0 --port 8000
```

### 2. **Jupyter Notebook**
Access Jupyter Lab or Notebook interfaces remotely without SSH tunneling.

- **Port**: `8888`
- **Protocol**: `TCP`
- **Service Type**: `HTTP`
- **Example URL**: `http://34.123.45.67:32567`

### 3. **TensorBoard**
Monitor training metrics and visualizations in real-time.

- **Port**: `6006`
- **Protocol**: `TCP`
- **Service Type**: `HTTP`
- **Example URL**: `http://34.123.45.67:30123`

### 4. **Custom Web UIs**
Expose Gradio, Streamlit, or custom web applications.

- **Port**: Varies (commonly `7860` for Gradio, `8501` for Streamlit)
- **Protocol**: `TCP`
- **Service Type**: `HTTP`

### 5. **SSH Access**
Expose SSH on a custom port for easier access.

- **Port**: `22`
- **Protocol**: `TCP`
- **Service Type**: `Raw TCP (no prefix)`

### 6. **Ray Dashboard**
Access Ray cluster monitoring dashboard.

- **Port**: `8265`
- **Protocol**: `TCP`
- **Service Type**: `HTTP`

## How to Access

The Service Exposure feature is integrated into your GPU instance cards (the section is shown while the instance is active):

1. **Navigate** to https://dash.packet.ai/dashboard
2. **Find** your active GPU instance in the list
3. **Click** on the GPU card to expand it
4. **Scroll** down to the "Exposed Services" section (below SSH connection info, above HuggingFace deployments)

You'll see:
- A globe icon 🌐 with "Exposed Services" header
- A **"+ Expose Port"** button in indigo color
- List of currently exposed services (if any)

**Note**: The "+ Expose Port" and delete controls are only shown to team members whose role allows provisioning GPUs. Read-only members can view the list without controls.

## Exposing a Service

### Step-by-Step Guide

#### 1. Start Your Application
First, ensure your service is running inside the pod and listening on the desired port:

```bash
# Example: Start vLLM API server
python -m vllm.entrypoints.openai.api_server \
  --model meta-llama/Llama-2-7b-hf \
  --host 0.0.0.0 \
  --port 8000
```

**Important**: Always bind to `0.0.0.0` (all interfaces), not `localhost` or `127.0.0.1`, otherwise external traffic won't reach your service.

#### 2. Click "Expose Port"
In the Exposed Services section of your GPU card, click the **"+ Expose Port"** button.

#### 3. Fill in Service Details

A form will appear with the following fields:

| Field | Description | Example |
|-------|-------------|---------|
| **Service Name** | A friendly name for your service (lowercase, no spaces) | `vllm-api` |
| **Port** | The port number your application is listening on | `8000` |
| **Protocol** | TCP (default, for HTTP/HTTPS and raw TCP services) or UDP | `TCP` |
| **Service Type** | For TCP: HTTP (default), HTTPS, or Raw TCP (no prefix). For UDP: NodePort or LoadBalancer | `HTTP` |

#### 4. Click "Expose Service"

The system will:
- Create the Kubernetes Service
- Allocate an external IP and port
- Provide you with the public URL

#### 5. Access Your Service

Once exposed, you'll see the service listed with:
- Service name, type badge, and status badge
- The port mapping (internal port → external port)
- **External URL** - with a copy button to copy it to your clipboard

Example URL: `http://34.123.45.67:31234`

## Managing Services

### Viewing Exposed Services

All exposed services are listed in the "Exposed Services" section of your GPU card. Each service shows:

- **Name**: Your chosen service name
- **Type**: Service type badge (http, https, none/raw TCP, NodePort, or loadbalancer)
- **Status**: Provisioning state reported by the platform
- **Port**: Internal port → external port mapping
- **External URL**: Public URL to access the service (if available), with a copy button

### Editing a Service

Editing an existing service is not currently available in the dashboard. To change a service's name, port, protocol, or type, delete it and expose it again — or use the [API](#api-reference) (`PUT /api/services`).

**Note**: Re-creating a service may result in a new external IP/port being assigned.

### Deleting a Service

1. Click the **trash icon** 🗑️ next to the service
2. Confirm the deletion
3. The service will be removed and the external URL will stop working

**Warning**: This action cannot be undone. External clients will lose access immediately.

## Service Types

The available service types depend on the protocol you select in the form.

### TCP Service Types

For TCP, the service type tells the platform what kind of service is behind the port and how to present its external URL:

- **HTTP** (default): For web UIs and REST APIs. The external URL is shown as `http://<ip>:<port>`, e.g. `http://34.123.45.67:31234`.
- **HTTPS**: For services that serve TLS themselves. The external URL is shown as `https://<ip>:<port>`.
- **Raw TCP (no prefix)**: For non-HTTP TCP services such as SSH, databases, or gRPC. The address is shown as `<ip>:<port>` without a URL scheme.

### UDP Service Types

For UDP, the service type selects the Kubernetes service used to route traffic:

- **NodePort**: Exposes the service on a platform-assigned external port on the node's IP address.
- **LoadBalancer**: Routes the UDP service through a load balancer.

**Note**: In all cases the external port is assigned by the platform when the service is created — you cannot choose it, and it may change if the service is recreated.

## Best Practices

### Security

1. **Don't expose sensitive services** without authentication
   - Always use authentication for Jupyter, SSH, admin panels
   - Consider using tokens, passwords, or API keys

2. **Use HTTPS when possible**
   - For production, set up SSL/TLS certificates
   - Use the HTTPS service type for services that serve TLS

3. **Limit exposed ports**
   - Only expose ports you actively need
   - Delete services when no longer needed

4. **Monitor access logs**
   - Check your application logs for suspicious activity
   - Consider implementing rate limiting

### Performance

1. **Choose the right service type**
   - HTTP/HTTPS: Web UIs and APIs
   - Raw TCP: SSH, gRPC, databases, and other non-HTTP protocols
   - NodePort/LoadBalancer: UDP services

2. **Use TCP for most services**
   - HTTP/HTTPS APIs: TCP
   - SSH: TCP
   - gRPC: TCP
   - Use UDP only for specific protocols (QUIC, DNS, game servers)

### Naming

1. **Use descriptive service names**
   - ✅ Good: `vllm-llama2-api`, `jupyter-main`, `tensorboard-training`
   - ❌ Bad: `service1`, `test`, `api`

2. **Follow naming conventions**
   - Lowercase only
   - Use hyphens, not spaces or underscores
   - Keep it short but meaningful

### Maintenance

1. **Document your services**
   - Keep track of which ports are exposed and why
   - Document access credentials separately

2. **Clean up unused services**
   - Delete services when you terminate experiments
   - Avoid accumulating unused exposed ports

3. **Test after changes**
   - Always verify the external URL works after creation
   - Test authentication and connectivity

## Troubleshooting

### Service not accessible

**Symptom**: External URL doesn't respond or times out.

**Possible causes**:

1. **Application not listening on 0.0.0.0**
   ```bash
   # ❌ Wrong - only localhost can connect
   python app.py --host 127.0.0.1 --port 8000

   # ✅ Correct - external traffic can connect
   python app.py --host 0.0.0.0 --port 8000
   ```

2. **Application not running**
   - Check if your process is still running: `ps aux | grep python`
   - Check application logs for errors

3. **Wrong port number**
   - Verify the port in the service matches your application
   - Use `netstat -tlnp | grep 8000` to confirm what's listening

4. **Firewall blocking traffic**
   - Most hosted.ai images have permissive firewalls
   - Check with: `iptables -L`

5. **Service still provisioning**
   - Wait 30-60 seconds after creation
   - Refresh the page to see updated status

### Port already in use

**Symptom**: Error when starting your application: "Address already in use"

**Solution**:
```bash
# Find what's using the port
lsof -i :8000

# Kill the process
kill -9 <PID>

# Or use a different port
python app.py --port 8001
```

### External URL changed

**Symptom**: Saved URL no longer works after recreating service.

**Cause**: External ports are assigned by the platform. Each recreation may get a new port.

**Solutions**:
1. Always check the current URL in the dashboard
2. Don't hardcode exposed-service URLs in production — keep them in configuration

### Permission denied

**Symptom**: Can't bind to port < 1024 (e.g., port 80, 443)

**Cause**: Low ports require root privileges.

**Solutions**:
```bash
# Run with sudo
sudo python app.py --port 80

# Or use a high port and expose it
python app.py --port 8080
# Then expose port 8080 via the dashboard
```

### Authentication issues

**Symptom**: Service accessible but can't authenticate (Jupyter, vLLM, etc.)

**Solutions**:

1. **Jupyter**: Check token in logs
   ```bash
   jupyter notebook list
   # Look for: http://localhost:8888/?token=abc123...
   ```

2. **vLLM**: Some clients require API keys
   ```bash
   python -m vllm.entrypoints.openai.api_server \
     --api-key your-secret-key
   ```

3. **SSH**: Use password or key-based auth as usual
   ```bash
   ssh -p 31234 ubuntu@34.123.45.67
   ```

## API Reference

For developers building integrations or automation, the Service Exposure feature is available via REST API.

### Authentication

All endpoints require JWT authentication:

```bash
curl https://dash.packet.ai/api/services \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

Viewing services requires GPU access on your team; exposing, updating, and deleting services requires a role with GPU provisioning permission.

### Endpoints

#### List Exposed Services

```http
GET /api/services?instanceId={instance_id}
```

`instanceId` is your instance's ID — either a unified instance ID (`i-...`) or a legacy numeric subscription ID.

**Response**:
```json
{
  "services": [
    {
      "id": 123,
      "service_name": "vllm-api",
      "ip": "34.123.45.67",
      "internal_port": 8000,
      "external_port": 31234,
      "protocol": "TCP",
      "type": "http",
      "status": "ready"
    }
  ]
}
```

#### Expose New Service

```http
POST /api/services
Content-Type: application/json

{
  "pod_name": "gpu-pool-abc123-0",
  "pool_subscription_id": 456,
  "port": 8000,
  "service_name": "vllm-api",
  "protocol": "TCP",
  "service_type": "http"
}
```

All fields are required. For unified instances, pass the instance ID (`i-...`) as `pool_subscription_id`. `protocol` is `TCP` or `UDP`. `service_type` accepts `http`, `https`, or `none` (raw TCP) when the protocol is TCP, and `NodePort` or `loadbalancer` when the protocol is UDP; unrecognised values are normalised to the default for the protocol.

**Response**:
```json
{
  "service": {
    "id": 123,
    "pod_name": "gpu-pool-abc123-0",
    "service_name": "vllm-api",
    "ip": "34.123.45.67",
    "node_port": 31234,
    "pod_port": 8000,
    "protocol": "TCP",
    "service_type": "http",
    "status": "ready"
  }
}
```

If a service with the same name already exists, the endpoint returns `409` with `code: "SERVICE_EXISTS"`.

#### Update Service

```http
PUT /api/services
Content-Type: application/json

{
  "id": 123,
  "service_name": "vllm-api-v2",
  "port": 8001,
  "protocol": "TCP",
  "service_type": "http"
}
```

`id` is required; the other fields are optional. Changing the port or type may result in a new external port being assigned.

#### Delete Service

```http
DELETE /api/services?id=123
```

**Response**: the deleted service record:
```json
{
  "service": {
    "id": 123,
    "service_name": "vllm-api",
    "...": "..."
  }
}
```

#### Check Service Status

```http
GET /api/services/status?serviceName=vllm-api&poolSubscriptionId=456&operationId=op_789
```

`serviceName` and `poolSubscriptionId` are required; `operationId` is optional.

**Response**:
```json
{
  "status": {
    "status": "completed",
    "message": "...",
    "service_name": "vllm-api",
    "service_ip": "34.123.45.67",
    "node_port": 31234,
    "pod_port": 8000,
    "protocol": "TCP",
    "service_type": "http",
    "service_exists": true,
    "kubernetes_active": true
  }
}
```

### Service Lifecycle

Status values are reported by the platform. A service is healthy when its status is `ready`, `active`, or `EXPOSED` (shown with a green badge in the dashboard); other values mean the service is still provisioning or has failed.

Poll the `/api/services/status` endpoint to track provisioning progress — `service_exists` and `kubernetes_active` in the response confirm that the underlying Kubernetes service is live. Alternatively, re-fetch `GET /api/services` (this is what the dashboard does) until the service appears with an IP and external port.

## Examples

### Example 1: Exposing vLLM API

```bash
# 1. SSH into your GPU instance
ssh ubuntu@your-gpu-ip -p port

# 2. Start vLLM server
cd ~/hf-workspace
source venv/bin/activate
python -m vllm.entrypoints.openai.api_server \
  --model meta-llama/Llama-2-7b-chat-hf \
  --host 0.0.0.0 \
  --port 8000 \
  --tensor-parallel-size 1

# 3. In the dashboard:
# - Service Name: llama2-chat-api
# - Port: 8000
# - Protocol: TCP
# - Service Type: HTTP

# 4. Test the API
curl http://34.123.45.67:31234/v1/models
```

### Example 2: Jupyter Notebook with Token

```bash
# 1. Start Jupyter in the pod
jupyter lab --ip=0.0.0.0 --port=8888 --no-browser

# 2. Copy the token from the output:
#    http://0.0.0.0:8888/lab?token=abc123def456...

# 3. Expose the service:
# - Service Name: jupyter-lab
# - Port: 8888
# - Protocol: TCP
# - Service Type: HTTP

# 4. Access via browser:
#    http://34.123.45.67:32567/lab?token=abc123def456...
```

### Example 3: Gradio Web UI

```bash
# 1. Create a Gradio app
cat > app.py << 'EOF'
import gradio as gr

def greet(name):
    return f"Hello {name}!"

demo = gr.Interface(fn=greet, inputs="text", outputs="text")
demo.launch(server_name="0.0.0.0", server_port=7860)
EOF

# 2. Run the app
python app.py

# 3. Expose the service:
# - Service Name: gradio-demo
# - Port: 7860
# - Protocol: TCP
# - Service Type: HTTP

# 4. Share the URL with your team:
#    http://34.123.45.67:30789
```

### Example 4: Multiple Services on One Pod

You can expose multiple ports from the same pod:

```bash
# Pod is running:
# - vLLM API on port 8000
# - TensorBoard on port 6006
# - Custom metrics API on port 9090

# Expose all three:
# Service 1: vllm-api, port 8000, TCP, HTTP
# Service 2: tensorboard, port 6006, TCP, HTTP
# Service 3: metrics-api, port 9090, TCP, HTTP

# Results:
# - vLLM: http://34.123.45.67:31234
# - TensorBoard: http://34.123.45.67:31235
# - Metrics: http://34.123.45.67:31236
```

## Advanced Scenarios

### Using with API Keys

For production vLLM deployments with API key authentication:

```bash
# 1. Generate a secure API key
API_KEY=$(openssl rand -hex 32)
echo "API Key: $API_KEY"  # Save this securely!

# 2. Start vLLM with API key
python -m vllm.entrypoints.openai.api_server \
  --model meta-llama/Llama-2-70b-chat-hf \
  --host 0.0.0.0 \
  --port 8000 \
  --api-key $API_KEY

# 3. Expose the API
# - Service Name: llama2-70b-production
# - Port: 8000
# - Protocol: TCP
# - Service Type: HTTP

# 4. Clients authenticate with:
curl http://34.123.45.67:31234/v1/completions \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "meta-llama/Llama-2-70b-chat-hf",
    "prompt": "Hello, how are you?",
    "max_tokens": 100
  }'
```

### SSL/TLS Termination

For HTTPS support:

```bash
# 1. Install certbot in your pod
sudo apt-get update
sudo apt-get install -y certbot

# 2. Get SSL certificate (requires domain name)
sudo certbot certonly --standalone -d your-domain.com

# 3. Configure your app to use SSL
# (Application-specific, varies by framework)

# 4. Expose the service
# - Service Name: api-ssl
# - Port: 443
# - Protocol: TCP
# - Service Type: HTTPS
```

### Health Checks

Implement health check endpoints for better monitoring:

```python
from fastapi import FastAPI

app = FastAPI()

@app.get("/health")
def health_check():
    return {"status": "healthy", "service": "vllm-api"}

@app.get("/v1/models")
def list_models():
    # Your actual API logic
    pass
```

Then monitor:
```bash
curl http://34.123.45.67:31234/health
```

## FAQ

### Q: Can I use custom domain names?

**A**: Yes, but you'll need to configure DNS separately:

1. Get the external IP from the exposed service
2. Create an A record in your DNS provider: `api.yourdomain.com → 34.123.45.67`
3. For SSL, use Let's Encrypt with certbot

### Q: How many services can I expose per pod?

**A**: No hard limit. You can expose as many ports as your pod has services running on. However:
- Each service consumes cluster resources
- External ports are assigned from a limited platform range
- Be mindful of network bandwidth

### Q: What happens when I restart my pod?

**A**:
- Exposed services **persist** across pod restarts
- The external URL remains the same
- Your applications will need to be restarted manually inside the new pod
- Re-expose services if the pod name changes

### Q: Can I change the external port number?

**A**: No — the external port is assigned by the platform when the service is created and cannot be customised. Keep the current URL in configuration rather than hardcoding it.

### Q: Is there a cost for exposing services?

**A**: No — there is no separate charge in your dashboard billing for exposing services.

### Q: Can I expose UDP services?

**A**: Yes! Select "UDP" in the protocol dropdown, then choose NodePort or LoadBalancer as the service type. Common uses:
- Game servers
- VoIP applications
- Custom real-time protocols
- DNS servers

### Q: How do I expose SSH on a custom port?

**A**:
1. Expose port 22 with protocol TCP and service type Raw TCP (no prefix)
2. Connect with: `ssh -p 31234 ubuntu@34.123.45.67`
3. Or change SSH to listen on a different port in `/etc/ssh/sshd_config`

### Q: What if I delete a service by mistake?

**A**:
- The service is permanently deleted
- The external URL will stop working immediately
- You can re-create it, but you'll get a new URL
- Always double-check before deleting production services

---

## Support

If you encounter issues or have questions:

- Check the [Troubleshooting](#troubleshooting) section above
- Review application logs in your pod
- Contact support via the Support tab in the dashboard

---

**Last updated**: July 2026
**Version**: 1.1
