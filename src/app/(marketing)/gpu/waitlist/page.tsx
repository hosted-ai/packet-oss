"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

const gpuInfo: Record<string, { name: string; fullName: string; memory: string; price: string; emoji: string; tagline: string }> = {
  b200: {
    name: "B200",
    fullName: "NVIDIA B200 SXM",
    memory: "180GB HBM3e",
    price: "$2.25/hour",
    emoji: "🚀",
    tagline: "The beast is coming",
  },
  h200: {
    name: "H200",
    fullName: "NVIDIA H200 SXM",
    memory: "141GB HBM3e",
    price: "$1.50/hour",
    emoji: "⚡",
    tagline: "Power meets precision",
  },
};

function FloatingParticle({ delay, duration, left }: { delay: number; duration: number; left: string }) {
  return (
    <div
      style={{
        position: "absolute",
        width: "4px",
        height: "4px",
        background: "rgba(20, 184, 166, 0.6)",
        borderRadius: "50%",
        left,
        bottom: "-10px",
        animation: `float ${duration}s ease-in-out infinite`,
        animationDelay: `${delay}s`,
      }}
    />
  );
}

function WaitlistContent() {
  const searchParams = useSearchParams();
  const gpuId = searchParams.get("gpu") || "b200";
  const initialEmail = searchParams.get("email") || "";

  const gpu = gpuInfo[gpuId] || gpuInfo.b200;

  const [email, setEmail] = useState(initialEmail);
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [waitlistCount, setWaitlistCount] = useState(247);

  // Auto-submit if email was passed from landing page
  useEffect(() => {
    if (initialEmail && initialEmail.includes("@") && status === "idle") {
      submitToWaitlist(initialEmail);
    }
  }, [initialEmail]);

  // Simulate live counter
  useEffect(() => {
    const interval = setInterval(() => {
      if (Math.random() > 0.7) {
        setWaitlistCount(c => c + 1);
      }
    }, 8000);
    return () => clearInterval(interval);
  }, []);

  async function submitToWaitlist(emailToSubmit: string) {
    setStatus("loading");
    setErrorMessage("");

    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: emailToSubmit,
          source: `gpu-${gpuId}-landing`,
          metadata: { gpu: gpuId, gpuName: gpu.fullName },
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to join waitlist");
      }

      setStatus("success");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Something went wrong");
      setStatus("error");
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!email || !email.includes("@")) {
      setErrorMessage("Please enter a valid email address");
      setStatus("error");
      return;
    }

    submitToWaitlist(email);
  }

  if (status === "success") {
    return (
      <section style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(135deg, #0a0a0a 0%, #0f172a 50%, #1e1b4b 100%)",
        color: "white",
        padding: "40px 20px",
        position: "relative",
        overflow: "hidden",
      }}>
        {/* Confetti-like celebration */}
        <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
          {[...Array(20)].map((_, i) => (
            <div
              key={i}
              style={{
                position: "absolute",
                width: `${Math.random() * 10 + 5}px`,
                height: `${Math.random() * 10 + 5}px`,
                background: ["#14b8a6", "#8b5cf6", "#f59e0b", "#ec4899"][i % 4],
                borderRadius: Math.random() > 0.5 ? "50%" : "2px",
                left: `${Math.random() * 100}%`,
                top: `-20px`,
                animation: `confetti ${Math.random() * 3 + 2}s ease-out forwards`,
                animationDelay: `${Math.random() * 0.5}s`,
                opacity: 0.8,
              }}
            />
          ))}
        </div>

        <div style={{ maxWidth: "500px", textAlign: "center", position: "relative", zIndex: 1 }}>
          <div style={{
            fontSize: "80px",
            marginBottom: "16px",
            animation: "bounce 0.6s ease-out",
          }}>
            🎉
          </div>

          <h1 style={{
            fontSize: "42px",
            fontWeight: 800,
            marginBottom: "16px",
            background: "linear-gradient(135deg, #14b8a6, #8b5cf6)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}>
            You&apos;re In!
          </h1>

          <p style={{ color: "rgba(255,255,255,0.8)", fontSize: "20px", marginBottom: "32px", lineHeight: 1.6 }}>
            Welcome to the {gpu.name} squad! {gpu.emoji}<br />
            You&apos;ll be among the first to know.
          </p>

          <div style={{
            background: "rgba(255,255,255,0.05)",
            backdropFilter: "blur(10px)",
            borderRadius: "20px",
            padding: "28px",
            marginBottom: "32px",
            border: "1px solid rgba(255,255,255,0.1)",
          }}>
            <div style={{
              fontSize: "14px",
              color: "rgba(255,255,255,0.5)",
              marginBottom: "12px",
              textTransform: "uppercase",
              letterSpacing: "2px",
            }}>
              Your reservation
            </div>
            <div style={{
              fontSize: "28px",
              fontWeight: 700,
              marginBottom: "8px",
            }}>
              {gpu.fullName}
            </div>
            <div style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "12px",
              background: "rgba(20, 184, 166, 0.15)",
              padding: "8px 16px",
              borderRadius: "100px",
              fontSize: "16px",
              color: "#14b8a6",
            }}>
              <span>{gpu.memory}</span>
              <span style={{ opacity: 0.5 }}>•</span>
              <span>{gpu.price}</span>
            </div>
          </div>

          <div style={{
            display: "flex",
            gap: "16px",
            justifyContent: "center",
            flexWrap: "wrap",
          }}>
            <Link
              href="/"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                background: "rgba(255,255,255,0.1)",
                color: "white",
                padding: "12px 24px",
                borderRadius: "12px",
                textDecoration: "none",
                fontSize: "16px",
                fontWeight: 500,
                transition: "all 0.2s",
              }}
            >
              Back to Home
            </Link>
            <Link
              href={`/gpu/${gpuId}`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                background: "linear-gradient(135deg, #14b8a6, #0d9488)",
                color: "white",
                padding: "12px 24px",
                borderRadius: "12px",
                textDecoration: "none",
                fontSize: "16px",
                fontWeight: 600,
              }}
            >
              Explore {gpu.name} Specs →
            </Link>
          </div>
        </div>

        <style jsx global>{`
          @keyframes confetti {
            0% { transform: translateY(0) rotate(0deg); opacity: 1; }
            100% { transform: translateY(100vh) rotate(720deg); opacity: 0; }
          }
          @keyframes bounce {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.2); }
          }
        `}</style>
      </section>
    );
  }

  return (
    <section style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "linear-gradient(135deg, #0a0a0a 0%, #0f172a 50%, #1e1b4b 100%)",
      color: "white",
      padding: "40px 20px",
      position: "relative",
      overflow: "hidden",
    }}>
      {/* Animated background elements */}
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
        {/* Glowing orbs */}
        <div style={{
          position: "absolute",
          top: "10%",
          right: "10%",
          width: "400px",
          height: "400px",
          background: "radial-gradient(circle, rgba(139, 92, 246, 0.2) 0%, transparent 70%)",
          borderRadius: "50%",
          filter: "blur(60px)",
          animation: "pulse 4s ease-in-out infinite",
        }} />
        <div style={{
          position: "absolute",
          bottom: "10%",
          left: "10%",
          width: "500px",
          height: "500px",
          background: "radial-gradient(circle, rgba(20, 184, 166, 0.15) 0%, transparent 70%)",
          borderRadius: "50%",
          filter: "blur(80px)",
          animation: "pulse 5s ease-in-out infinite reverse",
        }} />

        {/* Floating particles */}
        {[...Array(12)].map((_, i) => (
          <FloatingParticle
            key={i}
            delay={i * 0.5}
            duration={3 + Math.random() * 2}
            left={`${10 + i * 8}%`}
          />
        ))}

        {/* Grid overlay */}
        <div style={{
          position: "absolute",
          inset: 0,
          backgroundImage: `
            linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)
          `,
          backgroundSize: "50px 50px",
        }} />
      </div>

      <div style={{ maxWidth: "520px", textAlign: "center", position: "relative", zIndex: 1 }}>
        {/* GPU Emoji + Coming Soon */}
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "16px",
          marginBottom: "24px",
        }}>
          <span style={{
            fontSize: "48px",
            animation: "float 3s ease-in-out infinite",
          }}>
            {gpu.emoji}
          </span>
          <div style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
            background: "linear-gradient(135deg, rgba(251, 191, 36, 0.2), rgba(245, 158, 11, 0.1))",
            border: "1px solid rgba(251, 191, 36, 0.4)",
            borderRadius: "100px",
            padding: "10px 20px",
            fontSize: "14px",
            fontWeight: 600,
            color: "#fbbf24",
          }}>
            <span style={{
              width: "8px",
              height: "8px",
              background: "#fbbf24",
              borderRadius: "50%",
              animation: "pulse 1.5s infinite"
            }} />
            Coming Soon
          </div>
        </div>

        {/* Main heading */}
        <h1 style={{
          fontSize: "clamp(2.5rem, 6vw, 3.5rem)",
          fontWeight: 800,
          marginBottom: "8px",
          lineHeight: 1.1,
        }}>
          {gpu.fullName}
        </h1>

        <p style={{
          fontSize: "22px",
          color: "#14b8a6",
          fontWeight: 500,
          marginBottom: "12px",
          fontStyle: "italic",
        }}>
          {gpu.tagline}
        </p>

        <p style={{
          color: "rgba(255,255,255,0.6)",
          fontSize: "18px",
          marginBottom: "8px"
        }}>
          {gpu.memory} • {gpu.price}
        </p>

        {/* Live waitlist counter */}
        <div style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "8px",
          color: "rgba(255,255,255,0.5)",
          fontSize: "14px",
          marginBottom: "40px",
        }}>
          <span style={{
            width: "6px",
            height: "6px",
            background: "#22c55e",
            borderRadius: "50%",
            animation: "pulse 2s infinite",
          }} />
          <span>{waitlistCount} people already waiting</span>
        </div>

        {/* Email Form - Card style */}
        <div style={{
          background: "rgba(255,255,255,0.03)",
          backdropFilter: "blur(20px)",
          borderRadius: "24px",
          padding: "32px",
          border: "1px solid rgba(255,255,255,0.1)",
          marginBottom: "24px",
        }}>
          <p style={{
            color: "rgba(255,255,255,0.9)",
            fontSize: "18px",
            marginBottom: "24px",
            fontWeight: 500,
          }}>
            Be first in line when we launch 🔥
          </p>

          <form onSubmit={handleSubmit}>
            <div style={{
              display: "flex",
              flexDirection: "column",
              gap: "12px",
            }}>
              <input
                type="email"
                placeholder="your@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={{
                  width: "100%",
                  background: "rgba(255,255,255,0.08)",
                  border: "2px solid rgba(255,255,255,0.1)",
                  borderRadius: "12px",
                  padding: "16px 20px",
                  color: "white",
                  fontSize: "17px",
                  outline: "none",
                  transition: "all 0.2s",
                  boxSizing: "border-box",
                }}
                onFocus={(e) => {
                  e.target.style.borderColor = "rgba(20, 184, 166, 0.5)";
                  e.target.style.background = "rgba(255,255,255,0.1)";
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = "rgba(255,255,255,0.1)";
                  e.target.style.background = "rgba(255,255,255,0.08)";
                }}
                required
              />
              <button
                type="submit"
                disabled={status === "loading"}
                style={{
                  width: "100%",
                  background: "linear-gradient(135deg, #14b8a6 0%, #0d9488 50%, #0f766e 100%)",
                  color: "white",
                  padding: "16px 32px",
                  borderRadius: "12px",
                  border: "none",
                  fontWeight: 700,
                  fontSize: "17px",
                  cursor: status === "loading" ? "wait" : "pointer",
                  opacity: status === "loading" ? 0.7 : 1,
                  transition: "all 0.2s",
                  boxShadow: "0 4px 20px rgba(20, 184, 166, 0.4)",
                }}
              >
                {status === "loading" ? "Joining..." : `Join the ${gpu.name} Waitlist →`}
              </button>
            </div>

            {status === "error" && (
              <p style={{
                color: "#f87171",
                fontSize: "14px",
                marginTop: "12px",
                background: "rgba(248, 113, 113, 0.1)",
                padding: "8px 12px",
                borderRadius: "8px",
              }}>
                {errorMessage}
              </p>
            )}
          </form>
        </div>

        <p style={{
          color: "rgba(255,255,255,0.4)",
          fontSize: "13px",
          marginBottom: "40px"
        }}>
          No spam, pinky promise 🤙 Only {gpu.name} news.
        </p>

        {/* Benefits - horizontal pills */}
        <div style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "10px",
          justifyContent: "center",
          marginBottom: "40px",
        }}>
          {[
            { text: "Priority Access", icon: "⚡" },
            { text: "Early Bird Pricing", icon: "💰" },
            { text: "VIP Support", icon: "🎯" },
            { text: "No Commitment", icon: "✨" },
          ].map((benefit) => (
            <div
              key={benefit.text}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: "100px",
                padding: "8px 16px",
                fontSize: "14px",
                color: "rgba(255,255,255,0.8)",
              }}
            >
              <span>{benefit.icon}</span>
              <span>{benefit.text}</span>
            </div>
          ))}
        </div>

        <Link
          href={`/gpu/${gpuId}`}
          style={{
            color: "rgba(255,255,255,0.5)",
            textDecoration: "none",
            fontSize: "14px",
            transition: "color 0.2s",
          }}
        >
          ← Back to {gpu.name} specs
        </Link>
      </div>

      <style jsx global>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.6; transform: scale(1.05); }
        }
        @keyframes float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-100vh); opacity: 0; }
        }
      `}</style>
    </section>
  );
}

export default function WaitlistPage() {
  return (
    <Suspense fallback={
      <section style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(135deg, #0a0a0a 0%, #0f172a 50%, #1e1b4b 100%)",
        color: "white",
      }}>
        <div style={{
          width: "40px",
          height: "40px",
          border: "3px solid rgba(20, 184, 166, 0.3)",
          borderTopColor: "#14b8a6",
          borderRadius: "50%",
          animation: "spin 1s linear infinite",
        }} />
        <style jsx global>{`
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `}</style>
      </section>
    }>
      <WaitlistContent />
    </Suspense>
  );
}
