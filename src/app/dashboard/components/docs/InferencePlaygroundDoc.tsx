"use client";

export function InferencePlaygroundDoc() {
  return (
    <div className="prose prose-zinc prose-pre:overflow-x-auto prose-pre:max-w-full">
      <h1>Inference Playground</h1>
      <p className="lead">
        Interactive chat interface for testing and experimenting with your deployed AI models.
        No code required.
      </p>

      <h2>Overview</h2>
      <p>
        The Inference Playground provides a real-time chat interface with streaming responses,
        allowing you to quickly test model behavior, experiment with prompts, and demonstrate
        capabilities without writing any code.
      </p>

      <h3>Key Features</h3>
      <ul>
        <li><strong>Real-time Streaming</strong> - See responses token-by-token as they generate</li>
        <li><strong>System Prompts</strong> - Configure model behavior with custom instructions</li>
        <li><strong>Parameter Controls</strong> - Fine-tune temperature, max tokens, and more</li>
        <li><strong>Conversation History</strong> - Maintain context across multiple turns</li>
        <li><strong>Export Conversations</strong> - Copy or download as JSON</li>
      </ul>

      <h2>Getting Started</h2>

      <h3>Accessing the Playground</h3>
      <ol>
        <li>Navigate to your dashboard</li>
        <li>Select a GPU instance with a deployed model</li>
        <li>Click the <strong>&quot;Playground&quot;</strong> tab</li>
        <li>The playground loads automatically with your model</li>
      </ol>

      <h3>Your First Conversation</h3>
      <ol>
        <li>Enter a message in the text input at the bottom</li>
        <li>Press Enter or click the send button</li>
        <li>Watch the response stream in real-time</li>
        <li>Continue the conversation with follow-up messages</li>
      </ol>

      <h2>Configuration Options</h2>

      <h3>Temperature</h3>
      <p>Controls randomness in generation:</p>
      <table>
        <thead>
          <tr>
            <th>Value</th>
            <th>Behavior</th>
            <th>Use Case</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>0.0</code></td>
            <td>Deterministic, focused</td>
            <td>Code generation, factual Q&amp;A</td>
          </tr>
          <tr>
            <td><code>0.3-0.5</code></td>
            <td>Balanced</td>
            <td>General assistant tasks</td>
          </tr>
          <tr>
            <td><code>0.7-0.9</code></td>
            <td>Creative</td>
            <td>Writing, brainstorming</td>
          </tr>
          <tr>
            <td><code>1.0+</code></td>
            <td>Very random</td>
            <td>Poetry, experimental content</td>
          </tr>
        </tbody>
      </table>

      <h3>Max Tokens</h3>
      <p>Limits response length:</p>
      <ul>
        <li><strong>50-200</strong> - Quick answers, one-liners</li>
        <li><strong>200-500</strong> - Explanations, short articles</li>
        <li><strong>500-2000</strong> - Detailed analysis, stories</li>
        <li><strong>2000+</strong> - Full articles, comprehensive guides</li>
      </ul>

      <h3>System Prompt</h3>
      <p>Defines the model&apos;s persona and behavior. Example prompts:</p>
      <pre>
        <code>{`Technical Assistant:
"You are a senior software engineer. Provide detailed,
accurate technical explanations. Include code examples
when relevant. Use markdown formatting."

Creative Writer:
"You are a creative writing assistant. Write engaging,
vivid prose. Use metaphors and sensory details."

Data Analyst:
"You are a data analyst expert. Explain concepts
clearly with examples. Suggest visualizations."

Customer Support:
"You are a friendly customer support agent. Be
helpful and empathetic. Provide step-by-step
solutions."`}</code>
      </pre>

      <h3>Top P (Nucleus Sampling)</h3>
      <p>Alternative to temperature for controlling randomness:</p>
      <ul>
        <li><code>0.1</code> - Very focused, only most likely tokens</li>
        <li><code>0.5</code> - Moderately diverse</li>
        <li><code>0.9</code> - Quite diverse, occasional surprises</li>
        <li><code>1.0</code> - Consider all tokens</li>
      </ul>
      <p><strong>Tip:</strong> Use either temperature OR top_p, not both. Set the unused one to 1.0.</p>

      <h2>Interface Components</h2>

      <h3>Chat Area</h3>
      <ul>
        <li><strong>User Messages</strong> - Your inputs (right-aligned)</li>
        <li><strong>Assistant Messages</strong> - Model responses (left-aligned)</li>
        <li><strong>Streaming Indicator</strong> - Pulsing cursor during generation</li>
        <li><strong>Timestamps</strong> - When each message was sent</li>
      </ul>

      <h3>Input Area</h3>
      <ul>
        <li><strong>Message Input</strong> - Multi-line text field for prompts</li>
        <li><strong>Send Button</strong> - Submit the message</li>
        <li><strong>Stop Button</strong> - Interrupt generation in progress</li>
        <li><strong>Clear Button</strong> - Start a new conversation</li>
      </ul>

      <h3>Settings Panel</h3>
      <table>
        <thead>
          <tr>
            <th>Setting</th>
            <th>Range</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Model</td>
            <td>Dropdown</td>
            <td>Select from deployed models</td>
          </tr>
          <tr>
            <td>System Prompt</td>
            <td>Text area</td>
            <td>Instructions for model behavior</td>
          </tr>
          <tr>
            <td>Temperature</td>
            <td>0.0 - 2.0</td>
            <td>Creativity/randomness level</td>
          </tr>
          <tr>
            <td>Max Tokens</td>
            <td>1 - 32768</td>
            <td>Maximum response length</td>
          </tr>
          <tr>
            <td>Top P</td>
            <td>0.0 - 1.0</td>
            <td>Nucleus sampling threshold</td>
          </tr>
        </tbody>
      </table>

      <h2>Conversation Patterns</h2>

      <h3>Single-Turn Q&amp;A</h3>
      <p>Best for quick factual questions and simple tasks:</p>
      <pre>
        <code>{`User: What is the capital of Japan?
Assistant: The capital of Japan is Tokyo.`}</code>
      </pre>

      <h3>Multi-Turn Conversations</h3>
      <p>Best for complex problem-solving and iterative refinement:</p>
      <pre>
        <code>{`User: I'm building a web app. What tech stack should I use?
Assistant: For a modern web app, I'd recommend...

User: I have experience with Python. How does that change?
Assistant: Great! With Python experience, I'd suggest...

User: What about the database?
Assistant: For your Python-based stack, consider...`}</code>
      </pre>

      <h3>Chain-of-Thought Prompting</h3>
      <p>For complex reasoning tasks, add this to your system prompt:</p>
      <pre>
        <code>{`"Think through problems step by step before giving the final answer."`}</code>
      </pre>

      <h2>Exporting Conversations</h2>
      <p>You can export your conversations in JSON format:</p>
      <pre>
        <code>{`{
  "model": "meta-llama/Llama-3.1-70B-Instruct",
  "messages": [
    {"role": "system", "content": "You are helpful."},
    {"role": "user", "content": "Hello!"},
    {"role": "assistant", "content": "Hi there! How can I help?"}
  ],
  "parameters": {
    "temperature": 0.7,
    "max_tokens": 1000
  }
}`}</code>
      </pre>

      <h2>Tips &amp; Best Practices</h2>
      <ul>
        <li><strong>Be specific</strong> - Clear prompts get better responses</li>
        <li><strong>Use system prompts</strong> - Define consistent behavior</li>
        <li><strong>Iterate on prompts</strong> - Refine based on responses</li>
        <li><strong>Set appropriate max_tokens</strong> - Avoid unnecessarily long responses</li>
        <li><strong>Use stop sequences</strong> - Control where responses end</li>
      </ul>

      <h2>Need Help?</h2>
      <p>
        Contact us at{" "}
        our support team via the <strong>Support</strong> tab
      </p>
    </div>
  );
}
