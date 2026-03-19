"use client";

import { useState, useId, useEffect } from "react";

interface OssSupportTabProps {
  token: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

type Priority = "normal" | "high";
type FormState = "idle" | "submitting" | "success" | "error";

export function OssSupportTab({ token }: OssSupportTabProps) {
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [priority, setPriority] = useState<Priority>("normal");
  const [formState, setFormState] = useState<FormState>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [supportEmail, setSupportEmail] = useState("");

  const subjectId = useId();
  const messageId = useId();
  const priorityId = useId();

  // Fetch support email from branding API (DB-backed, not env var)
  useEffect(() => {
    fetch("/api/branding")
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (data?.supportEmail) setSupportEmail(data.supportEmail);
      })
      .catch(() => {});
  }, []);

  const isSubmitting = formState === "submitting";

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!message.trim()) return;

    setFormState("submitting");
    setErrorMessage("");

    try {
      const res = await fetch("/api/support/contact", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          subject: subject.trim() || undefined,
          message: message.trim(),
          priority,
        }),
      });

      const data = await res.json();

      if (data.success) {
        setFormState("success");
      } else {
        setErrorMessage(data.error || "Something went wrong. Please try again.");
        setFormState("error");
      }
    } catch {
      setErrorMessage("Network error. Please check your connection and try again.");
      setFormState("error");
    }
  };

  const handleReset = () => {
    setSubject("");
    setMessage("");
    setPriority("normal");
    setFormState("idle");
    setErrorMessage("");
  };

  if (formState === "success") {
    return (
      <div className="h-full">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-[var(--ink)]">Support</h1>
            <p className="text-sm text-zinc-500 mt-1">We&apos;re here to help</p>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-[var(--line)] p-12 text-center max-w-lg mx-auto">
          <div className="w-20 h-20 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg className="w-10 h-10 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h3 className="text-xl font-semibold text-[var(--ink)] mb-2">Message sent!</h3>
          <p className="text-zinc-500 mb-8 max-w-sm mx-auto">
            We&apos;ve received your message and will respond via email within a few hours.
          </p>
          <button
            onClick={handleReset}
            className="px-6 py-3 bg-gradient-to-r from-teal-500 to-teal-600 hover:from-teal-600 hover:to-teal-700 text-white font-medium rounded-xl transition-all shadow-sm hover:shadow-md"
          >
            Send Another Message
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--ink)]">Support</h1>
          <p className="text-sm text-zinc-500 mt-1">We&apos;re here to help</p>
        </div>
      </div>

      {/* Contact Form Card */}
      <div className="bg-white rounded-2xl border border-[var(--line)] p-6">
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
          {/* Left: Context */}
          <div className="lg:col-span-2">
            <div className="w-20 h-20 bg-teal-50 rounded-full flex items-center justify-center mb-6">
              <svg className="w-10 h-10 text-teal-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-[var(--ink)] mb-2">Send us a message</h2>
            <p className="text-sm text-zinc-500 leading-relaxed mb-6">
              We typically respond within a few hours. Describe your issue in as
              much detail as possible and we&apos;ll get back to you via email.
            </p>
            {supportEmail && (
              <div className="text-sm text-zinc-400">
                <p className="mb-1">You can also email us directly at:</p>
                <a
                  href={`mailto:${supportEmail}`}
                  className="text-teal-600 hover:text-teal-700 font-medium underline underline-offset-2"
                >
                  {supportEmail}
                </a>
              </div>
            )}
          </div>

          {/* Right: Form */}
          <div className="lg:col-span-3">
            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Subject */}
              <div>
                <label htmlFor={subjectId} className="block text-sm font-medium text-zinc-700 mb-2">
                  Subject
                </label>
                <input
                  id={subjectId}
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Brief description of your issue"
                  maxLength={200}
                  disabled={isSubmitting}
                  className="w-full px-4 py-3 border border-zinc-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent text-sm transition-all disabled:opacity-50 disabled:bg-zinc-50"
                />
              </div>

              {/* Priority */}
              <fieldset>
                <legend id={priorityId} className="block text-sm font-medium text-zinc-700 mb-2">
                  Priority
                </legend>
                <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-labelledby={priorityId}>
                  <label
                    className={`relative flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 text-sm font-medium transition-all cursor-pointer ${
                      priority === "normal"
                        ? "border-teal-500 bg-teal-50 text-teal-700"
                        : "border-zinc-200 text-zinc-600 hover:border-zinc-300"
                    } ${isSubmitting ? "opacity-50 cursor-not-allowed" : ""}`}
                  >
                    <input
                      type="radio"
                      name="priority"
                      value="normal"
                      checked={priority === "normal"}
                      onChange={() => setPriority("normal")}
                      disabled={isSubmitting}
                      className="sr-only"
                    />
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Normal
                  </label>
                  <label
                    className={`relative flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 text-sm font-medium transition-all cursor-pointer ${
                      priority === "high"
                        ? "border-orange-500 bg-orange-50 text-orange-700"
                        : "border-zinc-200 text-zinc-600 hover:border-zinc-300"
                    } ${isSubmitting ? "opacity-50 cursor-not-allowed" : ""}`}
                  >
                    <input
                      type="radio"
                      name="priority"
                      value="high"
                      checked={priority === "high"}
                      onChange={() => setPriority("high")}
                      disabled={isSubmitting}
                      className="sr-only"
                    />
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    Urgent
                  </label>
                </div>
              </fieldset>

              {/* Message */}
              <div>
                <label htmlFor={messageId} className="block text-sm font-medium text-zinc-700 mb-2">
                  Message
                </label>
                <textarea
                  id={messageId}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Describe your issue in detail..."
                  rows={6}
                  maxLength={10000}
                  required
                  disabled={isSubmitting}
                  className="w-full px-4 py-3 border border-zinc-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent text-sm resize-none transition-all disabled:opacity-50 disabled:bg-zinc-50"
                />
              </div>

              {/* Error */}
              {formState === "error" && errorMessage && (
                <div className="flex items-start gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                  <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>{errorMessage}</span>
                </div>
              )}

              {/* Submit */}
              <button
                type="submit"
                disabled={!message.trim() || isSubmitting}
                aria-busy={isSubmitting}
                className="w-full px-6 py-3 bg-gradient-to-r from-teal-500 to-teal-600 hover:from-teal-600 hover:to-teal-700 text-white font-medium rounded-xl transition-all shadow-sm hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isSubmitting ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                    </svg>
                    Send Message
                  </>
                )}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
