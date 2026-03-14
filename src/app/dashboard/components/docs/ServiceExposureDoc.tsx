"use client";

export function ServiceExposureDoc() {
  return (
    <div className="prose prose-zinc max-w-none">
      <h1>Service Exposure Guide</h1>
      <p className="lead">
        Expose network ports from your GPU instances to the internet for APIs,
        web UIs, and other services.
      </p>

      <h2>Overview</h2>
      <p>
        Service Exposure allows you to expose network ports from your GPU
        instances to the internet, making services accessible via public URLs.
        This eliminates the need for SSH tunneling.
      </p>

      <p>When you expose a service:</p>
      <ol>
        <li>Your internal port is mapped to an external port</li>
        <li>An external IP address and port are assigned</li>
        <li>Traffic from the internet is routed to your pod</li>
        <li>You receive a public URL to access the service</li>
      </ol>

      <h2>Common Use Cases</h2>

      <h3>vLLM API Server</h3>
      <p>Expose your vLLM OpenAI-compatible API:</p>
      <ul>
        <li>
          <strong>Port</strong>: 8000
        </li>
        <li>
          <strong>Protocol</strong>: TCP
        </li>
      </ul>
      <pre>
        <code>
          python -m vllm.entrypoints.openai.api_server --host 0.0.0.0 --port
          8000
        </code>
      </pre>

      <h3>Jupyter Notebook</h3>
      <p>Access Jupyter Lab or Notebook remotely:</p>
      <ul>
        <li>
          <strong>Port</strong>: 8888
        </li>
        <li>
          <strong>Protocol</strong>: TCP
        </li>
      </ul>

      <h3>TensorBoard</h3>
      <p>Monitor training metrics in real-time:</p>
      <ul>
        <li>
          <strong>Port</strong>: 6006
        </li>
        <li>
          <strong>Protocol</strong>: TCP
        </li>
      </ul>

      <h3>Gradio / Streamlit</h3>
      <p>Expose custom web applications:</p>
      <ul>
        <li>
          <strong>Gradio Port</strong>: 7860
        </li>
        <li>
          <strong>Streamlit Port</strong>: 8501
        </li>
      </ul>

      <h2>How to Expose a Service</h2>

      <h3>Step 1: Start Your Application</h3>
      <p>
        Ensure your service is running and listening on the desired port.{" "}
        <strong>Important</strong>: Always bind to <code>0.0.0.0</code> (all
        interfaces), not <code>localhost</code> or <code>127.0.0.1</code>.
      </p>
      <pre>
        <code>{`# Example: Start vLLM API server
python -m vllm.entrypoints.openai.api_server \\
  --model your-model \\
  --host 0.0.0.0 \\
  --port 8000`}</code>
      </pre>

      <h3>Step 2: Click &quot;Expose Port&quot;</h3>
      <p>
        In the Exposed Services section of your GPU card, click the{" "}
        <strong>&quot;+ Expose Port&quot;</strong> button.
      </p>

      <h3>Step 3: Fill in Service Details</h3>
      <table>
        <thead>
          <tr>
            <th>Field</th>
            <th>Description</th>
            <th>Example</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Service Name</td>
            <td>A friendly name (lowercase, hyphens allowed)</td>
            <td>
              <code>vllm-api</code>
            </td>
          </tr>
          <tr>
            <td>Port</td>
            <td>Port your app is listening on</td>
            <td>
              <code>8000</code>
            </td>
          </tr>
          <tr>
            <td>Protocol</td>
            <td>TCP (default) or UDP</td>
            <td>
              <code>TCP</code>
            </td>
          </tr>
        </tbody>
      </table>

      <h3>Step 4: Access Your Service</h3>
      <p>Once exposed, you&apos;ll see the external URL:</p>
      <pre>
        <code>http://34.123.45.67:31234</code>
      </pre>
      <p>Click the copy button to copy the URL.</p>

      <h2>Managing Services</h2>

      <h3>Viewing Exposed Services</h3>
      <p>
        All exposed services are shown in the &quot;Exposed Services&quot;
        section of your GPU card with their external URLs.
      </p>

      <h3>Deleting a Service</h3>
      <ol>
        <li>Find the service in the Exposed Services section</li>
        <li>Click the delete (trash) icon</li>
        <li>Confirm the deletion</li>
      </ol>
      <p>
        <strong>Note</strong>: External clients will lose access immediately.
      </p>

      <h2>Best Practices</h2>

      <h3>Security</h3>
      <ul>
        <li>
          <strong>Add authentication</strong> to sensitive services
        </li>
        <li>
          <strong>Use HTTPS</strong> when possible for production
        </li>
        <li>
          <strong>Limit exposed ports</strong> - only expose what you need
        </li>
        <li>
          <strong>Delete services</strong> when no longer needed
        </li>
      </ul>

      <h3>Naming</h3>
      <ul>
        <li>
          Use descriptive names: <code>vllm-api</code>, <code>jupyter-main</code>
        </li>
        <li>Lowercase only, use hyphens not spaces</li>
      </ul>

      <h2>Troubleshooting</h2>

      <h3>Service Not Accessible</h3>
      <p>
        <strong>Application not listening on 0.0.0.0</strong>:
      </p>
      <pre>
        <code>{`# Wrong - only localhost can connect
python app.py --host 127.0.0.1 --port 8000

# Correct - external traffic can connect
python app.py --host 0.0.0.0 --port 8000`}</code>
      </pre>

      <p>
        <strong>Application not running</strong>:
      </p>
      <pre>
        <code>ps aux | grep python</code>
      </pre>

      <p>
        <strong>Wrong port number</strong>:
      </p>
      <pre>
        <code>netstat -tlnp | grep 8000</code>
      </pre>

      <h3>Connection Timeout</h3>
      <ul>
        <li>Verify your GPU instance is running</li>
        <li>Check the service exists in the Exposed Services section</li>
        <li>Ensure your application is running and listening</li>
      </ul>

      <h2>Alternative: SSH Port Forwarding</h2>
      <p>
        For temporary access without exposing publicly, you can use SSH port
        forwarding instead:
      </p>
      <pre>
        <code>{`# Forward remote port 8000 to local port 8000
ssh -p <ssh-port> -L 8000:localhost:8000 ubuntu@<host>`}</code>
      </pre>
      <p>
        Then access at <code>http://localhost:8000</code> on your machine.
      </p>

      <h2>Need Help?</h2>
      <p>
        Contact us at{" "}
        our support team via the <strong>Support</strong> tab
      </p>
    </div>
  );
}
