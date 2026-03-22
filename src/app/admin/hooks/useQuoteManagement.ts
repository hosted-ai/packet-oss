"use client";

import { useState, useCallback } from "react";
import type { Quote, QuoteFormData, ClusterOffer, EmailPreview } from "../types";
import { EMPTY_QUOTE_FORM } from "../types";

export function useQuoteManagement(loadData: () => Promise<void>) {
  const [quoteModalOpen, setQuoteModalOpen] = useState(false);
  const [editingQuote, setEditingQuote] = useState<Quote | null>(null);
  const [quoteForm, setQuoteForm] = useState<QuoteFormData>(EMPTY_QUOTE_FORM);
  const [quoteSaving, setQuoteSaving] = useState(false);
  const [quoteViewModalOpen, setQuoteViewModalOpen] = useState(false);
  const [viewingQuote, setViewingQuote] = useState<Quote | null>(null);

  // Email preview state
  const [emailPreviewModalOpen, setEmailPreviewModalOpen] = useState(false);
  const [emailPreview, setEmailPreview] = useState<EmailPreview | null>(null);
  const [emailPreviewLoading, setEmailPreviewLoading] = useState(false);
  const [emailSending, setEmailSending] = useState(false);
  const [previewQuoteId, setPreviewQuoteId] = useState<string | null>(null);

  const openQuoteModal = useCallback((quote?: Quote) => {
    if (quote) {
      setEditingQuote(quote);
      setQuoteForm({
        customerName: quote.customerName,
        customerEmail: quote.customerEmail,
        customerCompany: quote.customerCompany || "",
        customerPhone: quote.customerPhone || "",
        gpuType: quote.gpuType,
        gpuCount: quote.gpuCount,
        gpuMemory: quote.gpuMemory || "",
        specs: {
          cpu: quote.specs?.cpu || "",
          memory: quote.specs?.memory || "",
          storage: quote.specs?.storage || "",
          network: quote.specs?.network || "",
          ethernet: quote.specs?.ethernet || "",
          interconnect: quote.specs?.interconnect || "",
          platform: quote.specs?.platform || "",
          nodeCount: quote.specs?.nodeCount || 1,
        },
        pricing: quote.pricing || {},
        location: quote.location,
        notes: quote.notes || "",
        startsAt: quote.startsAt ? quote.startsAt.split("T")[0] : "",
        expiresAt: quote.expiresAt.split("T")[0],
        sendEmail: false, // Don't resend email when editing
      });
    } else {
      setEditingQuote(null);
      // Set default expiration to 14 days from now
      const defaultExpiry = new Date();
      defaultExpiry.setDate(defaultExpiry.getDate() + 14);
      setQuoteForm({
        ...EMPTY_QUOTE_FORM,
        expiresAt: defaultExpiry.toISOString().split("T")[0],
      });
    }
    setQuoteModalOpen(true);
  }, []);

  const closeQuoteModal = useCallback(() => {
    setQuoteModalOpen(false);
    setEditingQuote(null);
    setQuoteForm(EMPTY_QUOTE_FORM);
  }, []);

  const handleSaveQuote = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setQuoteSaving(true);

    try {
      const method = editingQuote ? "PUT" : "POST";
      const body = editingQuote
        ? { id: editingQuote.id, ...quoteForm }
        : quoteForm;

      const res = await fetch("/api/admin/quotes", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (res.ok) {
        closeQuoteModal();
        loadData();
        if (!editingQuote && quoteForm.sendEmail) {
          alert(`Quote created and email sent to ${quoteForm.customerEmail}`);
        }
      } else {
        alert(data.error || "Failed to save quote");
      }
    } finally {
      setQuoteSaving(false);
    }
  }, [editingQuote, quoteForm, closeQuoteModal, loadData]);

  const handleDeleteQuote = useCallback(async (id: string) => {
    if (!confirm("Are you sure you want to delete this quote?")) return;

    try {
      const res = await fetch("/api/admin/quotes", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });

      if (res.ok) {
        loadData();
      } else {
        const data = await res.json();
        alert(data.error || "Failed to delete quote");
      }
    } catch {
      alert("Failed to delete quote");
    }
  }, [loadData]);

  const viewQuoteDetails = useCallback((quote: Quote) => {
    setViewingQuote(quote);
    setQuoteViewModalOpen(true);
  }, []);

  const closeQuoteViewModal = useCallback(() => {
    setQuoteViewModalOpen(false);
    setViewingQuote(null);
  }, []);

  const handlePreviewEmail = useCallback(async (quoteId: string) => {
    setEmailPreviewLoading(true);
    setPreviewQuoteId(quoteId);
    try {
      const res = await fetch(`/api/admin/quotes/${quoteId}/email`);
      if (res.ok) {
        const data = await res.json();
        setEmailPreview(data);
        setEmailPreviewModalOpen(true);
      } else {
        const data = await res.json();
        alert(data.error || "Failed to generate email preview");
      }
    } catch {
      alert("Failed to generate email preview");
    } finally {
      setEmailPreviewLoading(false);
    }
  }, []);

  const handleSendEmail = useCallback(async () => {
    if (!previewQuoteId) return;

    setEmailSending(true);
    try {
      const res = await fetch(`/api/admin/quotes/${previewQuoteId}/email`, {
        method: "POST",
      });
      if (res.ok) {
        alert("Email sent successfully!");
        setEmailPreviewModalOpen(false);
        setEmailPreview(null);
        setPreviewQuoteId(null);
      } else {
        const data = await res.json();
        alert(data.error || "Failed to send email");
      }
    } catch {
      alert("Failed to send email");
    } finally {
      setEmailSending(false);
    }
  }, [previewQuoteId]);

  const closeEmailPreviewModal = useCallback(() => {
    setEmailPreviewModalOpen(false);
    setEmailPreview(null);
    setPreviewQuoteId(null);
  }, []);

  const prefillQuoteFromCluster = useCallback((clusterId: string, clusterOffers: ClusterOffer[]) => {
    const cluster = clusterOffers.find((c) => c.id === clusterId);
    if (!cluster) return;

    setQuoteForm((prev) => ({
      ...prev,
      gpuType: cluster.gpuType,
      gpuCount: cluster.gpuCount,
      gpuMemory: cluster.gpuMemory || "",
      specs: {
        cpu: cluster.specs?.cpu || "",
        memory: cluster.specs?.memory || "",
        storage: cluster.specs?.storage || "",
        network: cluster.specs?.network || "",
        ethernet: cluster.specs?.ethernet || "",
        interconnect: cluster.specs?.interconnect || "",
        platform: cluster.specs?.platform || "",
        nodeCount: cluster.specs?.nodeCount || 1,
      },
      pricing: cluster.pricing || {},
      location: cluster.location,
    }));
  }, []);

  const copyQuoteUrl = useCallback((quote: Quote) => {
    const url = `${window.location.origin}/quote/${quote.token}`;
    navigator.clipboard.writeText(url);
    alert("Quote URL copied to clipboard!");
  }, []);

  return {
    quoteModalOpen,
    editingQuote,
    quoteForm,
    quoteSaving,
    quoteViewModalOpen,
    viewingQuote,
    emailPreviewModalOpen,
    emailPreview,
    emailPreviewLoading,
    emailSending,
    previewQuoteId,
    setQuoteForm,
    openQuoteModal,
    closeQuoteModal,
    handleSaveQuote,
    handleDeleteQuote,
    viewQuoteDetails,
    closeQuoteViewModal,
    handlePreviewEmail,
    handleSendEmail,
    closeEmailPreviewModal,
    prefillQuoteFromCluster,
    copyQuoteUrl,
  };
}
