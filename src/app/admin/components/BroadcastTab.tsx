"use client";

import { useState, useEffect } from "react";
import { getBrandName } from "@/lib/branding-client";

interface Broadcast {
  id: string;
  subject: string;
  htmlBody: string;
  useLayout: boolean;
  segmentType: string;
  segmentFilter: string | null;
  recipientCount: number;
  sentCount: number;
  failedCount: number;
  status: string;
  createdBy: string | null;
  sentAt: string | null;
  createdAt: string;
}

interface Pool {
  id: number;
  name: string;
}

interface Node {
  id: string;
  hostname: string;
  gpuaasPoolId: number | null;
  gpuModel: string | null;
}

interface Product {
  id: string;
  name: string;
}

const SEGMENT_TYPES = [
  { value: "all", label: "All Customers" },
  { value: "active", label: "Active Pods" },
  { value: "pool", label: "By Pool" },
  { value: "node", label: "By Node" },
  { value: "billing", label: "By Billing" },
  { value: "product", label: "By Product" },
  { value: "custom", label: "Custom Emails" },
] as const;

function getSegmentLabel(
  type: string,
  filter: string | null,
  pools: Pool[],
  nodes: Node[],
  products: Product[]
): string {
  if (type === "all") return "All Customers";
  if (type === "active") return "Active Pods Only";

  if (!filter) return type;

  try {
    const parsed = JSON.parse(filter);

    if (type === "pool" && Array.isArray(parsed.poolIds)) {
      const names = parsed.poolIds.map((id: number) => {
        const pool = pools.find((p) => p.id === id);
        return pool ? pool.name : `Pool ${id}`;
      });
      if (names.length === 0) return "By Pool (none)";
      return names.length > 3
        ? `Pool: ${names.slice(0, 3).join(", ")} +${names.length - 3} more`
        : `Pool: ${names.join(", ")}`;
    }

    if (type === "node" && Array.isArray(parsed.nodeIds)) {
      const names = parsed.nodeIds.map((id: string) => {
        const node = nodes.find((n) => n.id === id);
        return node ? node.hostname : id;
      });
      if (names.length === 0) return "By Node (none)";
      return names.length > 3
        ? `Node: ${names.slice(0, 3).join(", ")} +${names.length - 3} more`
        : `Node: ${names.join(", ")}`;
    }

    if (type === "billing" && parsed.billingType) {
      return `Billing: ${parsed.billingType === "hourly" ? "Hourly" : "Monthly"}`;
    }

    if (type === "product" && parsed.productId) {
      const product = products.find((p) => p.id === parsed.productId);
      return product ? `Product: ${product.name}` : `Product: ${parsed.productId}`;
    }

    if (type === "custom" && Array.isArray(parsed.emails)) {
      if (parsed.emails.length === 0) return "Custom (none)";
      return parsed.emails.length > 2
        ? `Custom: ${parsed.emails.slice(0, 2).join(", ")} +${parsed.emails.length - 2} more`
        : `Custom: ${parsed.emails.join(", ")}`;
    }
  } catch {
    // ignore parse errors
  }

  return type;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "12px 16px",
  fontSize: "12px",
  fontWeight: 600,
  color: "#5b6476",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "14px",
  fontWeight: 500,
  color: "#e2e8f0",
  marginBottom: "4px",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 12px",
  backgroundColor: "#1a1f2e",
  border: "1px solid #e2e8f0",
  borderRadius: "8px",
  fontSize: "14px",
  color: "#e2e8f0",
  outline: "none",
  boxSizing: "border-box",
};

export function BroadcastTab() {
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCompose, setShowCompose] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [previewResult, setPreviewResult] = useState<{
    count: number;
    sampleEmails: string[];
  } | null>(null);

  // Compose form state
  const [subject, setSubject] = useState("");
  const [htmlBody, setHtmlBody] = useState("");
  const [useLayout, setUseLayout] = useState(true);
  const [segmentType, setSegmentType] = useState("all");
  const [segmentFilter, setSegmentFilter] = useState<Record<string, unknown>>(
    {}
  );
  const [testEmail, setTestEmail] = useState("");
  const [testFeedback, setTestFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  // Reference data
  const [pools, setPools] = useState<Pool[]>([]);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [products, setProducts] = useState<Product[]>([]);

  const loadBroadcasts = async () => {
    try {
      const res = await fetch("/api/admin/broadcast");
      const json = await res.json();
      if (json.success || json.data) {
        setBroadcasts(json.data || []);
      }
    } catch (error) {
      console.error("Failed to load broadcasts:", error);
    } finally {
      setLoading(false);
    }
  };

  const loadPools = async () => {
    try {
      const res = await fetch("/api/admin/pools");
      const json = await res.json();
      console.log("[BroadcastTab] pools response:", JSON.stringify(json).slice(0, 200));
      if (json.data?.pools) {
        setPools(
          json.data.pools.map((p: { id: number; name: string }) => ({
            id: p.id,
            name: p.name,
          }))
        );
      } else {
        console.error("[BroadcastTab] Unexpected pools response:", json.error || "no data.pools");
      }
    } catch (error) {
      console.error("[BroadcastTab] Failed to load pools:", error);
    }
  };

  const loadNodes = async () => {
    try {
      const res = await fetch("/api/admin/nodes");
      const json = await res.json();
      const allNodes: Node[] = json.data?.nodes || [];
      setNodes(allNodes.filter((n) => n.gpuaasPoolId !== null));
    } catch (error) {
      console.error("Failed to load nodes:", error);
    }
  };

  const loadProducts = async () => {
    try {
      const res = await fetch("/api/admin/gpu-products");
      const json = await res.json();
      const list = json.success ? json.data : [];
      setProducts(
        list.map((p: { id: string; name: string }) => ({
          id: p.id,
          name: p.name,
        }))
      );
    } catch (error) {
      console.error("Failed to load products:", error);
    }
  };

  useEffect(() => {
    loadBroadcasts();
    loadPools();
    loadNodes();
    loadProducts();
  }, []);

  // Reset segmentFilter when segmentType changes
  useEffect(() => {
    switch (segmentType) {
      case "pool":
        setSegmentFilter({ poolIds: [] });
        break;
      case "node":
        setSegmentFilter({ nodeIds: [] });
        break;
      case "billing":
        setSegmentFilter({ billingType: "hourly" });
        break;
      case "product":
        setSegmentFilter({ productId: "" });
        break;
      case "custom":
        setSegmentFilter({ emails: [] });
        break;
      default:
        setSegmentFilter({});
        break;
    }
    setPreviewResult(null);
  }, [segmentType]);

  const openCompose = () => {
    setSubject("");
    setHtmlBody("");
    setUseLayout(true);
    setSegmentType("all");
    setSegmentFilter({});
    setTestEmail("");
    setTestFeedback(null);
    setPreviewResult(null);
    setShowCompose(true);
  };

  const closeCompose = () => {
    setShowCompose(false);
  };

  const handlePreviewAudience = async () => {
    setPreviewing(true);
    setPreviewResult(null);
    try {
      const res = await fetch("/api/admin/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "preview",
          segmentType,
          segmentFilter,
        }),
      });
      const json = await res.json();
      if (json.success && json.data) {
        setPreviewResult({
          count: json.data.count,
          sampleEmails: json.data.sampleEmails || [],
        });
      } else {
        alert(json.error || "Failed to preview audience");
      }
    } catch {
      alert("Failed to preview audience");
    } finally {
      setPreviewing(false);
    }
  };

  const handleSendTest = async () => {
    if (!testEmail.trim()) {
      setTestFeedback({ type: "error", message: "Enter a test email address" });
      return;
    }
    if (!subject.trim()) {
      setTestFeedback({ type: "error", message: "Subject is required" });
      return;
    }
    if (!htmlBody.trim()) {
      setTestFeedback({ type: "error", message: "HTML body is required" });
      return;
    }
    setSendingTest(true);
    setTestFeedback(null);
    try {
      const res = await fetch("/api/admin/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "send-test",
          subject,
          htmlBody,
          useLayout,
          testEmail: testEmail.trim(),
        }),
      });
      const json = await res.json();
      if (json.success) {
        setTestFeedback({
          type: "success",
          message: `Test email sent to ${testEmail.trim()}`,
        });
      } else {
        setTestFeedback({
          type: "error",
          message: json.error || "Failed to send test email",
        });
      }
    } catch {
      setTestFeedback({ type: "error", message: "Failed to send test email" });
    } finally {
      setSendingTest(false);
    }
  };

  const handleSendBroadcast = async () => {
    if (!subject.trim()) {
      alert("Subject is required");
      return;
    }
    if (!htmlBody.trim()) {
      alert("HTML body is required");
      return;
    }

    const countLabel = previewResult
      ? `${previewResult.count} recipients`
      : "the selected audience";
    if (
      !confirm(
        `Are you sure you want to send this broadcast to ${countLabel}? This action cannot be undone.`
      )
    ) {
      return;
    }

    setSending(true);
    try {
      const res = await fetch("/api/admin/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "send",
          subject,
          htmlBody,
          useLayout,
          segmentType,
          segmentFilter,
        }),
      });
      const json = await res.json();
      if (json.success) {
        closeCompose();
        loadBroadcasts();
      } else {
        alert(json.error || "Failed to send broadcast");
      }
    } catch {
      alert("Failed to send broadcast");
    } finally {
      setSending(false);
    }
  };

  const togglePoolId = (poolId: number) => {
    const current = (segmentFilter.poolIds as number[]) || [];
    const updated = current.includes(poolId)
      ? current.filter((id) => id !== poolId)
      : [...current, poolId];
    setSegmentFilter({ ...segmentFilter, poolIds: updated });
  };

  const toggleNodeId = (nodeId: string) => {
    const current = (segmentFilter.nodeIds as string[]) || [];
    const updated = current.includes(nodeId)
      ? current.filter((id) => id !== nodeId)
      : [...current, nodeId];
    setSegmentFilter({ ...segmentFilter, nodeIds: updated });
  };

  const getStatusBadge = (status: string) => {
    let bgColor: string;
    let textColor: string;
    switch (status) {
      case "sending":
        bgColor = "rgba(234, 179, 8, 0.15)";
        textColor = "#facc15";
        break;
      case "sent":
        bgColor = "rgba(34, 197, 94, 0.15)";
        textColor = "#4ade80";
        break;
      case "failed":
        bgColor = "rgba(239, 68, 68, 0.15)";
        textColor = "#f87171";
        break;
      default:
        bgColor = "rgba(107, 114, 128, 0.15)";
        textColor = "#6b7280";
        break;
    }
    return { bgColor, textColor };
  };

  if (loading) {
    return (
      <div
        style={{ textAlign: "center", padding: "32px 0", color: "#5b6476" }}
      >
        Loading broadcasts...
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <p style={{ color: "#5b6476", fontSize: "14px", margin: 0 }}>
          Send mass emails to customers. Segment by pool, node, billing type, or
          custom email list.
        </p>
        <button
          onClick={openCompose}
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
          New Broadcast
        </button>
      </div>

      {/* Broadcast History */}
      {broadcasts.length === 0 ? (
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
          No broadcasts sent yet. Click &quot;New Broadcast&quot; to send your first mass
          email.
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
                <th style={thStyle}>Subject</th>
                <th style={thStyle}>Segment</th>
                <th style={thStyle}>Recipients</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Date</th>
              </tr>
            </thead>
            <tbody>
              {broadcasts.map((broadcast) => {
                const badge = getStatusBadge(broadcast.status);
                return (
                  <tr
                    key={broadcast.id}
                    style={{ borderBottom: "1px solid #e2e8f0" }}
                  >
                    <td style={{ padding: "12px 16px" }}>
                      <div
                        style={{
                          fontSize: "14px",
                          fontWeight: 500,
                          color: "#e2e8f0",
                        }}
                      >
                        {broadcast.subject}
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
                        {broadcast.htmlBody
                          .replace(/<[^>]*>/g, "")
                          .slice(0, 80)}
                      </div>
                    </td>
                    <td
                      style={{
                        padding: "12px 16px",
                        fontSize: "13px",
                        color: "#e2e8f0",
                      }}
                    >
                      {getSegmentLabel(
                        broadcast.segmentType,
                        broadcast.segmentFilter,
                        pools,
                        nodes,
                        products
                      )}
                    </td>
                    <td
                      style={{
                        padding: "12px 16px",
                        fontSize: "13px",
                        color: "#e2e8f0",
                      }}
                    >
                      {broadcast.sentCount} / {broadcast.recipientCount}
                      {broadcast.failedCount > 0 && (
                        <span
                          style={{
                            color: "#f87171",
                            fontSize: "12px",
                            marginLeft: "4px",
                          }}
                        >
                          ({broadcast.failedCount} failed)
                        </span>
                      )}
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      <span
                        style={{
                          display: "inline-block",
                          padding: "2px 8px",
                          borderRadius: "9999px",
                          fontSize: "12px",
                          fontWeight: 500,
                          backgroundColor: badge.bgColor,
                          color: badge.textColor,
                        }}
                      >
                        {broadcast.status.charAt(0).toUpperCase() +
                          broadcast.status.slice(1)}
                      </span>
                    </td>
                    <td
                      style={{
                        padding: "12px 16px",
                        fontSize: "13px",
                        color: "#5b6476",
                      }}
                    >
                      {broadcast.sentAt
                        ? formatDate(broadcast.sentAt)
                        : formatDate(broadcast.createdAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Compose Modal */}
      {showCompose && (
        <div
          onClick={closeCompose}
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
              maxWidth: "800px",
              maxHeight: "90vh",
              overflowY: "auto",
              border: "1px solid #e2e8f0",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: "20px",
              }}
            >
              <h3
                style={{
                  fontSize: "18px",
                  fontWeight: 700,
                  color: "#e2e8f0",
                  margin: 0,
                }}
              >
                New Broadcast
              </h3>
              <button
                onClick={closeCompose}
                style={{
                  background: "none",
                  border: "none",
                  color: "#5b6476",
                  fontSize: "20px",
                  cursor: "pointer",
                  padding: "4px 8px",
                }}
              >
                {"\u2715"}
              </button>
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "16px",
              }}
            >
              {/* Subject */}
              <div>
                <label style={labelStyle}>Subject *</label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Your email subject line"
                  style={inputStyle}
                />
              </div>

              {/* HTML Body + Preview side by side */}
              <div>
                <label style={{ ...labelStyle, marginBottom: "8px" }}>
                  HTML Body *
                </label>
                <div
                  style={{
                    fontSize: "12px",
                    color: "#5b6476",
                    marginBottom: "8px",
                  }}
                >
                  Available variables:{" "}
                  <span
                    style={{
                      fontFamily: "monospace",
                      color: "#6b8aff",
                    }}
                  >
                    {"{{customerName}}"}
                  </span>
                  ,{" "}
                  <span
                    style={{
                      fontFamily: "monospace",
                      color: "#6b8aff",
                    }}
                  >
                    {"{{customerEmail}}"}
                  </span>
                </div>
                <div style={{ display: "flex", gap: "12px" }}>
                  <textarea
                    value={htmlBody}
                    onChange={(e) => setHtmlBody(e.target.value)}
                    rows={12}
                    placeholder="<h1>Hello {{customerName}},</h1>\n<p>Your email content here...</p>"
                    style={{
                      ...inputStyle,
                      flex: 1,
                      fontFamily: "monospace",
                      fontSize: "12px",
                      resize: "vertical",
                    }}
                  />
                  <div
                    style={{
                      flex: 1,
                      border: "1px solid #e2e8f0",
                      borderRadius: "8px",
                      overflow: "hidden",
                      backgroundColor: "#ffffff",
                      minHeight: "250px",
                    }}
                  >
                    <div
                      style={{
                        padding: "6px 10px",
                        backgroundColor: "#1a1f2e",
                        borderBottom: "1px solid #e2e8f0",
                        fontSize: "11px",
                        color: "#5b6476",
                        fontWeight: 600,
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                      }}
                    >
                      Preview
                    </div>
                    <iframe
                      srcDoc={
                        htmlBody.trim()
                          ? (/<(p|div|table|tr|td|h[1-6]|ul|ol|li|br|hr)\b/i.test(htmlBody) ? htmlBody : htmlBody.replace(/\n/g, "<br>\n"))
                          : '<p style="color:#999;padding:16px;font-family:sans-serif;">HTML preview will appear here...</p>'
                      }
                      title="Email Preview"
                      style={{
                        width: "100%",
                        height: "230px",
                        border: "none",
                        display: "block",
                      }}
                    />
                  </div>
                </div>
                {useLayout && (
                  <div
                    style={{
                      marginTop: "6px",
                      fontSize: "12px",
                      color: "#5b6476",
                      fontStyle: "italic",
                    }}
                  >
                    Your HTML will be wrapped in the {getBrandName()} email template
                    (header, footer, styles).
                  </div>
                )}
              </div>

              {/* Use Layout Toggle */}
              <div>
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
                    checked={useLayout}
                    onChange={(e) => setUseLayout(e.target.checked)}
                    style={{ accentColor: "#1a4fff" }}
                  />
                  Use {getBrandName()} email template
                </label>
              </div>

              {/* Audience Segment */}
              <div>
                <label style={{ ...labelStyle, marginBottom: "8px" }}>
                  Audience Segment
                </label>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "8px",
                  }}
                >
                  {SEGMENT_TYPES.map((seg) => (
                    <button
                      key={seg.value}
                      type="button"
                      onClick={() => setSegmentType(seg.value)}
                      style={{
                        padding: "8px 12px",
                        borderRadius: "8px",
                        fontSize: "13px",
                        fontWeight: 500,
                        cursor: "pointer",
                        border:
                          segmentType === seg.value
                            ? "1px solid #1a4fff"
                            : "1px solid #e2e8f0",
                        backgroundColor:
                          segmentType === seg.value
                            ? "rgba(26, 79, 255, 0.15)"
                            : "#1a1f2e",
                        color:
                          segmentType === seg.value ? "#6b8aff" : "#5b6476",
                      }}
                    >
                      {seg.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Segment-specific filters */}
              {segmentType === "pool" && (
                <div>
                  <label style={{ ...labelStyle, marginBottom: "8px" }}>
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
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                      }}
                    >
                      Loading pools...
                      <button
                        type="button"
                        onClick={loadPools}
                        style={{
                          padding: "4px 8px",
                          fontSize: "12px",
                          backgroundColor: "transparent",
                          color: "#6b8aff",
                          border: "1px solid #6b8aff",
                          borderRadius: "4px",
                          cursor: "pointer",
                        }}
                      >
                        Retry
                      </button>
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
                            checked={(
                              (segmentFilter.poolIds as number[]) || []
                            ).includes(pool.id)}
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

              {segmentType === "node" && (
                <div>
                  <label style={{ ...labelStyle, marginBottom: "8px" }}>
                    Select Nodes
                  </label>
                  {nodes.length === 0 ? (
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
                      No nodes with pool assignments found.
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
                      {nodes.map((node) => (
                        <label
                          key={node.id}
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
                            checked={(
                              (segmentFilter.nodeIds as string[]) || []
                            ).includes(node.id)}
                            onChange={() => toggleNodeId(node.id)}
                            style={{ accentColor: "#1a4fff" }}
                          />
                          <span>{node.hostname}</span>
                          {node.gpuModel && (
                            <span
                              style={{ color: "#5b6476", fontSize: "11px" }}
                            >
                              {node.gpuModel}
                            </span>
                          )}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {segmentType === "billing" && (
                <div>
                  <label style={{ ...labelStyle, marginBottom: "8px" }}>
                    Billing Type
                  </label>
                  <div style={{ display: "flex", gap: "8px" }}>
                    {(["hourly", "monthly"] as const).map((type) => (
                      <button
                        key={type}
                        type="button"
                        onClick={() =>
                          setSegmentFilter({
                            ...segmentFilter,
                            billingType: type,
                          })
                        }
                        style={{
                          flex: 1,
                          padding: "8px 12px",
                          borderRadius: "8px",
                          fontSize: "13px",
                          fontWeight: 500,
                          cursor: "pointer",
                          border:
                            segmentFilter.billingType === type
                              ? "1px solid #1a4fff"
                              : "1px solid #e2e8f0",
                          backgroundColor:
                            segmentFilter.billingType === type
                              ? "rgba(26, 79, 255, 0.15)"
                              : "#1a1f2e",
                          color:
                            segmentFilter.billingType === type
                              ? "#6b8aff"
                              : "#5b6476",
                        }}
                      >
                        {type === "hourly" ? "Hourly" : "Monthly"}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {segmentType === "product" && (
                <div>
                  <label style={{ ...labelStyle, marginBottom: "8px" }}>
                    Select Product
                  </label>
                  {products.length === 0 ? (
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
                      Loading products...
                    </div>
                  ) : (
                    <select
                      value={(segmentFilter.productId as string) || ""}
                      onChange={(e) =>
                        setSegmentFilter({
                          ...segmentFilter,
                          productId: e.target.value,
                        })
                      }
                      style={{
                        ...inputStyle,
                        cursor: "pointer",
                      }}
                    >
                      <option value="">Select a product...</option>
                      {products.map((product) => (
                        <option key={product.id} value={product.id}>
                          {product.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              {segmentType === "custom" && (
                <div>
                  <label style={{ ...labelStyle, marginBottom: "4px" }}>
                    Custom Email Addresses
                  </label>
                  <div
                    style={{
                      fontSize: "12px",
                      color: "#5b6476",
                      marginBottom: "8px",
                    }}
                  >
                    Enter email addresses separated by commas or newlines.
                  </div>
                  <textarea
                    value={
                      Array.isArray(segmentFilter.emails)
                        ? (segmentFilter.emails as string[]).join(", ")
                        : ""
                    }
                    onChange={(e) => {
                      const raw = e.target.value;
                      const emails = raw
                        .split(/[,\n]+/)
                        .map((s) => s.trim())
                        .filter(Boolean);
                      setSegmentFilter({ ...segmentFilter, emails });
                    }}
                    rows={4}
                    placeholder="john@example.com, jane@example.com"
                    style={{
                      ...inputStyle,
                      fontFamily: "monospace",
                      fontSize: "12px",
                      resize: "vertical",
                    }}
                  />
                </div>
              )}

              {/* Preview Audience */}
              <div>
                <button
                  type="button"
                  onClick={handlePreviewAudience}
                  disabled={previewing}
                  style={{
                    padding: "8px 16px",
                    backgroundColor: "#1a1f2e",
                    color: "#6b8aff",
                    border: "1px solid #e2e8f0",
                    borderRadius: "8px",
                    fontSize: "13px",
                    fontWeight: 500,
                    cursor: previewing ? "not-allowed" : "pointer",
                    opacity: previewing ? 0.5 : 1,
                  }}
                >
                  {previewing ? "Loading..." : "Preview Audience"}
                </button>
                {previewResult && (
                  <div
                    style={{
                      marginTop: "10px",
                      padding: "12px",
                      backgroundColor: "#1a1f2e",
                      borderRadius: "8px",
                      border: "1px solid #e2e8f0",
                    }}
                  >
                    <div
                      style={{
                        fontSize: "14px",
                        fontWeight: 600,
                        color: "#e2e8f0",
                        marginBottom: "8px",
                      }}
                    >
                      {previewResult.count} recipient
                      {previewResult.count !== 1 ? "s" : ""}
                    </div>
                    {previewResult.sampleEmails.length > 0 && (
                      <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                        {previewResult.sampleEmails.map((email) => (
                          <div
                            key={email}
                            style={{
                              fontSize: "13px",
                              color: "#94a3b8",
                              fontFamily: "monospace",
                            }}
                          >
                            {email}
                          </div>
                        ))}
                        {previewResult.count >
                          previewResult.sampleEmails.length && (
                          <div
                            style={{
                              fontSize: "12px",
                              color: "#64748b",
                              marginTop: "4px",
                            }}
                          >
                            + {previewResult.count - previewResult.sampleEmails.length} more...
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Divider */}
              <div
                style={{
                  borderTop: "1px solid #e2e8f0",
                  margin: "4px 0",
                }}
              />

              {/* Test Email */}
              <div>
                <label style={{ ...labelStyle, marginBottom: "8px" }}>
                  Send Test Email
                </label>
                <div style={{ display: "flex", gap: "8px" }}>
                  <input
                    type="email"
                    value={testEmail}
                    onChange={(e) => {
                      setTestEmail(e.target.value);
                      setTestFeedback(null);
                    }}
                    placeholder="test@example.com"
                    style={{ ...inputStyle, flex: 1 }}
                  />
                  <button
                    type="button"
                    onClick={handleSendTest}
                    disabled={sendingTest}
                    style={{
                      padding: "8px 16px",
                      backgroundColor: "#1a1f2e",
                      color: "#e2e8f0",
                      border: "1px solid #e2e8f0",
                      borderRadius: "8px",
                      fontSize: "13px",
                      fontWeight: 500,
                      cursor: sendingTest ? "not-allowed" : "pointer",
                      opacity: sendingTest ? 0.5 : 1,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {sendingTest ? "Sending..." : "Send Test"}
                  </button>
                </div>
                {testFeedback && (
                  <div
                    style={{
                      marginTop: "8px",
                      fontSize: "13px",
                      color:
                        testFeedback.type === "success"
                          ? "#4ade80"
                          : "#f87171",
                    }}
                  >
                    {testFeedback.message}
                  </div>
                )}
              </div>

              {/* Divider */}
              <div
                style={{
                  borderTop: "1px solid #e2e8f0",
                  margin: "4px 0",
                }}
              />

              {/* Form Actions */}
              <div
                style={{
                  display: "flex",
                  gap: "12px",
                  paddingTop: "4px",
                }}
              >
                <button
                  type="button"
                  onClick={handleSendBroadcast}
                  disabled={sending || !subject.trim() || !htmlBody.trim()}
                  style={{
                    flex: 1,
                    padding: "10px",
                    backgroundColor: "#1a4fff",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "8px",
                    fontSize: "14px",
                    fontWeight: 500,
                    cursor:
                      sending || !subject.trim() || !htmlBody.trim()
                        ? "not-allowed"
                        : "pointer",
                    opacity:
                      sending || !subject.trim() || !htmlBody.trim() ? 0.5 : 1,
                  }}
                >
                  {sending ? "Sending Broadcast..." : "Send Broadcast"}
                </button>
                <button
                  type="button"
                  onClick={closeCompose}
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
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
