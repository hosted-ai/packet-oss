"use client";

import { useState } from "react";

export default function ContactPage() {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    company: "",
    message: "",
  });
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to send message");
      }

      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (submitted) {
    return (
      <section className="contact-section">
        <div className="container">
          <div className="contact-card success">
            <div className="success-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            </div>
            <h1 className="display">Thanks for reaching out!</h1>
            <p>We&apos;ll be in touch within 24 hours to schedule your walkthrough.</p>
            <a href="/" className="btn primary">
              Back to home
            </a>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="contact-section">
      <div className="container">
        <div className="contact-grid">
          <div className="contact-info">
            <h1 className="display">Book a walkthrough</h1>
            <p>
              Want to see the platform in action? Get a personalized demo from our team and
              learn how the platform can power your GPU workloads.
            </p>
            <div className="contact-benefits">
              <div className="benefit">
                <div className="benefit-icon">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                </div>
                <div>
                  <strong>Quick setup</strong>
                  <span>15-minute call, no sales pitch</span>
                </div>
              </div>
              <div className="benefit">
                <div className="benefit-icon">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                </div>
                <div>
                  <strong>Live demo</strong>
                  <span>See the dashboard and SSH access</span>
                </div>
              </div>
              <div className="benefit">
                <div className="benefit-icon">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  </svg>
                </div>
                <div>
                  <strong>No commitment</strong>
                  <span>Learn first, decide later</span>
                </div>
              </div>
            </div>
          </div>

          <div className="contact-card">
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label htmlFor="name">Name</label>
                <input
                  type="text"
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                  placeholder="Your name"
                />
              </div>
              <div className="form-group">
                <label htmlFor="email">Work email</label>
                <input
                  type="email"
                  id="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  required
                  placeholder="you@company.com"
                />
              </div>
              <div className="form-group">
                <label htmlFor="company">Company</label>
                <input
                  type="text"
                  id="company"
                  value={formData.company}
                  onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                  placeholder="Your company (optional)"
                />
              </div>
              <div className="form-group">
                <label htmlFor="message">What would you like to learn?</label>
                <textarea
                  id="message"
                  value={formData.message}
                  onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                  rows={4}
                  placeholder="Tell us about your use case..."
                />
              </div>
              <button type="submit" disabled={loading} className="btn primary">
                {loading ? (
                  <span className="loading-spinner"></span>
                ) : (
                  "Request walkthrough"
                )}
              </button>
              {error && (
                <p style={{ color: "#ef4444", fontSize: "14px", marginTop: "12px" }}>{error}</p>
              )}
            </form>
          </div>
        </div>
      </div>
    </section>
  );
}
