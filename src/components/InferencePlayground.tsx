"use client";

import { useState, useRef, useEffect, useCallback } from "react";

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

interface InferencePlaygroundProps {
  subscriptionId: string;
  modelName?: string;
  onClose: () => void;
}

export default function InferencePlayground({
  subscriptionId,
  modelName,
  onClose,
}: InferencePlaygroundProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<{
    latency?: number;
    tokensPerSecond?: number;
    totalTokens?: number;
  }>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput("");
    setError(null);

    const newMessages: Message[] = [
      ...messages,
      { role: "user", content: userMessage },
    ];
    setMessages(newMessages);
    setIsLoading(true);

    const startTime = Date.now();

    try {
      const response = await fetch("/api/inference/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          subscriptionId,
          messages: newMessages,
          stream: true,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.error || `Request failed with status ${response.status}`
        );
      }

      // Handle streaming response
      if (response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let assistantMessage = "";
        let tokenCount = 0;

        // Add empty assistant message that we'll update
        setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split("\n");

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6);
              if (data === "[DONE]") continue;

              try {
                const parsed = JSON.parse(data);
                const content = parsed.choices?.[0]?.delta?.content;
                if (content) {
                  assistantMessage += content;
                  tokenCount++;

                  // Update the last message
                  setMessages((prev) => {
                    const updated = [...prev];
                    updated[updated.length - 1] = {
                      role: "assistant",
                      content: assistantMessage,
                    };
                    return updated;
                  });
                }
              } catch {
                // Skip malformed JSON
              }
            }
          }
        }

        // Calculate stats
        const latency = Date.now() - startTime;
        const tokensPerSecond =
          tokenCount > 0 ? Math.round((tokenCount / latency) * 1000) : 0;

        setStats({
          latency,
          tokensPerSecond,
          totalTokens: tokenCount,
        });
      }
    } catch (err) {
      console.error("Inference error:", err);
      setError(
        err instanceof Error ? err.message : "Failed to get response"
      );
      // Remove the empty assistant message on error
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const clearChat = () => {
    setMessages([]);
    setStats({});
    setError(null);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl h-[80vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--line)]">
          <div>
            <h2 className="text-lg font-bold text-[var(--ink)]">
              Inference Playground
            </h2>
            <p className="text-sm text-[var(--muted)]">
              {modelName || `Instance ${subscriptionId}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={clearChat}
              className="px-3 py-1.5 text-sm text-[var(--muted)] hover:text-[var(--ink)] hover:bg-zinc-100 rounded-lg transition-colors"
            >
              Clear
            </button>
            <button
              onClick={onClose}
              className="text-[var(--muted)] hover:text-[var(--ink)] p-1.5 hover:bg-zinc-100 rounded-lg transition-colors"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mb-4">
                <svg
                  className="w-8 h-8 text-blue-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                  />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-[var(--ink)] mb-2">
                Test Your Model
              </h3>
              <p className="text-sm text-[var(--muted)] max-w-sm">
                Send a message to test your deployed model. The response will
                stream in real-time.
              </p>
            </div>
          )}

          {messages.map((message, index) => (
            <div
              key={index}
              className={`flex ${
                message.role === "user" ? "justify-end" : "justify-start"
              }`}
            >
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                  message.role === "user"
                    ? "bg-blue-500 text-white"
                    : "bg-zinc-100 text-[var(--ink)]"
                }`}
              >
                <p className="whitespace-pre-wrap text-sm leading-relaxed">
                  {message.content || (
                    <span className="inline-flex items-center gap-1">
                      <span className="w-1.5 h-1.5 bg-current rounded-full animate-bounce" />
                      <span
                        className="w-1.5 h-1.5 bg-current rounded-full animate-bounce"
                        style={{ animationDelay: "0.1s" }}
                      />
                      <span
                        className="w-1.5 h-1.5 bg-current rounded-full animate-bounce"
                        style={{ animationDelay: "0.2s" }}
                      />
                    </span>
                  )}
                </p>
              </div>
            </div>
          ))}

          {error && (
            <div className="flex justify-center">
              <div className="bg-red-50 text-red-700 px-4 py-2 rounded-lg text-sm">
                {error}
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Stats */}
        {stats.latency && (
          <div className="px-6 py-2 border-t border-[var(--line)] bg-zinc-50 flex items-center gap-4 text-xs text-[var(--muted)]">
            <span>Latency: {stats.latency}ms</span>
            {stats.tokensPerSecond && (
              <span>Speed: {stats.tokensPerSecond} tok/s</span>
            )}
            {stats.totalTokens && <span>Tokens: {stats.totalTokens}</span>}
          </div>
        )}

        {/* Input */}
        <form
          onSubmit={handleSubmit}
          className="p-4 border-t border-[var(--line)]"
        >
          <div className="flex gap-3">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message... (Enter to send, Shift+Enter for new line)"
              rows={1}
              className="flex-1 resize-none px-4 py-3 border border-[var(--line)] rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
              disabled={isLoading}
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="px-5 py-3 bg-blue-500 text-white rounded-xl hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
            >
              {isLoading ? (
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                  />
                </svg>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
