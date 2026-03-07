# GPU Cloud Documentation

Welcome to the GPU Cloud documentation for Service Exposure!

## 📚 Documentation Index

### 1. [Service Exposure - Complete Guide](./service-exposure.md)
**📘 Start here for comprehensive documentation**

The complete guide covers everything you need to know about exposing ports and services from your GPU instances:
- What is Service Exposure?
- Common use cases (vLLM, Jupyter, TensorBoard, Gradio, etc.)
- Step-by-step tutorials
- NodePort vs LoadBalancer comparison
- Security best practices
- Troubleshooting guide
- Full API reference

**Recommended for**: Everyone, especially first-time users

---

### 2. [Quick Start Guide](./service-exposure-quickstart.md)
**⚡ Get started in 5 minutes**

A one-page cheat sheet with:
- 5-minute setup guide
- Common ports and commands
- One-liner examples
- Quick troubleshooting
- Pro tips

**Recommended for**: Developers who want to get started quickly

---

### 3. [Real-World Use Cases](./service-exposure-use-cases.md)
**💡 Practical examples and scenarios**

Real-world scenarios showing when and why to use Service Exposure:
- Building AI-powered web applications
- Team collaboration and demos
- Production API deployment
- Development workflows
- Decision trees
- Cost-benefit analysis

**Recommended for**: Understanding the "why" and "when"

---

### 4. [Architecture & Diagrams](./service-exposure-architecture.md)
**🏗️ Technical deep-dive**

System architecture and technical details:
- High-level architecture diagrams
- Network traffic flow
- Component architecture
- Data flow diagrams
- Security architecture
- State management

**Recommended for**: Developers building integrations or understanding the system

---

## 🚀 Quick Links

- **Live Documentation Site**: https://example.com/docs
- **Dashboard**: https://example.com/dashboard
- **Support**: https://github.com/your-org/support
- **Contact**: support@example.com

---

## 🎯 Quick Navigation by Task

### I want to...

#### ...expose my first service
→ Start with [Quick Start Guide](./service-exposure-quickstart.md)

#### ...understand what Service Exposure is
→ Read [Complete Guide - Overview](./service-exposure.md#overview)

#### ...see real examples
→ Check [Use Cases](./service-exposure-use-cases.md)

#### ...deploy a vLLM API
→ See [Complete Guide - vLLM Example](./service-exposure.md#example-1-exposing-vllm-api)

#### ...share Jupyter with my team
→ See [Use Cases - Team Collaboration](./service-exposure-use-cases.md#scenario-4-remote-team-collaboration-on-notebooks)

#### ...build a production API
→ See [Use Cases - Production API](./service-exposure-use-cases.md#scenario-6-customer-facing-api-production)

#### ...troubleshoot a problem
→ See [Complete Guide - Troubleshooting](./service-exposure.md#troubleshooting)

#### ...use the API programmatically
→ See [Complete Guide - API Reference](./service-exposure.md#api-reference)

#### ...store data that survives restarts
→ See [Persistent Storage Guide](./persistent-storage.md)

#### ...understand the architecture
→ Read [Architecture Diagrams](./service-exposure-architecture.md)

---

## 📖 Documentation Structure

```
docs/
├── README.md (this file)
├── persistent-storage.md (Persistent storage for GPU pods)
├── service-exposure.md (Complete guide - start here)
├── service-exposure-quickstart.md (1-page cheat sheet)
├── service-exposure-use-cases.md (Real-world examples)
└── service-exposure-architecture.md (Technical diagrams)
```

---

## 🆕 What's New

### January 2025
- 💾 **Persistent Storage** - Store data that survives pod restarts, reimaging, and scaling
- ✨ Service Exposure feature launched
- 📘 Complete documentation suite created
- 🎨 Documentation website at /docs
- 📊 Architecture diagrams added
- 💡 10+ real-world use cases documented

---

## 🤝 Contributing

Found a typo or want to improve the docs?

1. Edit the markdown files in `/docs`
2. Submit a pull request
3. Or contact us at support@example.com

---

## 📝 License

Documentation © 2025 GPU Cloud. All rights reserved.

---

## 🔗 Related Documentation

- [Persistent Storage Guide](./persistent-storage.md) - **NEW!** Store data that survives restarts
- [vLLM Multi-GPU Scaling](./vllm-multi-gpu-scaling.md)
- [Ray Cluster Management](./ray-cluster-management.md)

---

**Last Updated**: January 2025
**Version**: 1.0
**Maintained by**: GPU Cloud Team
