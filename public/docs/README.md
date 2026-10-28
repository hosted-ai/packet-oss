# Packet.ai Documentation

Welcome to the Packet.ai documentation! This guide covers all features for deploying and managing AI models on GPU infrastructure.

## 📚 Documentation Index

---

## 🌐 Service Exposure

### 1. [Service Exposure - Complete Guide](./service-exposure.md)

**📘 Start here for comprehensive documentation**

The complete guide covers everything you need to know about exposing ports and services from your GPU instances:

- What is Service Exposure?
- Common use cases (vLLM, Jupyter, TensorBoard, Gradio, etc.)
- Step-by-step tutorials
- Service types (HTTP, HTTPS, raw TCP, UDP)
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

## 🤖 AI Inference Features

### 5. [Inference Playground](./inference-playground.md)

**🎮 Interactive chat interface for testing models**

Test and experiment with your deployed models without writing code:

- Real-time streaming chat interface
- Automatic model detection — zero configuration
- Multi-turn conversation support
- Performance stats (latency, tokens/sec, token count)

**Recommended for**: Testing models, prompt engineering, demos

---

### 6. [GPU Metrics Dashboard](./gpu-metrics.md)

**📊 Real-time GPU monitoring and analytics**

Monitor your GPU instances for optimal performance:

- GPU utilization, memory, temperature tracking
- Inference metrics (tokens/sec, queue depth)
- Historical data and trend analysis
- Prometheus integration
- Automatic storage alerts

**Recommended for**: DevOps, performance optimization, capacity planning

---

### 7. [Token Usage Dashboard](./token-usage.md)

**📈 Track and analyze token consumption**

Comprehensive analytics on your AI model usage:

- Prompt and generation token tracking
- Usage by instance and time period
- Cost estimation
- Export reports as CSV (JSON via the API)
- Spend-based budget alerts

**Recommended for**: Cost management, usage analytics, billing

---

### 8. [Pro 6000 Blackwell Optimized Models](./pro-6000-blackwell.md)

**⚡ One-click deploy for 96GB VRAM GPUs**

Pre-configured templates for NVIDIA Pro 6000 Blackwell:

- 70B+ parameter models (Llama 3.1, Qwen 2.5, DeepSeek)
- AWQ/GPTQ quantized models for efficiency
- Optimal vLLM configurations
- Performance benchmarks
- Deployment commands and troubleshooting

**Recommended for**: Quick deployment of large language models

---

## 🚀 Quick Links

- **Live Documentation Site**: https://dash.packet.ai/docs
- **Dashboard**: https://dash.packet.ai
- **Support**: help@packet.ai

---

## 🎯 Quick Navigation by Task

### I want to...

#### ...deploy a model quickly

→ Start with [Pro 6000 Blackwell Templates](./pro-6000-blackwell.md)

#### ...test my model with a chat interface

→ Use the [Inference Playground](./inference-playground.md)

#### ...integrate my model into an application

→ Expose your model's API with [Service Exposure](./service-exposure.md)

#### ...monitor my GPU performance

→ Check the [GPU Metrics Dashboard](./gpu-metrics.md)

#### ...track token usage and costs

→ See the [Token Usage Dashboard](./token-usage.md)

#### ...expose my first service

→ Start with [Quick Start Guide](./service-exposure-quickstart.md)

#### ...understand what Service Exposure is

→ Read [Complete Guide - Overview](./service-exposure.md#overview)

#### ...see real examples

→ Check [Use Cases](./service-exposure-use-cases.md)

#### ...deploy a vLLM API

→ See [Complete Guide - vLLM Example](./service-exposure.md#example-1-exposing-vllm-api)

#### ...troubleshoot a problem

→ See [Complete Guide - Troubleshooting](./service-exposure.md#troubleshooting)

#### ...use the API programmatically

→ See [Complete Guide - API Reference](./service-exposure.md#api-reference)

#### ...understand the architecture

→ Read [Architecture Diagrams](./service-exposure-architecture.md)

---

## 📖 Documentation Structure

```
docs/
├── README.md (this file)
│
├── # Service Exposure
├── service-exposure.md (Complete guide)
├── service-exposure-quickstart.md (Quick start)
├── service-exposure-use-cases.md (Use cases)
├── service-exposure-architecture.md (Architecture)
│
├── # AI Inference Features
├── inference-playground.md (Interactive chat testing)
├── gpu-metrics.md (GPU monitoring dashboard)
├── token-usage.md (Token analytics)
├── pro-6000-blackwell.md (Pro 6000 Blackwell templates)
│
├── # Advanced Topics
├── vllm-multi-gpu-scaling.md (Multi-GPU scaling)
└── persistent-storage.md (Storage)
```

---

## 🆕 What's New

### January 2025

- ⚡ **Pro 6000 Blackwell support** - Deploy 70B+ models on 96GB GPUs
- 🎮 **Inference Playground** - Interactive model testing
- 📊 **GPU Metrics Dashboard** - Real-time GPU monitoring
- 📈 **Token Usage Dashboard** - Comprehensive usage analytics
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
3. Or contact us at help@packet.ai

---

## 📝 License

Documentation © 2025 Packet.ai. All rights reserved.

---

## 🔗 Related Documentation

- [vLLM Multi-GPU Scaling](./vllm-multi-gpu-scaling.md)
- [Persistent Storage](./persistent-storage.md)

---

**Last Updated**: July 2026
**Version**: 2.1
**Maintained by**: Packet.ai Team
