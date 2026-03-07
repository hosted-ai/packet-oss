"use client";

import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";

interface Ticket {
  id: string;
  ticketNumber: string | null;
  title: string;
  status: "open" | "closed";
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string | null;
  lastMessage: string | null;
  isArchived: boolean;
  hasUnreadReply?: boolean;
}

// Debounce hook for search input
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}

interface Message {
  id: number;
  content: string;
  isFromCustomer: boolean;
  isBot: boolean;
  createdAt: string;
  attachments: Array<{
    filename: string;
    url: string;
    mime: string;
    size: number;
  }>;
}

interface SupportTabProps {
  token: string;
  initialTicketId?: string | null;
}

export function SupportTab({ token, initialTicketId }: SupportTabProps) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTicket, setSelectedTicket] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [newMessage, setNewMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [showNewTicketModal, setShowNewTicketModal] = useState(false);
  const [newTicketSubject, setNewTicketSubject] = useState("");
  const [newTicketMessage, setNewTicketMessage] = useState("");
  const [newTicketPriority, setNewTicketPriority] = useState<"normal" | "high">("normal");
  const [creating, setCreating] = useState(false);
  const [closing, setClosing] = useState(false);
  const [filter, setFilter] = useState<"all" | "open" | "closed">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const debouncedSearch = useDebounce(searchQuery, 300);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback((smooth = true) => {
    if (messagesContainerRef.current) {
      const container = messagesContainerRef.current;
      if (smooth) {
        container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
      } else {
        container.scrollTop = container.scrollHeight;
      }
    }
  }, []);

  // Strip HTML tags for clean display
  const stripHtml = (html: string) => {
    let text = html.replace(/<[^>]*>/g, '');
    text = text.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    text = text.replace(/\s+/g, ' ').trim();
    return text;
  };

  // Highlight search matches in text
  const highlightMatch = (text: string, query: string) => {
    if (!query.trim()) return text;
    const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    const parts = text.split(regex);
    return parts.map((part, i) =>
      regex.test(part) ? (
        <mark key={i} className="bg-yellow-200 text-yellow-900 rounded px-0.5">
          {part}
        </mark>
      ) : (
        part
      )
    );
  };

  const fetchTickets = useCallback(async () => {
    try {
      const res = await fetch("/api/support/tickets", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) {
        setTickets(data.tickets);
      } else {
        setError(data.error || "Failed to load tickets");
      }
    } catch {
      setError("Failed to load support tickets");
    } finally {
      setLoading(false);
    }
  }, [token]);

  const fetchMessages = useCallback(async (ticketId: string, showLoading = true) => {
    if (showLoading) setMessagesLoading(true);
    try {
      const res = await fetch(`/api/support/tickets/${ticketId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) {
        setMessages(data.messages);
      }
    } catch {
      // Handle error silently
    } finally {
      if (showLoading) setMessagesLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchTickets();
  }, [fetchTickets]);

  useEffect(() => {
    if (!loading && tickets.length > 0 && !selectedTicket) {
      if (initialTicketId && tickets.some(t => t.id === initialTicketId)) {
        setSelectedTicket(initialTicketId);
      } else {
        setSelectedTicket(tickets[0].id);
      }
    }
  }, [loading, tickets, selectedTicket, initialTicketId]);

  useEffect(() => {
    if (selectedTicket) {
      fetchMessages(selectedTicket, true).then(() => {
        // Use setTimeout to ensure DOM has updated before scrolling
        setTimeout(() => scrollToBottom(false), 50);
      });
      const interval = setInterval(() => {
        fetchMessages(selectedTicket, false);
      }, 10000);
      return () => clearInterval(interval);
    }
  }, [selectedTicket, fetchMessages, scrollToBottom]);

  const handleCloseTicket = async () => {
    if (!selectedTicket) return;
    if (!confirm("Close this ticket? You can always create a new one if you need more help.")) return;

    setClosing(true);
    try {
      const res = await fetch(`/api/support/tickets/${selectedTicket}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ action: "close" }),
      });
      const data = await res.json();
      if (data.success) {
        fetchTickets();
        setTickets((prev) =>
          prev.map((t) =>
            t.id === selectedTicket ? { ...t, status: "closed" as const } : t
          )
        );
      } else {
        alert(data.error || "Failed to close ticket");
      }
    } catch {
      alert("Failed to close ticket");
    } finally {
      setClosing(false);
    }
  };

  const handleSendMessage = async () => {
    if (!newMessage.trim() || !selectedTicket) return;

    setSending(true);
    try {
      const res = await fetch(`/api/support/tickets/${selectedTicket}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ message: newMessage }),
      });
      const data = await res.json();
      if (data.success) {
        setMessages((prev) => [...prev, data.message]);
        setNewMessage("");
        setTimeout(() => scrollToBottom(true), 50);
        fetchTickets();
        // Reset textarea height
        if (textareaRef.current) {
          textareaRef.current.style.height = 'auto';
        }
      }
    } catch {
      // Handle error
    } finally {
      setSending(false);
    }
  };

  const handleCreateTicket = async () => {
    if (!newTicketMessage.trim()) return;

    setCreating(true);
    try {
      const res = await fetch("/api/support/tickets", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          subject: newTicketSubject,
          message: newTicketMessage,
          priority: newTicketPriority,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setShowNewTicketModal(false);
        setNewTicketSubject("");
        setNewTicketMessage("");
        setNewTicketPriority("normal");
        setSelectedTicket(data.ticket.id);
        fetchTickets();
      }
    } catch {
      // Handle error
    } finally {
      setCreating(false);
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHrs = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHrs < 24) return `${diffHrs}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  const formatMessageTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  };

  // Auto-resize textarea
  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setNewMessage(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
  };

  // Filter and search tickets
  const filteredTickets = useMemo(() => {
    let result = tickets;

    // Apply status filter
    if (filter !== "all") {
      result = result.filter(t => t.status === filter);
    }

    // Apply search filter (searches ticket number, title, and last message)
    if (debouncedSearch.trim()) {
      const query = debouncedSearch.toLowerCase().trim();
      result = result.filter(t => {
        const ticketNum = t.ticketNumber?.toLowerCase() || "";
        const title = t.title.toLowerCase();
        const lastMsg = t.lastMessage?.toLowerCase() || "";
        return ticketNum.includes(query) || title.includes(query) || lastMsg.includes(query);
      });
    }

    return result;
  }, [tickets, filter, debouncedSearch]);

  // Show searching indicator when typing
  useEffect(() => {
    if (searchQuery !== debouncedSearch) {
      setIsSearching(true);
    } else {
      setIsSearching(false);
    }
  }, [searchQuery, debouncedSearch]);

  const openCount = tickets.filter(t => t.status === "open").length;
  const selectedTicketData = tickets.find((t) => t.id === selectedTicket);

  // Keyboard shortcut for search (Cmd/Ctrl + K)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
      // Escape to clear search
      if (e.key === "Escape" && document.activeElement === searchInputRef.current) {
        setSearchQuery("");
        searchInputRef.current?.blur();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[500px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-10 w-10 border-2 border-teal-500 border-t-transparent mx-auto mb-4"></div>
          <p className="text-zinc-500">Loading support tickets...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center">
        <svg className="w-12 h-12 text-red-400 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        <p className="text-red-700 font-medium">{error}</p>
        <button onClick={fetchTickets} className="mt-4 text-sm text-red-600 hover:text-red-800 underline">
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--ink)]">Support</h1>
          <p className="text-sm text-zinc-500 mt-1">
            {openCount > 0 ? `${openCount} open ticket${openCount !== 1 ? 's' : ''}` : 'We\'re here to help'}
          </p>
        </div>
        <button
          onClick={() => setShowNewTicketModal(true)}
          className="px-5 py-2.5 bg-gradient-to-r from-teal-500 to-teal-600 hover:from-teal-600 hover:to-teal-700 text-white font-medium rounded-xl transition-all shadow-sm hover:shadow-md flex items-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Ticket
        </button>
      </div>

      {tickets.length === 0 ? (
        /* Empty State */
        <div className="bg-white rounded-2xl border border-[var(--line)] p-12 text-center">
          <div className="w-20 h-20 bg-teal-50 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg className="w-10 h-10 text-teal-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </div>
          <h3 className="text-xl font-semibold text-[var(--ink)] mb-2">No support tickets yet</h3>
          <p className="text-zinc-500 mb-6 max-w-sm mx-auto">
            Have a question or need help? Our support team typically responds within a few hours.
          </p>
          <button
            onClick={() => setShowNewTicketModal(true)}
            className="px-6 py-3 bg-teal-500 hover:bg-teal-600 text-white font-medium rounded-xl transition-colors"
          >
            Create Your First Ticket
          </button>
        </div>
      ) : (
        /* Main Content */
        <div className="grid grid-cols-12 gap-6 h-[calc(100vh-240px)] min-h-[500px]">
          {/* Ticket List - Left Panel */}
          <div className="col-span-4 bg-white rounded-2xl border border-[var(--line)] flex flex-col overflow-hidden">
            {/* Search Input */}
            <div className="p-3 border-b border-[var(--line)] bg-zinc-50/50">
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  {isSearching ? (
                    <div className="w-4 h-4 border-2 border-zinc-300 border-t-teal-500 rounded-full animate-spin" />
                  ) : (
                    <svg className="w-4 h-4 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  )}
                </div>
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search tickets..."
                  className="w-full pl-10 pr-20 py-2.5 text-sm border border-zinc-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent bg-white transition-all placeholder:text-zinc-400"
                />
                {searchQuery ? (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="absolute inset-y-0 right-3 flex items-center text-zinc-400 hover:text-zinc-600 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                ) : (
                  <div className="absolute inset-y-0 right-3 flex items-center">
                    <kbd className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium text-zinc-400 bg-zinc-100 rounded-md border border-zinc-200">
                      <span className="text-xs">⌘</span>K
                    </kbd>
                  </div>
                )}
              </div>
            </div>

            {/* Filter Tabs */}
            <div className="px-3 py-2 border-b border-[var(--line)] flex gap-1 bg-white">
              {(["all", "open", "closed"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`flex-1 px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                    filter === f
                      ? "bg-zinc-100 text-[var(--ink)]"
                      : "text-zinc-500 hover:text-zinc-700 hover:bg-zinc-50"
                  }`}
                >
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                  {f === "open" && openCount > 0 && (
                    <span className="ml-1.5 px-1.5 py-0.5 text-xs bg-teal-100 text-teal-700 rounded-full">
                      {openCount}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Ticket List */}
            <div className="flex-1 overflow-y-auto">
              {filteredTickets.length === 0 ? (
                <div className="p-6 text-center">
                  {debouncedSearch ? (
                    <div className="text-zinc-400">
                      <svg className="w-10 h-10 mx-auto mb-3 text-zinc-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                      <p className="font-medium text-zinc-500">No tickets found</p>
                      <p className="text-sm mt-1">No results for &quot;{debouncedSearch}&quot;</p>
                      <button
                        onClick={() => setSearchQuery("")}
                        className="mt-3 text-sm text-teal-600 hover:text-teal-700 font-medium"
                      >
                        Clear search
                      </button>
                    </div>
                  ) : (
                    <p className="text-zinc-400">No {filter !== "all" ? filter : ""} tickets</p>
                  )}
                </div>
              ) : (
                filteredTickets.map((ticket) => {
                  const displayTitle = ticket.ticketNumber && ticket.title.startsWith(ticket.ticketNumber)
                    ? ticket.title.slice(ticket.ticketNumber.length + 2).trim() || "Support Ticket"
                    : ticket.title;
                  const isSelected = selectedTicket === ticket.id;

                  return (
                    <button
                      key={ticket.id}
                      onClick={() => setSelectedTicket(ticket.id)}
                      className={`w-full p-4 text-left border-b border-[var(--line)] last:border-b-0 transition-all ${
                        isSelected
                          ? "bg-teal-50/70 border-l-3 border-l-teal-500"
                          : "hover:bg-zinc-50"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            {ticket.ticketNumber && (
                              <span className="text-xs font-mono text-zinc-400">
                                {debouncedSearch ? highlightMatch(ticket.ticketNumber, debouncedSearch) : ticket.ticketNumber}
                              </span>
                            )}
                            {ticket.hasUnreadReply && (
                              <span className="w-2 h-2 bg-teal-500 rounded-full"></span>
                            )}
                          </div>
                          <span className={`font-medium block truncate ${isSelected ? 'text-teal-900' : 'text-[var(--ink)]'}`}>
                            {debouncedSearch ? highlightMatch(displayTitle, debouncedSearch) : displayTitle}
                          </span>
                        </div>
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${
                            ticket.status === "open"
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-zinc-100 text-zinc-500"
                          }`}
                        >
                          {ticket.status}
                        </span>
                      </div>
                      {ticket.lastMessage && (
                        <p className="text-sm text-zinc-500 truncate mb-1.5">
                          {debouncedSearch ? highlightMatch(stripHtml(ticket.lastMessage), debouncedSearch) : stripHtml(ticket.lastMessage)}
                        </p>
                      )}
                      <p className="text-xs text-zinc-400">
                        {ticket.lastMessageAt ? formatDate(ticket.lastMessageAt) : formatDate(ticket.createdAt)}
                      </p>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Conversation Panel - Right */}
          <div className="col-span-8 bg-white rounded-2xl border border-[var(--line)] flex flex-col overflow-hidden">
            {selectedTicket && selectedTicketData ? (
              <>
                {/* Ticket Header */}
                <div className="p-5 border-b border-[var(--line)] bg-gradient-to-r from-zinc-50 to-white">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-2">
                        {selectedTicketData.ticketNumber && (
                          <span className="text-xs font-mono bg-zinc-100 text-zinc-600 px-2.5 py-1 rounded-md">
                            {selectedTicketData.ticketNumber}
                          </span>
                        )}
                        <span
                          className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                            selectedTicketData.status === "open"
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-zinc-100 text-zinc-500"
                          }`}
                        >
                          {selectedTicketData.status === "open" ? "Open" : "Resolved"}
                        </span>
                      </div>
                      <h3 className="text-lg font-semibold text-[var(--ink)] truncate">
                        {selectedTicketData.ticketNumber && selectedTicketData.title.startsWith(selectedTicketData.ticketNumber)
                          ? selectedTicketData.title.slice(selectedTicketData.ticketNumber.length + 2).trim() || "Support Ticket"
                          : selectedTicketData.title}
                      </h3>
                      <p className="text-sm text-zinc-500 mt-1">
                        Created {formatDate(selectedTicketData.createdAt)}
                      </p>
                    </div>
                    {selectedTicketData.status === "open" && (
                      <button
                        onClick={handleCloseTicket}
                        disabled={closing}
                        className="ml-4 px-4 py-2 text-sm font-medium rounded-xl border border-zinc-200 text-zinc-600 hover:bg-zinc-50 hover:border-zinc-300 transition-all disabled:opacity-50 flex items-center gap-2"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        {closing ? "Closing..." : "Mark Resolved"}
                      </button>
                    )}
                  </div>
                </div>

                {/* Messages Area */}
                <div ref={messagesContainerRef} className="flex-1 p-5 overflow-y-auto bg-gradient-to-b from-zinc-50/50 to-white">
                  {messagesLoading ? (
                    <div className="flex items-center justify-center h-full">
                      <div className="animate-spin rounded-full h-8 w-8 border-2 border-teal-500 border-t-transparent"></div>
                    </div>
                  ) : messages.length === 0 ? (
                    <div className="flex items-center justify-center h-full text-zinc-400">
                      <p>No messages yet</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {messages.map((msg, idx) => {
                        const showDate = idx === 0 ||
                          new Date(msg.createdAt).toDateString() !== new Date(messages[idx - 1].createdAt).toDateString();

                        return (
                          <React.Fragment key={msg.id}>
                            {showDate && (
                              <div className="flex items-center justify-center my-4">
                                <span className="text-xs text-zinc-400 bg-white px-3 py-1 rounded-full border border-zinc-100">
                                  {new Date(msg.createdAt).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}
                                </span>
                              </div>
                            )}
                            <div className={`flex ${msg.isFromCustomer ? "justify-end" : "justify-start"}`}>
                              <div className={`max-w-[75%] ${msg.isFromCustomer ? "order-2" : "order-1"}`}>
                                <div
                                  className={`rounded-2xl px-4 py-3 ${
                                    msg.isFromCustomer
                                      ? "bg-gradient-to-br from-teal-500 to-teal-600 text-white rounded-br-md"
                                      : "bg-white border border-zinc-100 text-zinc-800 rounded-bl-md shadow-sm"
                                  }`}
                                >
                                  <p className="text-sm whitespace-pre-wrap leading-relaxed">{stripHtml(msg.content)}</p>
                                </div>
                                <p className={`text-xs mt-1.5 ${msg.isFromCustomer ? "text-right text-zinc-400" : "text-zinc-400"}`}>
                                  {!msg.isFromCustomer && <span className="font-medium text-zinc-600 mr-2">Support</span>}
                                  {formatMessageTime(msg.createdAt)}
                                </p>
                              </div>
                            </div>
                          </React.Fragment>
                        );
                      })}
                      <div ref={messagesEndRef} />
                    </div>
                  )}
                </div>

                {/* Reply Input */}
                {selectedTicketData.status === "open" ? (
                  <div className="p-4 border-t border-[var(--line)] bg-white">
                    <div className="flex gap-3 items-end">
                      <div className="flex-1 relative">
                        <textarea
                          ref={textareaRef}
                          value={newMessage}
                          onChange={handleTextareaChange}
                          placeholder="Type your message..."
                          rows={1}
                          className="w-full px-4 py-3 border border-zinc-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent text-sm resize-none transition-all"
                          style={{ minHeight: '44px', maxHeight: '120px' }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                              e.preventDefault();
                              handleSendMessage();
                            }
                          }}
                        />
                      </div>
                      <button
                        onClick={handleSendMessage}
                        disabled={!newMessage.trim() || sending}
                        className="px-5 py-3 bg-gradient-to-r from-teal-500 to-teal-600 text-white rounded-xl hover:from-teal-600 hover:to-teal-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-sm"
                      >
                        {sending ? (
                          <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        ) : (
                          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                          </svg>
                        )}
                        <span className="font-medium">Send</span>
                      </button>
                    </div>
                    <p className="text-xs text-zinc-400 mt-2 text-center">
                      Press Enter to send, Shift+Enter for new line
                    </p>
                  </div>
                ) : (
                  <div className="p-5 border-t border-[var(--line)] bg-zinc-50 text-center">
                    <div className="flex items-center justify-center gap-2 text-zinc-500">
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      <span>This ticket has been resolved</span>
                    </div>
                    <button
                      onClick={() => setShowNewTicketModal(true)}
                      className="mt-3 text-sm text-teal-600 hover:text-teal-700 font-medium"
                    >
                      Need more help? Create a new ticket
                    </button>
                  </div>
                )}
              </>
            ) : (
              /* No Ticket Selected */
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center p-8">
                  <div className="w-16 h-16 bg-zinc-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg className="w-8 h-8 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                  </div>
                  <p className="text-zinc-500 mb-1">Select a ticket to view the conversation</p>
                  <p className="text-sm text-zinc-400">or create a new one to get help</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* New Ticket Modal */}
      {showNewTicketModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div
            className="bg-white rounded-2xl w-full max-w-lg shadow-2xl transform transition-all"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between p-6 border-b border-zinc-100">
              <div>
                <h3 className="text-xl font-semibold text-[var(--ink)]">New Support Ticket</h3>
                <p className="text-sm text-zinc-500 mt-1">We typically respond within a few hours</p>
              </div>
              <button
                onClick={() => setShowNewTicketModal(false)}
                className="p-2 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 rounded-lg transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-5">
              {/* Subject */}
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-2">
                  Subject
                </label>
                <input
                  type="text"
                  value={newTicketSubject}
                  onChange={(e) => setNewTicketSubject(e.target.value)}
                  placeholder="Brief description of your issue"
                  className="w-full px-4 py-3 border border-zinc-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent text-sm transition-all"
                />
              </div>

              {/* Priority */}
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-2">
                  Priority
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setNewTicketPriority("normal")}
                    className={`px-4 py-3 rounded-xl border-2 text-sm font-medium transition-all ${
                      newTicketPriority === "normal"
                        ? "border-teal-500 bg-teal-50 text-teal-700"
                        : "border-zinc-200 text-zinc-600 hover:border-zinc-300"
                    }`}
                  >
                    <span className="flex items-center justify-center gap-2">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      Normal
                    </span>
                    <span className="text-xs font-normal opacity-70 block mt-1">Standard response time</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewTicketPriority("high")}
                    className={`px-4 py-3 rounded-xl border-2 text-sm font-medium transition-all ${
                      newTicketPriority === "high"
                        ? "border-orange-500 bg-orange-50 text-orange-700"
                        : "border-zinc-200 text-zinc-600 hover:border-zinc-300"
                    }`}
                  >
                    <span className="flex items-center justify-center gap-2">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      Urgent
                    </span>
                    <span className="text-xs font-normal opacity-70 block mt-1">Production issue or blocker</span>
                  </button>
                </div>
              </div>

              {/* Message */}
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-2">
                  How can we help?
                </label>
                <textarea
                  value={newTicketMessage}
                  onChange={(e) => setNewTicketMessage(e.target.value)}
                  placeholder="Describe your issue in detail. Include any relevant error messages, steps to reproduce, or screenshots..."
                  rows={5}
                  className="w-full px-4 py-3 border border-zinc-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent text-sm resize-none transition-all"
                />
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex gap-3 p-6 border-t border-zinc-100 bg-zinc-50/50 rounded-b-2xl">
              <button
                onClick={() => setShowNewTicketModal(false)}
                className="flex-1 px-5 py-3 border border-zinc-200 rounded-xl hover:bg-zinc-100 transition-colors text-sm font-medium text-zinc-700"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateTicket}
                disabled={!newTicketMessage.trim() || creating}
                className="flex-1 px-5 py-3 bg-gradient-to-r from-teal-500 to-teal-600 text-white rounded-xl hover:from-teal-600 hover:to-teal-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium shadow-sm"
              >
                {creating ? (
                  <span className="flex items-center justify-center gap-2">
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Creating...
                  </span>
                ) : (
                  "Submit Ticket"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
