# Service Exposure Quick Start Cheat Sheet

## 🚀 5-Minute Setup

### Step 1: Start Your Service
```bash
# Example: vLLM API
python -m vllm.entrypoints.openai.api_server \
  --model meta-llama/Llama-2-7b-hf \
  --host 0.0.0.0 \    # ← Must be 0.0.0.0, not localhost!
  --port 8000
```

### Step 2: Expose in Dashboard
1. Go to https://YOUR_DOMAIN/dashboard
2. Expand your GPU card
3. Scroll to **"Exposed Services"**
4. Click **"+ Expose Port"**
5. Fill in:
   - **Service Name**: `vllm-api`
   - **Port**: `8000`
   - **Protocol**: `TCP`
   - **Type**: `NodePort`
6. Click **"Expose Service"**

### Step 3: Use the URL
Copy the external URL and use it:
```bash
curl http://34.123.45.67:31234/v1/models
```

Done! 🎉

---

## 📋 Common Ports & Services

| Service | Port | Command |
|---------|------|---------|
| **vLLM** | 8000 | `python -m vllm.entrypoints.openai.api_server --host 0.0.0.0 --port 8000` |
| **Jupyter** | 8888 | `jupyter lab --ip=0.0.0.0 --port=8888 --no-browser` |
| **TensorBoard** | 6006 | `tensorboard --logdir=./logs --host=0.0.0.0 --port=6006` |
| **Gradio** | 7860 | `demo.launch(server_name="0.0.0.0", server_port=7860)` |
| **Streamlit** | 8501 | `streamlit run app.py --server.address=0.0.0.0 --server.port=8501` |
| **Ray Dashboard** | 8265 | `ray start --head --dashboard-host=0.0.0.0 --dashboard-port=8265` |
| **SSH** | 22 | Already running, just expose port 22 |
| **FastAPI** | 8080 | `uvicorn app:app --host=0.0.0.0 --port=8080` |

---

## ⚡ One-Liners

### Expose vLLM in 30 seconds
```bash
# In pod:
nohup python -m vllm.entrypoints.openai.api_server --model TinyLlama/TinyLlama-1.1B-Chat-v1.0 --host 0.0.0.0 --port 8000 > vllm.log 2>&1 &

# In dashboard: Expose port 8000
```

### Quick Jupyter Share
```bash
# Start Jupyter with token
jupyter lab --ip=0.0.0.0 --port=8888 --no-browser
# Copy the token from output
# Expose port 8888 in dashboard
# Share: http://YOUR-URL/lab?token=TOKEN
```

### Instant Gradio Demo
```python
# demo.py
import gradio as gr
gr.Interface(lambda x: f"You said: {x}", "text", "text").launch(
    server_name="0.0.0.0",
    server_port=7860
)
```
```bash
python demo.py
# Expose port 7860, share the URL
```

---

## 🛠️ NodePort vs LoadBalancer

| Feature | NodePort | LoadBalancer |
|---------|----------|--------------|
| **Cost** | Free | ~$15-30/month |
| **Setup Time** | Instant | 1-2 minutes |
| **URL Example** | `http://34.123.45.67:31234` | `http://35.123.45.67:8000` |
| **Port** | Random (30000-32767) | Your choice |
| **Best For** | Dev, testing, demos | Production, APIs |
| **Domain Support** | Harder | Easy |

**Rule of thumb**:
- 🧪 **Development/Testing** → NodePort
- 🚀 **Production/Public** → LoadBalancer

---

## ⚠️ Common Mistakes

### ❌ Wrong: Binding to localhost
```bash
# This won't work - external traffic can't reach it
python app.py --host 127.0.0.1 --port 8000
```

### ✅ Right: Binding to 0.0.0.0
```bash
# This works - listens on all interfaces
python app.py --host 0.0.0.0 --port 8000
```

### ❌ Wrong: Service not running
```bash
# Expose port 8000 but forgot to start the app
# Result: URL returns "Connection refused"
```

### ✅ Right: Start app first, then expose
```bash
# 1. Start service
python app.py &

# 2. Verify it's running
curl localhost:8000

# 3. Then expose in dashboard
```

---

## 🔧 Troubleshooting

| Problem | Solution |
|---------|----------|
| **URL times out** | Check app is running: `ps aux \| grep python` |
| **Connection refused** | App must bind to `0.0.0.0`, not `localhost` |
| **Wrong port** | Check with: `netstat -tlnp \| grep 8000` |
| **Service not listed** | Refresh dashboard, wait 30 seconds |
| **Can't delete service** | Check you're clicking the trash icon on the right service |

### Quick Debug Commands
```bash
# Check what's listening on port 8000
lsof -i :8000

# Check if service is accessible locally
curl localhost:8000

# Check network bindings
netstat -tlnp | grep 8000

# View app logs
tail -f app.log
```

---

## 🔐 Security Checklist

- [ ] Use API keys for production services
- [ ] Don't expose admin panels without auth
- [ ] Use tokens for Jupyter notebooks
- [ ] Consider LoadBalancer + HTTPS for public APIs
- [ ] Delete services when done
- [ ] Don't hardcode secrets in exposed services

### Secure vLLM Example
```bash
# Generate API key
API_KEY=$(openssl rand -hex 32)
echo "Save this: $API_KEY"

# Start with auth
python -m vllm.entrypoints.openai.api_server \
  --model meta-llama/Llama-2-7b-hf \
  --host 0.0.0.0 \
  --port 8000 \
  --api-key $API_KEY

# Clients must use:
curl http://URL/v1/models -H "Authorization: Bearer $API_KEY"
```

---

## 📱 Mobile Quick Reference

### To Expose a Service:
1. Dashboard → GPU card
2. Expand card
3. "Exposed Services" section
4. "+ Expose Port" button
5. Fill form → Expose

### To Delete a Service:
1. Find service in list
2. Click trash icon 🗑️
3. Confirm

### To Edit a Service:
1. Find service in list
2. Click pencil icon ✏️
3. Modify fields
4. Click "Update Service"

---

## 🎯 Use Case → Command

### "I want to share my model API"
```bash
# vLLM
python -m vllm.entrypoints.openai.api_server --host 0.0.0.0 --port 8000
# Expose: port 8000, LoadBalancer (production) or NodePort (dev)
```

### "Team needs to see TensorBoard"
```bash
tensorboard --logdir=./logs --host=0.0.0.0 --port=6006
# Expose: port 6006, NodePort
```

### "Demo for investors"
```python
# Gradio in demo.py
import gradio as gr
demo = gr.Interface(your_function, inputs, outputs)
demo.launch(server_name="0.0.0.0", server_port=7860)
```
```bash
python demo.py
# Expose: port 7860, NodePort
```

### "Collaborate on Jupyter notebook"
```bash
jupyter lab --ip=0.0.0.0 --port=8888 --no-browser
# Expose: port 8888, NodePort
# Share the token from output
```

### "Production API for customers"
```bash
# FastAPI/Flask/Django with gunicorn
gunicorn app:app --bind 0.0.0.0:8080 --workers 4
# Expose: port 8080, LoadBalancer
# Add domain: api.yourcompany.com
```

---

## 💡 Pro Tips

1. **Name services clearly**: Use descriptive names like `llama-70b-api`, not `service1`

2. **Test locally first**: Always `curl localhost:8000` before exposing

3. **Use LoadBalancer for production**: Worth the $20/month for reliability

4. **Monitor your services**: Add health check endpoints like `/health`

5. **Clean up unused services**: Delete when you terminate experiments

6. **Document your APIs**: Add OpenAPI/Swagger docs for team use

7. **Use environment variables**: Don't hardcode IPs
   ```bash
   export VLLM_URL="http://34.123.45.67:31234"
   curl $VLLM_URL/v1/models
   ```

8. **Set up alerts**: Monitor if services go down
   ```bash
   # Simple uptime check
   while true; do
     curl -f $URL/health || echo "Service down!"
     sleep 60
   done
   ```

---

## 📚 Learn More

- **Full Documentation**: `/docs/service-exposure.md`
- **Use Cases**: `/docs/service-exposure-use-cases.md`
- **API Reference**: See "API Reference" section in main docs
- **Support**: https://YOUR_DOMAIN/support

---

## 🎓 3-Minute Video Tutorial

**Coming soon**: Watch a live walkthrough at https://YOUR_DOMAIN/tutorials/service-exposure

---

**Last Updated**: January 2025 | **Version**: 1.0
