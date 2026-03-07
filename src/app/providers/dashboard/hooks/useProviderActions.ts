"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import type { NodeFormData, ProviderProfile } from "../types";

export function useProviderActions(
  refreshNodes: () => void,
  setProfile: (profile: ProviderProfile) => void
) {
  const router = useRouter();
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [addNodeModalOpen, setAddNodeModalOpen] = useState(false);
  const [nodeForm, setNodeForm] = useState<NodeFormData>({
    ipAddress: "",
    sshPort: "22",
    sshUsername: "root",
    sshPassword: "",
    hostname: "",
    datacenter: "",
    region: "",
    country: "",
    gpuModel: "",
    gpuCount: "",
  });
  const [nodeSaving, setNodeSaving] = useState(false);
  const [nodeError, setNodeError] = useState<string | null>(null);

  const handleAddNode = async () => {
    setNodeSaving(true);
    setNodeError(null);

    try {
      const response = await fetch("/api/providers/nodes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          ipAddress: nodeForm.ipAddress,
          sshPort: parseInt(nodeForm.sshPort),
          sshUsername: nodeForm.sshUsername,
          sshPassword: nodeForm.sshPassword,
          hostname: nodeForm.hostname || undefined,
          datacenter: nodeForm.datacenter || undefined,
          region: nodeForm.region || undefined,
          country: nodeForm.country || undefined,
          gpuModel: nodeForm.gpuModel,
          gpuCount: parseInt(nodeForm.gpuCount),
        }),
      });

      const data = await response.json();

      if (data.success) {
        setAddNodeModalOpen(false);
        setNodeForm({
          ipAddress: "",
          sshPort: "22",
          sshUsername: "root",
          sshPassword: "",
          hostname: "",
          datacenter: "",
          region: "",
          country: "",
          gpuModel: "",
          gpuCount: "",
        });
        refreshNodes();
      } else {
        setNodeError(data.error || "Failed to add server");
      }
    } catch {
      setNodeError("Something went wrong. Please try again.");
    } finally {
      setNodeSaving(false);
    }
  };

  const handleRemoveNode = async (nodeId: string, reason?: string) => {
    setActionLoading(nodeId);

    try {
      const response = await fetch(`/api/providers/nodes/${nodeId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ reason }),
      });

      const data = await response.json();

      if (data.success) {
        refreshNodes();
      } else {
        alert(data.error || "Failed to remove server");
      }
    } catch {
      alert("Something went wrong. Please try again.");
    } finally {
      setActionLoading(null);
    }
  };

  const handleCancelRemoval = async (nodeId: string) => {
    setActionLoading(nodeId);

    try {
      const response = await fetch(`/api/providers/nodes/${nodeId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action: "cancel-removal" }),
      });

      const data = await response.json();

      if (data.success) {
        refreshNodes();
      } else {
        alert(data.error || "Failed to cancel removal");
      }
    } catch {
      alert("Something went wrong. Please try again.");
    } finally {
      setActionLoading(null);
    }
  };

  const handleUpdateProfile = async (updates: Partial<ProviderProfile>) => {
    setActionLoading("profile");

    try {
      const response = await fetch("/api/providers/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(updates),
      });

      const data = await response.json();

      if (data.success) {
        setProfile(data.data);
        return true;
      } else {
        alert(data.error || "Failed to update profile");
        return false;
      }
    } catch {
      alert("Something went wrong. Please try again.");
      return false;
    } finally {
      setActionLoading(null);
    }
  };

  const handleLogout = useCallback(async () => {
    try {
      await fetch("/api/providers/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action: "logout" }),
      });
      router.push("/providers");
    } catch {
      router.push("/providers");
    }
  }, [router]);

  const openAddNodeModal = () => {
    setNodeError(null);
    setAddNodeModalOpen(true);
  };

  const closeAddNodeModal = () => {
    setAddNodeModalOpen(false);
    setNodeForm({
      ipAddress: "",
      sshPort: "22",
      sshUsername: "root",
      sshPassword: "",
      hostname: "",
      datacenter: "",
      region: "",
      country: "",
      gpuModel: "",
      gpuCount: "",
    });
    setNodeError(null);
  };

  return {
    actionLoading,
    addNodeModalOpen,
    nodeForm,
    setNodeForm,
    nodeSaving,
    nodeError,
    handleAddNode,
    handleRemoveNode,
    handleCancelRemoval,
    handleUpdateProfile,
    handleLogout,
    openAddNodeModal,
    closeAddNodeModal,
  };
}
