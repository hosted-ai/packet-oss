# Inference Playground

## Overview

The Inference Playground is an interactive web-based interface for testing and experimenting with your deployed AI models. It provides a real-time chat interface with streaming responses, allowing you to quickly validate model behavior, test prompts, and demonstrate capabilities without writing any code.

### Key Features

- **Real-time Streaming**: See model responses token-by-token as they generate
- **System Prompts**: Configure model behavior with custom system instructions
- **Parameter Controls**: Fine-tune temperature, max tokens, and other generation settings
- **Multi-Model Support**: Switch between different deployed models instantly
- **Conversation History**: Maintain context across multiple turns
- **Export Capabilities**: Copy conversations or export as JSON
- **Mobile Responsive**: Works on tablets and phones for demos on the go

---

## 🚀 Getting Started

### Accessing the Playground

1. Navigate to your Dashboard
2. Select a GPU instance with a deployed model
3. Click the **"Playground"** tab or button
4. The playground loads automatically with your model

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
- **Streaming Indicator**: Pulsing cursor during generation
- **Timestamps**: When each message was sent

### Input Area

At the bottom of the screen:
- **Message Input**: Multi-line text field for your prompts
- **Send Button**: Submit the message
- **Stop Button**: Interrupt generation in progress
- **Clear Button**: Start a new conversation

### Settings Panel

Right sidebar or expandable panel:

| Setting | Range | Description |
|---------|-------|-------------|
| **Model** | Dropdown | Select from deployed models |
| **System Prompt** | Text area | Instructions for model behavior |
| **Temperature** | 0.0 - 2.0 | Creativity/randomness level |
| **Max Tokens** | 1 - 32768 | Maximum response length |
| **Top P** | 0.0 - 1.0 | Nucleus sampling threshold |
| **Presence Penalty** | -2.0 - 2.0 | Penalize repeated topics |
| **Frequency Penalty** | -2.0 - 2.0 | Penalize repeated tokens |

---

## ⚙️ Configuration Options

### Temperature

Controls randomness in generation:

| Value | Behavior | Use Case |
|-------|----------|----------|
| **0.0** | Deterministic, focused | Code generation, factual Q&A |
| **0.3-0.5** | Balanced | General assistant tasks |
| **0.7-0.9** | Creative | Writing, brainstorming |
| **1.0+** | Very random | Poetry, experimental content |

```
Example:
Temperature 0.0: "The capital of France is Paris."
Temperature 1.0: "The capital of France is the magnificent city of Paris, a jewel of European culture..."
```

### Max Tokens

Limits response length:
- **Short responses** (50-200): Quick answers, one-liners
- **Medium responses** (200-500): Explanations, short articles
- **Long responses** (500-2000): Detailed analysis, stories
- **Very long** (2000+): Full articles, comprehensive guides

### System Prompt

Defines the model's persona and behavior:

```
Example System Prompts:

1. Technical Assistant:
"You are a senior software engineer. Provide detailed,
accurate technical explanations. Include code examples
when relevant. Use markdown formatting."

2. Creative Writer:
"You are a creative writing assistant. Write engaging,
vivid prose. Use metaphors and sensory details. Vary
sentence structure for rhythm."

3. Data Analyst:
"You are a data analyst expert. Explain concepts
clearly with examples. Suggest appropriate
visualizations. Reference best practices."

4. Customer Support:
"You are a friendly customer support agent. Be
helpful and empathetic. Provide step-by-step
solutions. Escalate complex issues appropriately."
```

### Top P (Nucleus Sampling)

Alternative to temperature for controlling randomness:
- **0.1**: Very focused, only most likely tokens
- **0.5**: Moderately diverse
- **0.9**: Quite diverse, occasional surprises
- **1.0**: Consider all tokens (weighted by probability)

**Tip**: Use either temperature OR top_p, not both. Set the unused one to 1.0.

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

For complex reasoning:

```
System Prompt: "Think through problems step by step before giving the final answer."

User: A farmer has 17 sheep. All but 9 run away. How many are left?