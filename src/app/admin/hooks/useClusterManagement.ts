"use client";

import { useState, useCallback } from "react";
import type { ClusterOffer, ClusterFormData } from "../types";
import { EMPTY_CLUSTER_FORM } from "../types";

export function useClusterManagement(loadData: () => Promise<void>) {
  const [clusterModalOpen, setClusterModalOpen] = useState(false);
  const [editingCluster, setEditingCluster] = useState<ClusterOffer | null>(null);
  const [clusterForm, setClusterForm] = useState<ClusterFormData>(EMPTY_CLUSTER_FORM);
  const [clusterSaving, setClusterSaving] = useState(false);
  const [highlightInput, setHighlightInput] = useState("");
  const [imageUploading, setImageUploading] = useState(false);

  const openClusterModal = useCallback((offer?: ClusterOffer) => {
    if (offer) {
      setEditingCluster(offer);
      setClusterForm({
        name: offer.name,
        description: offer.description,
        image: offer.image || "",
        gpuType: offer.gpuType,
        gpuCount: offer.gpuCount,
        gpuMemory: offer.gpuMemory || "",
        specs: {
          cpu: offer.specs?.cpu || "",
          memory: offer.specs?.memory || "",
          storage: offer.specs?.storage || "",
          network: offer.specs?.network || "",
          ethernet: offer.specs?.ethernet || "",
          interconnect: offer.specs?.interconnect || "",
          platform: offer.specs?.platform || "",
          nodeCount: offer.specs?.nodeCount,
        },
        pricing: offer.pricing || {},
        location: offer.location,
        region: offer.region || "",
        availability: offer.availability,
        featured: offer.featured,
        sortOrder: offer.sortOrder,
        highlights: offer.highlights || [],
      });
    } else {
      setEditingCluster(null);
      setClusterForm(EMPTY_CLUSTER_FORM);
    }
    setHighlightInput("");
    setClusterModalOpen(true);
  }, []);

  const closeClusterModal = useCallback(() => {
    setClusterModalOpen(false);
    setEditingCluster(null);
    setClusterForm(EMPTY_CLUSTER_FORM);
    setHighlightInput("");
  }, []);

  const handleImageUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImageUploading(true);
    try {
      const formData = new FormData();
      formData.append("image", file);

      const res = await fetch("/api/admin/cluster-offers/upload-image", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (res.ok && data.imageUrl) {
        setClusterForm((prev) => ({ ...prev, image: data.imageUrl }));
      } else {
        alert(data.error || "Failed to upload image");
      }
    } catch {
      alert("Failed to upload image");
    } finally {
      setImageUploading(false);
    }
  }, []);

  const handleSaveCluster = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setClusterSaving(true);

    try {
      const method = editingCluster ? "PUT" : "POST";
      const body = editingCluster
        ? { id: editingCluster.id, ...clusterForm }
        : clusterForm;

      const res = await fetch("/api/admin/cluster-offers", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (res.ok) {
        closeClusterModal();
        loadData();
      } else {
        alert(data.error || "Failed to save cluster offer");
      }
    } finally {
      setClusterSaving(false);
    }
  }, [editingCluster, clusterForm, closeClusterModal, loadData]);

  const handleDeleteCluster = useCallback(async (id: string) => {
    if (!confirm("Are you sure you want to delete this cluster offer?")) return;

    try {
      const res = await fetch("/api/admin/cluster-offers", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });

      if (res.ok) {
        loadData();
      } else {
        const data = await res.json();
        alert(data.error || "Failed to delete cluster offer");
      }
    } catch {
      alert("Failed to delete cluster offer");
    }
  }, [loadData]);

  const addHighlight = useCallback(() => {
    if (!highlightInput.trim()) return;
    setClusterForm((prev) => ({
      ...prev,
      highlights: [...(prev.highlights || []), highlightInput.trim()],
    }));
    setHighlightInput("");
  }, [highlightInput]);

  const removeHighlight = useCallback((index: number) => {
    setClusterForm((prev) => ({
      ...prev,
      highlights: prev.highlights?.filter((_, i) => i !== index) || [],
    }));
  }, []);

  const removeImage = useCallback(() => {
    setClusterForm((prev) => ({ ...prev, image: "" }));
  }, []);

  return {
    clusterModalOpen,
    editingCluster,
    clusterForm,
    clusterSaving,
    highlightInput,
    imageUploading,
    setClusterForm,
    setHighlightInput,
    openClusterModal,
    closeClusterModal,
    handleImageUpload,
    handleSaveCluster,
    handleDeleteCluster,
    addHighlight,
    removeHighlight,
    removeImage,
  };
}
