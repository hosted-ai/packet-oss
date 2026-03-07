import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "CLI - GPU Cloud from Your Terminal",
  description:
    "Launch, manage, and SSH into GPU instances from your terminal. The packet CLI brings GPU cloud to developers who live in the command line. Deploy GPUs in seconds.",
  openGraph: {
    title: "packet CLI - GPU Cloud from Your Terminal",
    description: "Launch NVIDIA GPUs in seconds from your terminal. No browser required.",
  },
  alternates: {
    canonical: "https://example.com/cli",
  },
};

export default function CLIPage() {
  return (
    <>
      {/* Hero Section */}
      <section className="hero" style={{ paddingTop: "80px", paddingBottom: "48px" }}>
        <div className="container">
          <div style={{ maxWidth: "800px", margin: "0 auto", textAlign: "center" }}>
            <div className="pill" style={{ marginBottom: "20px", marginLeft: "auto", marginRight: "auto" }}>
              Developer Tools
            </div>
            <h1 className="display" style={{ fontSize: "clamp(2.2rem, 4vw, 3.2rem)", marginBottom: "20px", lineHeight: 1.1 }}>
              GPU cloud from your terminal
            </h1>
            <p style={{ fontSize: "18px", color: "var(--muted)", maxWidth: "600px", margin: "0 auto 32px" }}>
              Launch, manage, and SSH into GPU instances without leaving your terminal.
              The way developers are meant to use cloud GPUs.
            </p>

            {/* Install command */}
            <div style={{
              background: "#0d1117",
              borderRadius: "12px",
              padding: "20px 24px",
              maxWidth: "500px",
              margin: "0 auto 24px",
              border: "1px solid #30363d"
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px" }}>
                <code style={{ color: "#c9d1d9", fontSize: "16px", fontFamily: "monospace" }}>
                  <span style={{ color: "#7ee787" }}>$</span> npm install -g packet-gpu-cli
                </code>
                <button
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "#8b949e",
                    cursor: "pointer",
                    padding: "4px",
                    fontSize: "14px"
                  }}
                  title="Copy to clipboard"
                >
                  📋
                </button>
              </div>
            </div>

            <div style={{ display: "flex", gap: "12px", justifyContent: "center", flexWrap: "wrap" }}>
              <Link href="#quick-start" className="btn primary">
                Quick Start Guide
              </Link>
              <Link href="/account?tab=api-keys" className="btn ghost">
                Get API Key →
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Demo Section */}
      <section style={{ padding: "48px 0 64px" }}>
        <div className="container">
          <div style={{
            background: "#0d1117",
            borderRadius: "16px",
            padding: "32px",
            maxWidth: "800px",
            margin: "0 auto",
            border: "1px solid #30363d",
            fontFamily: "monospace",
            fontSize: "14px",
            lineHeight: 1.8
          }}>
            <div style={{ marginBottom: "24px" }}>
              <span style={{ color: "#8b949e" }}># Authenticate with your API key</span><br />
              <span style={{ color: "#7ee787" }}>$</span> <span style={{ color: "#c9d1d9" }}>packet login</span><br />
              <span style={{ color: "#58a6ff" }}>✓ Logged in as developer@company.com</span>
            </div>

            <div style={{ marginBottom: "24px" }}>
              <span style={{ color: "#8b949e" }}># See available GPUs and pricing</span><br />
              <span style={{ color: "#7ee787" }}>$</span> <span style={{ color: "#c9d1d9" }}>packet gpus</span><br />
              <span style={{ color: "#8b949e" }}>
                ┌────────────────┬──────┬──────────┬───────────┐<br />
                │ GPU            │ VRAM │ Price/hr │ Status    │<br />
                ├────────────────┼──────┼──────────┼───────────┤<br />
                │ RTX PRO 6000   │ 96GB │ $1.29    │ </span><span style={{ color: "#7ee787" }}>available</span><span style={{ color: "#8b949e" }}> │<br />
                │ H100           │ 80GB │ $2.49    │ </span><span style={{ color: "#7ee787" }}>available</span><span style={{ color: "#8b949e" }}> │<br />
                │ B200           │180GB │ $4.99    │ </span><span style={{ color: "#7ee787" }}>available</span><span style={{ color: "#8b949e" }}> │<br />
                └────────────────┴──────┴──────────┴───────────┘
              </span>
            </div>

            <div style={{ marginBottom: "24px" }}>
              <span style={{ color: "#8b949e" }}># Launch a GPU with VS Code pre-installed</span><br />
              <span style={{ color: "#7ee787" }}>$</span> <span style={{ color: "#c9d1d9" }}>packet launch --gpu rtx-pro-6000 --setup vscode</span><br />
              <span style={{ color: "#ffa657" }}>⠋ Launching RTX PRO 6000 with VS Code in Browser...</span><br />
              <span style={{ color: "#58a6ff" }}>✓ Launched RTX PRO 6000</span><br />
              <span style={{ color: "#c9d1d9" }}>  Instance ID: 12847</span><br />
              <span style={{ color: "#c9d1d9" }}>  Setup:       💻 VS Code in Browser</span><br />
              <span style={{ color: "#58a6ff" }}>✓ Instance is ready!</span><br />
              <span style={{ color: "#c9d1d9" }}>  SSH: ssh ubuntu@gpu-12847.the platform -p 30122</span>
            </div>

            <div style={{ marginBottom: "24px" }}>
              <span style={{ color: "#8b949e" }}># Or setup Jupyter on an existing instance</span><br />
              <span style={{ color: "#7ee787" }}>$</span> <span style={{ color: "#c9d1d9" }}>packet setup jupyter-torch 12847</span><br />
              <span style={{ color: "#ffa657" }}>⠋ Running 🔥 Jupyter + PyTorch setup (~5 min)...</span><br />
              <span style={{ color: "#58a6ff" }}>✓ 🔥 Jupyter + PyTorch is ready!</span><br />
              <span style={{ color: "#c9d1d9" }}>  jupyter    port 8888  (token: packet)</span>
            </div>

            <div style={{ marginBottom: "24px" }}>
              <span style={{ color: "#8b949e" }}># SSH directly into your instance</span><br />
              <span style={{ color: "#7ee787" }}>$</span> <span style={{ color: "#c9d1d9" }}>packet ssh 12847</span><br />
              <span style={{ color: "#c9d1d9" }}>ubuntu@gpu-12847:~$ nvidia-smi</span>
            </div>

            <div>
              <span style={{ color: "#8b949e" }}># When you&apos;re done</span><br />
              <span style={{ color: "#7ee787" }}>$</span> <span style={{ color: "#c9d1d9" }}>packet terminate 12847</span><br />
              <span style={{ color: "#58a6ff" }}>✓ Instance 12847 terminated</span>
            </div>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section style={{ padding: "64px 0", background: "var(--panel)" }}>
        <div className="container">
          <div style={{ textAlign: "center", marginBottom: "48px" }}>
            <h2 className="display" style={{ fontSize: "2rem", marginBottom: "16px" }}>
              Built for developers
            </h2>
            <p style={{ color: "var(--muted)", maxWidth: "500px", margin: "0 auto" }}>
              Everything you need to manage GPU instances without leaving your workflow.
            </p>
          </div>

          <div className="cli-features-grid">
            <div className="card" style={{ padding: "28px" }}>
              <div style={{ fontSize: "32px", marginBottom: "16px" }}>⚡</div>
              <h3 className="display" style={{ fontSize: "1.1rem", marginBottom: "8px" }}>Launch in Seconds</h3>
              <p style={{ color: "var(--muted)", fontSize: "14px", margin: 0 }}>
                One command to provision a GPU. No clicking through dashboards.
              </p>
            </div>

            <div className="card" style={{ padding: "28px" }}>
              <div style={{ fontSize: "32px", marginBottom: "16px" }}>🔐</div>
              <h3 className="display" style={{ fontSize: "1.1rem", marginBottom: "8px" }}>Secure Auth</h3>
              <p style={{ color: "var(--muted)", fontSize: "14px", margin: 0 }}>
                API key stored locally. Supports env vars for CI/CD pipelines.
              </p>
            </div>

            <div className="card" style={{ padding: "28px" }}>
              <div style={{ fontSize: "32px", marginBottom: "16px" }}>🚀</div>
              <h3 className="display" style={{ fontSize: "1.1rem", marginBottom: "8px" }}>Auto-Setup</h3>
              <p style={{ color: "var(--muted)", fontSize: "14px", margin: 0 }}>
                Launch with VS Code, Jupyter, or PyTorch pre-installed. One flag: <code style={{ background: "var(--line)", padding: "2px 6px", borderRadius: "4px", fontSize: "13px" }}>--setup vscode</code>
              </p>
            </div>

            <div className="card" style={{ padding: "28px" }}>
              <div style={{ fontSize: "32px", marginBottom: "16px" }}>📜</div>
              <h3 className="display" style={{ fontSize: "1.1rem", marginBottom: "8px" }}>Scriptable</h3>
              <p style={{ color: "var(--muted)", fontSize: "14px", margin: 0 }}>
                Use in bash scripts, Makefiles, or CI/CD. JSON output available.
              </p>
            </div>

            <div className="card" style={{ padding: "28px" }}>
              <div style={{ fontSize: "32px", marginBottom: "16px" }}>🖥️</div>
              <h3 className="display" style={{ fontSize: "1.1rem", marginBottom: "8px" }}>Direct SSH</h3>
              <p style={{ color: "var(--muted)", fontSize: "14px", margin: 0 }}>
                <code style={{ background: "var(--line)", padding: "2px 6px", borderRadius: "4px", fontSize: "13px" }}>packet ssh</code> connects instantly. No config files needed.
              </p>
            </div>

            <div className="card" style={{ padding: "28px" }}>
              <div style={{ fontSize: "32px", marginBottom: "16px" }}>💰</div>
              <h3 className="display" style={{ fontSize: "1.1rem", marginBottom: "8px" }}>Cost Tracking</h3>
              <p style={{ color: "var(--muted)", fontSize: "14px", margin: 0 }}>
                See pricing and runtime costs directly in your terminal.
              </p>
            </div>

            <div className="card" style={{ padding: "28px" }}>
              <div style={{ fontSize: "32px", marginBottom: "16px" }}>🌍</div>
              <h3 className="display" style={{ fontSize: "1.1rem", marginBottom: "8px" }}>Cross-Platform</h3>
              <p style={{ color: "var(--muted)", fontSize: "14px", margin: 0 }}>
                Works on macOS, Linux, and Windows. Node.js 18+ required.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Quick Start */}
      <section id="quick-start" style={{ padding: "64px 0" }}>
        <div className="container">
          <div style={{ maxWidth: "700px", margin: "0 auto" }}>
            <h2 className="display" style={{ fontSize: "2rem", marginBottom: "32px", textAlign: "center" }}>
              Quick Start
            </h2>

            <div style={{ display: "flex", flexDirection: "column", gap: "32px" }}>
              {/* Step 1 */}
              <div style={{ display: "flex", gap: "20px", alignItems: "flex-start" }}>
                <div style={{
                  width: "32px",
                  height: "32px",
                  borderRadius: "50%",
                  background: "var(--blue)",
                  color: "white",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 600,
                  flexShrink: 0
                }}>1</div>
                <div style={{ flex: 1 }}>
                  <h3 style={{ marginBottom: "8px" }}>Install the CLI</h3>
                  <div style={{
                    background: "#0d1117",
                    borderRadius: "8px",
                    padding: "12px 16px",
                    border: "1px solid #30363d"
                  }}>
                    <code style={{ color: "#c9d1d9", fontSize: "14px" }}>npm install -g packet-gpu-cli</code>
                  </div>
                </div>
              </div>

              {/* Step 2 */}
              <div style={{ display: "flex", gap: "20px", alignItems: "flex-start" }}>
                <div style={{
                  width: "32px",
                  height: "32px",
                  borderRadius: "50%",
                  background: "var(--blue)",
                  color: "white",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 600,
                  flexShrink: 0
                }}>2</div>
                <div style={{ flex: 1 }}>
                  <h3 style={{ marginBottom: "8px" }}>Authenticate</h3>
                  <p style={{ color: "var(--muted)", fontSize: "14px", marginBottom: "12px" }}>
                    Run <code style={{ background: "var(--line)", padding: "2px 6px", borderRadius: "4px" }}>packet login</code> and enter your API key.
                    Get one from <Link href="/account?tab=api-keys" style={{ color: "var(--blue)" }}>your account settings</Link>.
                  </p>
                  <div style={{
                    background: "#0d1117",
                    borderRadius: "8px",
                    padding: "12px 16px",
                    border: "1px solid #30363d"
                  }}>
                    <code style={{ color: "#c9d1d9", fontSize: "14px" }}>packet login --key your-api-key</code>
                  </div>
                </div>
              </div>

              {/* Step 3 */}
              <div style={{ display: "flex", gap: "20px", alignItems: "flex-start" }}>
                <div style={{
                  width: "32px",
                  height: "32px",
                  borderRadius: "50%",
                  background: "var(--blue)",
                  color: "white",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 600,
                  flexShrink: 0
                }}>3</div>
                <div style={{ flex: 1 }}>
                  <h3 style={{ marginBottom: "8px" }}>Launch a GPU</h3>
                  <div style={{
                    background: "#0d1117",
                    borderRadius: "8px",
                    padding: "12px 16px",
                    border: "1px solid #30363d"
                  }}>
                    <code style={{ color: "#c9d1d9", fontSize: "14px" }}>packet launch --gpu rtx-pro-6000 --wait</code>
                  </div>
                </div>
              </div>

              {/* Step 4 */}
              <div style={{ display: "flex", gap: "20px", alignItems: "flex-start" }}>
                <div style={{
                  width: "32px",
                  height: "32px",
                  borderRadius: "50%",
                  background: "var(--blue)",
                  color: "white",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 600,
                  flexShrink: 0
                }}>4</div>
                <div style={{ flex: 1 }}>
                  <h3 style={{ marginBottom: "8px" }}>Connect via SSH</h3>
                  <div style={{
                    background: "#0d1117",
                    borderRadius: "8px",
                    padding: "12px 16px",
                    border: "1px solid #30363d"
                  }}>
                    <code style={{ color: "#c9d1d9", fontSize: "14px" }}>packet ssh &lt;instance-id&gt;</code>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Command Reference */}
      <section style={{ padding: "64px 0", background: "var(--panel)" }}>
        <div className="container">
          <div style={{ maxWidth: "800px", margin: "0 auto" }}>
            <h2 className="display" style={{ fontSize: "2rem", marginBottom: "32px", textAlign: "center" }}>
              Command Reference
            </h2>

            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              {[
                { cmd: "packet login", desc: "Authenticate with your API key" },
                { cmd: "packet logout", desc: "Remove stored credentials" },
                { cmd: "packet whoami", desc: "Show current account and balance" },
                { cmd: "packet gpus", desc: "List available GPU types and pricing" },
                { cmd: "packet launch --gpu <type>", desc: "Launch a new GPU instance" },
                { cmd: "packet launch --setup <preset>", desc: "Launch with auto-setup (vscode, jupyter, etc.)" },
                { cmd: "packet setup list", desc: "List available auto-setup presets" },
                { cmd: "packet setup <preset> <id>", desc: "Run setup on an existing instance" },
                { cmd: "packet ps", desc: "List your running instances" },
                { cmd: "packet ssh <id>", desc: "SSH into an instance" },
                { cmd: "packet logs <id>", desc: "View instance status and info" },
                { cmd: "packet terminate <id>", desc: "Terminate an instance" },
              ].map((item, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "16px 20px",
                    background: "var(--bg)",
                    borderRadius: "8px",
                    border: "1px solid var(--line)",
                    gap: "16px",
                    flexWrap: "wrap"
                  }}
                >
                  <code style={{
                    color: "var(--ink)",
                    fontSize: "14px",
                    fontWeight: 500,
                    fontFamily: "monospace"
                  }}>{item.cmd}</code>
                  <span style={{ color: "var(--muted)", fontSize: "14px" }}>{item.desc}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* CI/CD Section */}
      <section style={{ padding: "64px 0" }}>
        <div className="container">
          <div style={{ maxWidth: "800px", margin: "0 auto" }}>
            <h2 className="display" style={{ fontSize: "2rem", marginBottom: "16px", textAlign: "center" }}>
              Use in CI/CD
            </h2>
            <p style={{ color: "var(--muted)", textAlign: "center", marginBottom: "32px" }}>
              Run GPU workloads in GitHub Actions, GitLab CI, or any pipeline.
            </p>

            <div style={{
              background: "#0d1117",
              borderRadius: "12px",
              padding: "24px",
              border: "1px solid #30363d",
              overflow: "auto"
            }}>
              <pre style={{ margin: 0, color: "#c9d1d9", fontSize: "13px", lineHeight: 1.6 }}>
{`# .github/workflows/train.yml
name: Train Model

on: [push]

jobs:
  train:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install packet CLI
        run: npm install -g packet-gpu-cli

      - name: Launch GPU and train
        env:
          PACKET_API_KEY: \${{ secrets.PACKET_API_KEY }}
        run: |
          packet login --key $PACKET_API_KEY

          # Launch GPU
          INSTANCE=$(packet launch --gpu h100 --wait | grep "Instance ID" | awk '{print $3}')

          # Run training
          packet ssh $INSTANCE -c "cd /workspace && python train.py"

          # Cleanup
          packet terminate $INSTANCE -f`}
              </pre>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="cta-section" style={{ padding: "64px 0" }}>
        <div className="container" style={{ textAlign: "center" }}>
          <h2 className="display" style={{ fontSize: "2rem", marginBottom: "16px" }}>
            Ready to try it?
          </h2>
          <p style={{ color: "var(--muted)", marginBottom: "32px", maxWidth: "500px", margin: "0 auto 32px" }}>
            Install the CLI and launch your first GPU in under a minute.
          </p>
          <div style={{ display: "flex", gap: "12px", justifyContent: "center", flexWrap: "wrap" }}>
            <Link href="/checkout" className="btn primary">
              Sign Up Free
            </Link>
            <Link href="/features" className="btn ghost">
              View All Features →
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
