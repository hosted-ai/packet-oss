# Inference Playground

## Overview

The Inference Playground is an interactive web-based interface for testing and experimenting with your deployed AI models. It provides a real-time chat interface with streaming responses, allowing you to quickly validate model behavior, test prompts, and demonstrate capabilities without writing any code.

### Key Features

- **Real-time Streaming**: See model responses token-by-token as they generate
- **Zero Configuration**: The playground automatically detects the model running on your instance
- **Conversation History**: Maintain context across multiple turns
- **Performance Stats**: Latency, generation speed, and token count shown after each response

---

## 🚀 Getting Started

### Prerequisites

The playground works with GPU instances running a Hugging Face model deployment:

1. **A running model**: your instance's model deployment shows the **running** status
2. **Port 8000 exposed**: the playground reaches your model through the instance's exposed vLLM API service. If port 8000 is not yet exposed, the instance card shows an **"Expose API Endpoint"** button instead — click it first. See [Service Exposure](./service-exposure.md) for details.

### Accessing the Playground

1. Navigate to your Packet.ai Dashboard
2. Expand the GPU instance card that has your deployed model
3. In the model deployment section, click the **"Test Chat"** button
4. The playground opens automatically with your model — no model selection needed

### First Conversation

1. **Enter a message** in the text input at the bottom
2. **Press Enter** or click the send button
3. **Watch** the response stream in real-time
4. **Continue** the conversation with follow-up messages

---

## 🎛️ Interface Components

### Chat Area

The main conversation display showing:
- **User Messages**: Your inputs (right-aligned, blue background)
- **Assistant Messages**: Model responses (left-aligned, gray background)
- **Typing Indicator**: Animated dots while the model begins generating

### Input Area

At the bottom of the window:
- **Message Input**: Multi-line text field for your prompts (Enter to send, Shift+Enter for a new line)
- **Send Button**: Submit the message

In the header:
- **Clear Button**: Start a new conversation

### Performance Stats

After each response, a stats bar shows:

| Stat | Description |
|------|-------------|
| **Latency** | Total time taken for the response (ms) |
| **Speed** | Generation speed in tokens per second |
| **Tokens** | Number of tokens in the response |

---

## ⚙️ Configuration Options

The playground is intentionally simple — it uses fixed generation settings so you can test a deployed model with zero setup:

- **Model**: detected automatically from your instance (the model currently loaded in vLLM)
- **Max response length**: capped at 2,048 tokens per response
- **Sampling parameters** (temperature, top_p, etc.): your model server's defaults

If you need control over temperature, max tokens, system prompts, or other generation parameters, call your instance's exposed vLLM OpenAI-compatible API directly instead — see [Service Exposure](./service-exposure.md) for how to expose and connect to it.

---

## 💬 Conversation Patterns

### Single-Turn Q&A

Best for:
- Quick factual questions
- Simple tasks
- One-off queries

```
User: What is the capital of Japan?
Assistant: The capital of Japan is Tokyo.
```

### Multi-Turn Conversations

Best for:
- Complex problem-solving
- Iterative refinement
- Context-dependent tasks

```
User: I'm building a web app. What tech stack should I use?
Assistant: For a modern web app, I'd recommend...

User: I have experience with Python. How does that change your recommendation?
Assistant: Great! With Python experience, I'd suggest...

User: What about the database?
Assistant: For your Python-based stack, consider...
```

### Chain-of-Thought Prompting

For complex reasoning, ask the model to show its working as part of your message:

```
User: Think through this step by step before giving the final answer.
A farmer has 17 sheep. All but 9 run away. How many are left?

Assistant: Let's work through it. "All but 9 run away" means 9 sheep
did not run away. Final answer: 9 sheep are left.
```

---

## 🛠️ Troubleshooting

| Message | What it means | Fix |
|---------|---------------|-----|
| "vLLM service not exposed yet. Click 'Expose API Endpoint' first." | Port 8000 is not exposed on the instance | Click **"Expose API Endpoint"** on the instance card |
| "No model is currently loaded on this instance" | The vLLM server is up but has no model loaded yet | Wait for the deployment to finish loading, then retry |
| "Instance not found or not running" | The instance is stopped or unreachable | Check the instance status on your dashboard |

If a response fails mid-stream, your message stays in the conversation — just send it again.