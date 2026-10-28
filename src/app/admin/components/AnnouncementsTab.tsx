"use client";

import { useState, useEffect } from "react";
import { AnnouncementMessage } from "@/components/AnnouncementMessage";
import { htmlToMarkdown } from "@/lib/announcements/html-to-markdown";

interface DashboardAnnouncement {
  id: string;
  title: string;
  message: string;
  displayType: string;
  targetType: string;
  targetPoolIds: string | null;
  active: boolean;
  dismissible: boolean;
  startsAt: string | null;
  expiresAt: string | null;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

interface AnnouncementForm {
  title: string;
  message: string;
  displayType: string;
  targetType: string;
  targetPoolIds: number[];
  active: boolean;
  dismissible: boolean;
  startsAt: string;
  expiresAt: string;
}

interface Pool {
  id: number;
  name: string;
}

const EMPTY_FORM: AnnouncementForm = {
  title: "",
  message: "",
  displayType: "banner",
  targetType: "all",
  targetPoolIds: [],
  active: true,
  dismissible: true,
  startsAt: "",
  expiresAt: "",
};

export function AnnouncementsTab() {
  const [announcements, setAnnouncements] = useState<DashboardAnnouncement[]>([]);
  const [pools, setPools] = useState<Pool[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<AnnouncementForm>(EMPTY_FORM);
  const [showForm, setShowForm] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const loadAnnouncements = async () => {
    try {
      const res = await fetch("/api/admin/announcements");
      const data = await res.json();
      if (data.success) {
        setAnnouncements(data.data);
      }
    } catch (error) {
      console.error("Failed to load announcements:", error);
    } finally {
      setLoading(false);
    }
  };

  const loadPools = async () => {
    try {
      const res = await fetch("/api/admin/pools");
      const json = await res.json();
      if (json.data?.pools) {
        setPools(json.data.pools.map((p: { id: number; name: string }) => ({ id: p.id, name: p.name })));
      }
    } catch (error) {
      console.error("Failed to load pools:", error);
    }
  };

  useEffect(() => {
    loadAnnouncements();
    loadPools();
  }, []);

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  };

  const openEdit = (announcement: DashboardAnnouncement) => {
    setEditingId(announcement.id);
    let poolIds: number[] = [];
    if (announcement.targetPoolIds) {
      try {
        poolIds = JSON.parse(announcement.targetPoolIds);
      } catch {
        poolIds = [];
      }
    }
    setForm({
      title: announcement.title,
      message: announcement.message,
      displayType: announcement.displayType,
      targetType: announcement.targetType,
      targetPoolIds: poolIds,
      active: announcement.active,
      dismissible: announcement.dismissible,
      startsAt: announcement.startsAt ? announcement.startsAt.slice(0, 16) : "",
      expiresAt: announcement.expiresAt ? announcement.expiresAt.slice(0, 16) : "",
    });
    setShowForm(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        action: editingId ? "update" : "create",
        id: editingId || undefined,
        title: form.title,
        message: form.message,
        displayType: form.displayType,
        targetType: form.targetType,
        targetPoolIds: form.targetType === "pools" ? JSON.stringify(form.targetPoolIds) : null,
        active: form.active,
        dismissible: form.dismissible,
        startsAt: form.startsAt || null,
        expiresAt: form.expiresAt || null,
      };
      const res = await fetch("/api/admin/announcements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success) {
        setShowForm(false);
        loadAnnouncements();
      } else {
        alert(data.error || "Failed to save announcement");
      }
    } catch {
      alert("Failed to save announcement");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this announcement?")) return;
    try {
      const res = await fetch("/api/admin/announcements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", id }),
      });
      const data = await res.json();
      if (data.success) {
        loadAnnouncements();
      }
    } catch {
      alert("Failed to delete announcement");
    }
  };

  const handleToggleActive = async (announcement: DashboardAnnouncement) => {
    try {
      await fetch("/api/admin/announcements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update",
          id: announcement.id,
          active: !announcement.active,
        }),
      });
      loadAnnouncements();
    } catch {
      alert("Failed to toggle announcement");
    }
  };

  const togglePoolId = (poolId: number) => {
    setForm((prev) => ({
      ...prev,
      targetPoolIds: prev.targetPoolIds.includes(poolId)
        ? prev.targetPoolIds.filter((id) => id !== poolId)
        : [...prev.targetPoolIds, poolId],
    }));
  };

  const getDisplayTypeLabel = (type: string) => {
    switch (type) {
      case "banner": return "Banner";
      case "modal": return "Modal";
      case "both": return "Both";
      default: return type;
    }
  };

  const getTargetLabel = (announcement: DashboardAnnouncement) => {
    if (announcement.targetType === "all") return "All Customers";
    if (announcement.targetPoolIds) {
      try {
        const ids: number[] = JSON.parse(announcement.targetPoolIds);
        const names = ids.map((id) => {
          const pool = pools.find((p) => p.id === id);
          return pool ? pool.name : `Pool ${id}`;
        });
        return names.length > 2
          ? `${names.slice(0, 2).join(", ")} +${names.length - 2} more`
          : names.join(", ");
      } catch {
        return "Specific Pools";
      }
    }
    return "Specific Pools";
  };

  const getScheduleLabel = (announcement: DashboardAnnouncement) => {
    const now = new Date();
    if (announcement.startsAt && new Date(announcement.startsAt) > now) {
      return "Scheduled";
    }
    if (announcement.expiresAt && new Date(announcement.expiresAt) < now) {
      return "Expired";
    }
    return null;
  };

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: "32px 0", color: "#5b6476" }}>
        Loading announcements...
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <p style={{ color: "#5b6476", fontSize: "14px", margin: 0 }}>
          Manage announcements displayed on the customer dashboard as banners or modals.
        </p>
        <button
          onClick={openCreate}
          style={{
            padding: "8px 16px",
            backgroundColor: "#1a4fff",
            color: "#ffffff",
            border: "none",
            borderRadius: "8px",
            fontSize: "14px",
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          Create Announcement
        </button>
      </div>

      {/* Announcement List */}
      {announcements.length === 0 ? (
        <div
          style={{
            backgroundColor: "#1a1f2e",
            border: "1px solid #e2e8f0",
            borderRadius: "8px",
            padding: "32px",
            textAlign: "center",
            color: "#5b6476",
          }}
        >
          No announcements yet. Create one to notify customers on the dashboard.
        </div>
      ) : (
        <div
          style={{
            backgroundColor: "#1a1f2e",
            border: "1px solid #e2e8f0",
            borderRadius: "8px",
            overflow: "hidden",
          }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #e2e8f0" }}>
                <th
                  style={{
                    textAlign: "left",
                    padding: "12px 16px",
                    fontSize: "12px",
                    fontWeight: 600,
                    color: "#5b6476",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  Title
                </th>
                <th
                  style={{
                    textAlign: "left",
                    padding: "12px 16px",
                    fontSize: "12px",
                    fontWeight: 600,
                    color: "#5b6476",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  Display Type
                </th>
                <th
                  style={{
                    textAlign: "left",
                    padding: "12px 16px",
                    fontSize: "12px",
                    fontWeight: 600,
                    color: "#5b6476",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  Target
                </th>
                <th
                  style={{
                    textAlign: "left",
                    padding: "12px 16px",
                    fontSize: "12px",
                    fontWeight: 600,
                    color: "#5b6476",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  Status
                </th>
                <th
                  style={{
                    textAlign: "right",
                    padding: "12px 16px",
                    fontSize: "12px",
                    fontWeight: 600,
                    color: "#5b6476",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {announcements.map((announcement) => {
                const scheduleLabel = getScheduleLabel(announcement);
                return (
                  <tr
                    key={announcement.id}
                    style={{ borderBottom: "1px solid #e2e8f0" }}
                  >
                    <td style={{ padding: "12px 16px" }}>
                      <div style={{ fontSize: "14px", fontWeight: 500, color: "#e2e8f0" }}>
                        {announcement.title}
                      </div>
                      <div
                        style={{
                          fontSize: "12px",
                          color: "#5b6476",
                          marginTop: "2px",
                          maxWidth: "300px",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {announcement.message}
                      </div>
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      <span
                        style={{
                          display: "inline-block",
                          padding: "2px 8px",
                          borderRadius: "9999px",
                          fontSize: "12px",
                          fontWeight: 500,
                          backgroundColor: "rgba(26, 79, 255, 0.15)",
                          color: "#6b8aff",
                        }}
                      >
                        {getDisplayTypeLabel(announcement.displayType)}
                      </span>
                    </td>
                    <td style={{ padding: "12px 16px", fontSize: "13px", color: "#e2e8f0" }}>
                      {getTargetLabel(announcement)}
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "4px",
                            padding: "2px 8px",
                            borderRadius: "9999px",
                            fontSize: "12px",
                            fontWeight: 500,
                            backgroundColor: announcement.active
                              ? "rgba(34, 197, 94, 0.15)"
                              : "rgba(107, 114, 128, 0.15)",
                            color: announcement.active ? "#4ade80" : "#6b7280",
                          }}
                        >
                          {announcement.active ? "Active" : "Inactive"}
                        </span>
                        {scheduleLabel && (
                          <span
                            style={{
                              display: "inline-block",
                              padding: "2px 8px",
                              borderRadius: "9999px",
                              fontSize: "11px",
                              fontWeight: 500,
                              backgroundColor:
                                scheduleLabel === "Expired"
                                  ? "rgba(239, 68, 68, 0.15)"
                                  : "rgba(234, 179, 8, 0.15)",
                              color:
                                scheduleLabel === "Expired" ? "#f87171" : "#facc15",
                            }}
                          >
                            {scheduleLabel}
                          </span>
                        )}
                      </div>
                    </td>
                    <td style={{ padding: "12px 16px", textAlign: "right" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "8px" }}>
                        <button
                          onClick={() => handleToggleActive(announcement)}
                          style={{
                            background: "none",
                            border: "none",
                            fontSize: "12px",
                            color: "#5b6476",
                            cursor: "pointer",
                            padding: "4px 8px",
                          }}
                        >
                          {announcement.active ? "Deactivate" : "Activate"}
                        </button>
                        <button
                          onClick={() => openEdit(announcement)}
                          style={{
                            background: "none",
                            border: "none",
                            fontSize: "12px",
                            color: "#1a4fff",
                            cursor: "pointer",
                            padding: "4px 8px",
                          }}
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(announcement.id)}
                          style={{
                            background: "none",
                            border: "none",
                            fontSize: "12px",
                            color: "#ef4444",
                            cursor: "pointer",
                            padding: "4px 8px",
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Create/Edit Form Modal */}
      {showForm && (
        <div
          onClick={() => setShowForm(false)}
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0, 0, 0, 0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 50,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundColor: "#0b0f1c",
              borderRadius: "12px",
              padding: "24px",
              width: "100%",
              maxWidth: "560px",
              maxHeight: "90vh",
              overflowY: "auto",
              border: "1px solid #e2e8f0",
            }}
          >
            <h3
              style={{
                fontSize: "18px",
                fontWeight: 700,
                color: "#e2e8f0",
                marginBottom: "16px",
                marginTop: 0,
              }}
            >
              {editingId ? "Edit Announcement" : "Create Announcement"}
            </h3>
            <form
              onSubmit={handleSave}
              style={{ display: "flex", flexDirection: "column", gap: "16px" }}
            >
              {/* Title */}
              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "14px",
                    fontWeight: 500,
                    color: "#e2e8f0",
                    marginBottom: "4px",
                  }}
                >
                  Title *
                </label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  required
                  placeholder="Scheduled Maintenance Tonight"
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    backgroundColor: "#1a1f2e",
                    border: "1px solid #e2e8f0",
                    borderRadius: "8px",
                    fontSize: "14px",
                    color: "#e2e8f0",
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                />
              </div>

              {/* Message */}
              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "14px",
                    fontWeight: 500,
                    color: "#e2e8f0",
                    marginBottom: "4px",
                  }}
                >
                  Message *
                </label>
                <textarea
                  value={form.message}
                  onChange={(e) => setForm({ ...form, message: e.target.value })}
                  onPaste={(e) => {
                    // PA-309: rich text pasted from a doc would lose bold +
                    // paragraphs in a plain textarea. Read the clipboard's HTML
                    // and convert to markdown so it survives (and renders back
                    // via AnnouncementMessage). Plain-text pastes fall through.
                    const html = e.clipboardData.getData("text/html");
                    if (!html) return;
                    e.preventDefault();
                    const md = htmlToMarkdown(html);
                    const ta = e.currentTarget;
                    const start = ta.selectionStart ?? form.message.length;
                    const end = ta.selectionEnd ?? form.message.length;
                    setForm({
                      ...form,
                      message: form.message.slice(0, start) + md + form.message.slice(end),
                    });
                  }}
                  required
                  rows={3}
                  placeholder="We will be performing scheduled maintenance tonight from 10 PM to 2 AM UTC."
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    backgroundColor: "#1a1f2e",
                    border: "1px solid #e2e8f0",
                    borderRadius: "8px",
                    fontSize: "14px",
                    color: "#e2e8f0",
                    outline: "none",
                    resize: "vertical",
                    boxSizing: "border-box",
                    fontFamily: "inherit",
                  }}
                />
              </div>

              {/* Display Type */}
              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "14px",
                    fontWeight: 500,
                    color: "#e2e8f0",
                    marginBottom: "8px",
                  }}
                >
                  Display Type
                </label>
                <div style={{ display: "flex", gap: "8px" }}>
                  {(["banner", "modal", "both"] as const).map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setForm({ ...form, displayType: type })}
                      style={{
                        flex: 1,
                        padding: "8px 12px",
                        borderRadius: "8px",
                        fontSize: "13px",
                        fontWeight: 500,
                        cursor: "pointer",
                        border: form.displayType === type
                          ? "1px solid #1a4fff"
                          : "1px solid #e2e8f0",
                        backgroundColor: form.displayType === type
                          ? "rgba(26, 79, 255, 0.15)"
                          : "#1a1f2e",
                        color: form.displayType === type ? "#6b8aff" : "#5b6476",
                      }}
                    >
                      {type === "banner" ? "Banner" : type === "modal" ? "Modal" : "Both"}
                    </button>
                  ))}
                </div>
              </div>

              {/* Target */}
              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "14px",
                    fontWeight: 500,
                    color: "#e2e8f0",
                    marginBottom: "8px",
                  }}
                >
                  Target
                </label>
                <div style={{ display: "flex", gap: "8px" }}>
                  {(["all", "pools"] as const).map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setForm({ ...form, targetType: type, targetPoolIds: type === "all" ? [] : form.targetPoolIds })}
                      style={{
                        flex: 1,
                        padding: "8px 12px",
                        borderRadius: "8px",
                        fontSize: "13px",
                        fontWeight: 500,
                        cursor: "pointer",
                        border: form.targetType === type
                          ? "1px solid #1a4fff"
                          : "1px solid #e2e8f0",
                        backgroundColor: form.targetType === type
                          ? "rgba(26, 79, 255, 0.15)"
                          : "#1a1f2e",
                        color: form.targetType === type ? "#6b8aff" : "#5b6476",
                      }}
                    >
                      {type === "all" ? "All Customers" : "Specific Pools"}
                    </button>
                  ))}
                </div>
              </div>

              {/* Pool Selection */}
              {form.targetType === "pools" && (
                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: "14px",
                      fontWeight: 500,
                      color: "#e2e8f0",
                      marginBottom: "8px",
                    }}
                  >
                    Select Pools
                  </label>
                  {pools.length === 0 ? (
                    <div
                      style={{
                        fontSize: "13px",
                        color: "#5b6476",
                        padding: "12px",
                        backgroundColor: "#1a1f2e",
                        borderRadius: "8px",
                        border: "1px solid #e2e8f0",
                      }}
                    >
                      Loading pools...
                    </div>
                  ) : (
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(2, 1fr)",
                        gap: "8px",
                        maxHeight: "200px",
                        overflowY: "auto",
                        padding: "12px",
                        backgroundColor: "#1a1f2e",
                        borderRadius: "8px",
                        border: "1px solid #e2e8f0",
                      }}
                    >
                      {pools.map((pool) => (
                        <label
                          key={pool.id}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                            cursor: "pointer",
                            fontSize: "13px",
                            color: "#e2e8f0",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={form.targetPoolIds.includes(pool.id)}
                            onChange={() => togglePoolId(pool.id)}
                            style={{ accentColor: "#1a4fff" }}
                          />
                          <span>{pool.name}</span>
                          <span style={{ color: "#5b6476", fontSize: "11px" }}>
                            #{pool.id}
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Toggles */}
              <div style={{ display: "flex", gap: "24px" }}>
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    cursor: "pointer",
                    fontSize: "14px",
                    color: "#e2e8f0",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={form.active}
                    onChange={(e) => setForm({ ...form, active: e.target.checked })}
                    style={{ accentColor: "#1a4fff" }}
                  />
                  Active
                </label>
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    cursor: "pointer",
                    fontSize: "14px",
                    color: "#e2e8f0",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={form.dismissible}
                    onChange={(e) => setForm({ ...form, dismissible: e.target.checked })}
                    style={{ accentColor: "#1a4fff" }}
                  />
                  Dismissible
                </label>
              </div>

              {/* Scheduling */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: "14px",
                      fontWeight: 500,
                      color: "#e2e8f0",
                      marginBottom: "4px",
                    }}
                  >
                    Start Date
                  </label>
                  <input
                    type="datetime-local"
                    value={form.startsAt}
                    onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      backgroundColor: "#1a1f2e",
                      border: "1px solid #e2e8f0",
                      borderRadius: "8px",
                      fontSize: "14px",
                      color: "#e2e8f0",
                      outline: "none",
                      boxSizing: "border-box",
                    }}
                  />
                </div>
                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: "14px",
                      fontWeight: 500,
                      color: "#e2e8f0",
                      marginBottom: "4px",
                    }}
                  >
                    Expiry Date
                  </label>
                  <input
                    type="datetime-local"
                    value={form.expiresAt}
                    onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      backgroundColor: "#1a1f2e",
                      border: "1px solid #e2e8f0",
                      borderRadius: "8px",
                      fontSize: "14px",
                      color: "#e2e8f0",
                      outline: "none",
                      boxSizing: "border-box",
                    }}
                  />
                </div>
              </div>

              {/* Preview */}
              <div>
                <button
                  type="button"
                  onClick={() => setShowPreview(!showPreview)}
                  style={{
                    background: "none",
                    border: "none",
                    fontSize: "14px",
                    fontWeight: 500,
                    color: "#6b8aff",
                    cursor: "pointer",
                    padding: 0,
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                  }}
                >
                  {showPreview ? "Hide Preview" : "Show Preview"}
                  <span style={{ fontSize: "12px" }}>{showPreview ? "\u25B2" : "\u25BC"}</span>
                </button>

                {showPreview && (
                  <div
                    style={{
                      marginTop: "12px",
                      padding: "16px",
                      backgroundColor: "#131829",
                      borderRadius: "8px",
                      border: "1px solid #e2e8f0",
                    }}
                  >
                    <div style={{ fontSize: "11px", fontWeight: 600, color: "#5b6476", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "12px" }}>
                      Preview — How customers will see this
                    </div>

                    {/* Banner Preview */}
                    {(form.displayType === "banner" || form.displayType === "both") && (
                      <div style={{ marginBottom: form.displayType === "both" ? "16px" : 0 }}>
                        <div style={{ fontSize: "10px", color: "#5b6476", marginBottom: "6px", fontWeight: 500 }}>BANNER</div>
                        <div
                          style={{
                            background: "#1a4fff",
                            color: "white",
                            padding: "12px 20px",
                            borderRadius: "8px",
                            display: "flex",
                            alignItems: "flex-start",
                            justifyContent: "space-between",
                            gap: "12px",
                          }}
                        >
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 700, fontSize: "14px" }}>
                              {form.title || "Announcement Title"}
                            </div>
                            <div style={{ fontSize: "13px", opacity: 0.9, marginTop: "2px" }}>
                              {form.message ? (
                                <AnnouncementMessage text={form.message} />
                              ) : (
                                "Your announcement message will appear here."
                              )}
                            </div>
                          </div>
                          {form.dismissible && (
                            <span
                              style={{
                                color: "white",
                                padding: "2px 6px",
                                fontSize: "18px",
                                lineHeight: 1,
                                opacity: 0.7,
                                flexShrink: 0,
                              }}
                            >
                              &times;
                            </span>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Modal Preview */}
                    {(form.displayType === "modal" || form.displayType === "both") && (
                      <div>
                        <div style={{ fontSize: "10px", color: "#5b6476", marginBottom: "6px", fontWeight: 500 }}>MODAL</div>
                        <div
                          style={{
                            background: "rgba(0,0,0,0.5)",
                            borderRadius: "8px",
                            padding: "24px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <div
                            style={{
                              background: "white",
                              color: "#0b0f1c",
                              borderRadius: "12px",
                              padding: "24px",
                              maxWidth: "400px",
                              width: "100%",
                              textAlign: "center",
                              // Mirror the live modal: cap height + scroll so a
                              // long preview doesn't balloon the admin form.
                              maxHeight: "60vh",
                              overflowY: "auto",
                            }}
                          >
                            <h4
                              style={{
                                margin: "0 0 12px 0",
                                fontSize: "18px",
                                fontWeight: 700,
                              }}
                            >
                              {form.title || "Announcement Title"}
                            </h4>
                            <div
                              style={{
                                margin: "0 0 20px 0",
                                fontSize: "14px",
                                lineHeight: 1.5,
                                color: "#3a3f4b",
                                textAlign: "left",
                              }}
                            >
                              {form.message ? (
                                <AnnouncementMessage text={form.message} />
                              ) : (
                                "Your announcement message will appear here."
                              )}
                            </div>
                            {form.dismissible && (
                              <span
                                style={{
                                  display: "inline-block",
                                  background: "#1a4fff",
                                  color: "white",
                                  borderRadius: "8px",
                                  padding: "10px 24px",
                                  fontSize: "14px",
                                  fontWeight: 600,
                                }}
                              >
                                Got it
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Form Actions */}
              <div style={{ display: "flex", gap: "12px", paddingTop: "8px" }}>
                <button
                  type="submit"
                  disabled={saving}
                  style={{
                    flex: 1,
                    padding: "10px",
                    backgroundColor: "#1a4fff",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "8px",
                    fontSize: "14px",
                    fontWeight: 500,
                    cursor: saving ? "not-allowed" : "pointer",
                    opacity: saving ? 0.5 : 1,
                  }}
                >
                  {saving ? "Saving..." : editingId ? "Update Announcement" : "Create Announcement"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  style={{
                    padding: "10px 16px",
                    backgroundColor: "#1a1f2e",
                    color: "#5b6476",
                    border: "1px solid #e2e8f0",
                    borderRadius: "8px",
                    fontSize: "14px",
                    fontWeight: 500,
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
