"use client";

import { useState, useCallback } from "react";
import type { InfrastructureRequest, InfrastructureRequestFormData } from "../types";
import { EMPTY_INFRASTRUCTURE_REQUEST_FORM } from "../types";

export function useInfrastructureRequestManagement(loadData: () => Promise<void>) {
  const [requestModalOpen, setRequestModalOpen] = useState(false);
  const [editingRequest, setEditingRequest] = useState<InfrastructureRequest | null>(null);
  const [requestForm, setRequestForm] = useState<InfrastructureRequestFormData>(EMPTY_INFRASTRUCTURE_REQUEST_FORM);
  const [requestSaving, setRequestSaving] = useState(false);
  const [locationInput, setLocationInput] = useState("");

  const openRequestModal = useCallback((request?: InfrastructureRequest) => {
    if (request) {
      setEditingRequest(request);
      setRequestForm({
        title: request.title,
        description: request.description,
        gpuType: request.gpuType,
        gpuCountMin: request.gpuCountMin,
        gpuCountMax: request.gpuCountMax ?? null,
        gpuMemoryMin: request.gpuMemoryMin || "",
        nodeCountMin: request.nodeCountMin,
        nodeCountMax: request.nodeCountMax ?? null,
        specs: {
          cpuMin: request.specs?.cpuMin || "",
          memoryMin: request.specs?.memoryMin || "",
          storageMin: request.specs?.storageMin || "",
          networkMin: request.specs?.networkMin || "",
          interconnect: request.specs?.interconnect || "",
        },
        targetPricing: request.targetPricing || {},
        preferredContractLength: request.preferredContractLength,
        minContractLength: request.minContractLength,
        preferredLocations: request.preferredLocations || [],
        acceptableLocations: request.acceptableLocations || [],
        neededBy: request.neededBy || "",
        urgency: request.urgency,
        status: request.status,
        featured: request.featured,
        sortOrder: request.sortOrder,
        internalNotes: request.internalNotes || "",
      });
    } else {
      setEditingRequest(null);
      setRequestForm(EMPTY_INFRASTRUCTURE_REQUEST_FORM);
    }
    setLocationInput("");
    setRequestModalOpen(true);
  }, []);

  const closeRequestModal = useCallback(() => {
    setRequestModalOpen(false);
    setEditingRequest(null);
    setRequestForm(EMPTY_INFRASTRUCTURE_REQUEST_FORM);
    setLocationInput("");
  }, []);

  const handleSaveRequest = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setRequestSaving(true);

    try {
      const method = editingRequest ? "PUT" : "POST";
      const body = editingRequest
        ? { id: editingRequest.id, ...requestForm }
        : requestForm;

      const res = await fetch("/api/admin/infrastructure-requests", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (res.ok) {
        closeRequestModal();
        loadData();
      } else {
        alert(data.error || "Failed to save infrastructure request");
      }
    } finally {
      setRequestSaving(false);
    }
  }, [editingRequest, requestForm, closeRequestModal, loadData]);

  const handleDeleteRequest = useCallback(async (id: string) => {
    if (!confirm("Are you sure you want to delete this infrastructure request?")) return;

    try {
      const res = await fetch("/api/admin/infrastructure-requests", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });

      if (res.ok) {
        loadData();
      } else {
        const data = await res.json();
        alert(data.error || "Failed to delete infrastructure request");
      }
    } catch {
      alert("Failed to delete infrastructure request");
    }
  }, [loadData]);

  const addLocation = useCallback((type: "preferred" | "acceptable") => {
    if (!locationInput.trim()) return;
    const location = locationInput.trim();

    setRequestForm((prev) => {
      if (type === "preferred") {
        return {
          ...prev,
          preferredLocations: [...prev.preferredLocations, location],
        };
      } else {
        return {
          ...prev,
          acceptableLocations: [...prev.acceptableLocations, location],
        };
      }
    });
    setLocationInput("");
  }, [locationInput]);

  const removeLocation = useCallback((type: "preferred" | "acceptable", index: number) => {
    setRequestForm((prev) => {
      if (type === "preferred") {
        return {
          ...prev,
          preferredLocations: prev.preferredLocations.filter((_, i) => i !== index),
        };
      } else {
        return {
          ...prev,
          acceptableLocations: prev.acceptableLocations.filter((_, i) => i !== index),
        };
      }
    });
  }, []);

  return {
    requestModalOpen,
    editingRequest,
    requestForm,
    requestSaving,
    locationInput,
    setRequestForm,
    setLocationInput,
    openRequestModal,
    closeRequestModal,
    handleSaveRequest,
    handleDeleteRequest,
    addLocation,
    removeLocation,
  };
}
