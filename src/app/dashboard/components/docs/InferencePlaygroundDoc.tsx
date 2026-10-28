"use client";

export function InferencePlaygroundDoc() {
  return (
    <div>
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
        <li><strong>Zero Configuration</strong> - The playground automatically detects the model running on your instance</li>
        <li><strong>Conversation History</strong> - Maintain context across multiple turns</li>
        <li><strong>Performance Stats</strong> - Latency, generation speed, and token count shown after each response</li>
      </ul>

      <h2>Getting Started</h2>

      <h3>Accessing the Playground</h3>
      <ol>
        <li>Navigate to your dashboard</li>
        <li>Expand the GPU instance card that has your deployed model</li>
        <li>In the model deployment section, click the <strong>&quot;Test Chat&quot;</strong> button</li>
        <li>The playground opens automatically with your model - no model selection needed</li>
      </ol>
      <p>
        If port 8000 is not yet exposed, the instance card shows an{" "}
        <strong>&quot;Expose API Endpoint&quot;</strong> button instead - click it first. See the{" "}
        <strong>Service Exposure</strong> guide for details.
      </p>

      <h3>Your First Conversation</h3>
      <ol>
        <li>Enter a message in the text input at the bottom</li>
        <li>Press Enter or click the send button</li>
        <li>Watch the response stream in real-time</li>
        <li>Continue the conversation with follow-up messages</li>
      </ol>

      <h2>Configuration Options</h2>
      <p>
        The playground is intentionally simple - it uses fixed generation settings so you
        can test a deployed model with zero setup:
      </p>
      <ul>
        <li><strong>Model</strong> - Detected automatically from your instance (the model currently loaded in vLLM)</li>
        <li><strong>Max response length</strong> - Capped at 2,048 tokens per response</li>
        <li><strong>Sampling parameters</strong> (temperature, top_p, etc.) - Your model server&apos;s defaults</li>
      </ul>
      <p>
        If you need control over temperature, max tokens, system prompts, or other
        generation parameters, call your instance&apos;s exposed vLLM OpenAI-compatible API
        directly instead - see the <strong>Service Exposure</strong> guide for how to
        expose and connect to it.
      </p>

      <h2>Interface Components</h2>

      <h3>Chat Area</h3>
      <ul>
        <li><strong>User Messages</strong> - Your inputs (right-aligned)</li>
        <li><strong>Assistant Messages</strong> - Model responses (left-aligned)</li>
        <li><strong>Typing Indicator</strong> - Animated dots while the model begins generating</li>
      </ul>

      <h3>Input Area</h3>
      <ul>
        <li><strong>Message Input</strong> - Multi-line text field for prompts (Enter to send, Shift+Enter for a new line)</li>
        <li><strong>Send Button</strong> - Submit the message</li>
        <li><strong>Clear Button</strong> - In the header; starts a new conversation</li>
      </ul>

      <h3>Performance Stats</h3>
      <p>After each response, a stats bar shows:</p>
      <table>
        <thead>
          <tr>
            <th>Stat</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Latency</td>
            <td>Total time taken for the response (ms)</td>
          </tr>
          <tr>
            <td>Speed</td>
            <td>Generation speed in tokens per second</td>
          </tr>
          <tr>
            <td>Tokens</td>
            <td>Number of tokens in the response</td>
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
      <p>For complex reasoning, ask the model to show its working as part of your message:</p>
      <pre>
        <code>{`User: Think through this step by step before giving the final answer.
A farmer has 17 sheep. All but 9 run away. How many are left?

Assistant: Let's work through it. "All but 9 run away" means 9 sheep
did not run away. Final answer: 9 sheep are left.`}</code>
      </pre>

      <h2>Tips &amp; Best Practices</h2>
      <ul>
        <li><strong>Be specific</strong> - Clear prompts get better responses</li>
        <li><strong>Iterate on prompts</strong> - Refine based on responses</li>
        <li><strong>If a response fails mid-stream</strong> - Your message stays in the conversation; just send it again</li>
      </ul>

      <h2>Need Help?</h2>
      <p>
        Contact us at{" "}
        our support team via the <strong>Support</strong> tab
      </p>
    </div>
  );
}
