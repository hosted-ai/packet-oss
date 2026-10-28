"use client";

import { useState, useEffect, useRef } from "react";
import { Plus, Pencil, Trash2, Check, X, GripVertical, Loader2, HardDrive, RefreshCw, FolderOpen, AlertCircle, ClipboardCopy, Download, ChevronDown, Sheet, FileSpreadsheet } from "lucide-react";
import type { GpuProduct, GpuCategory } from "../types";
import { isPro } from "@/lib/edition";
import { ServicePickerDialog } from "./ServicePickerDialog";
import dynamic from "next/dynamic";

// Token Factory pricing is a premium feature — excluded in OSS build
const TokenFactoryPricingSection = isPro()
  ? dynamic(() => import("./TokenFactoryPricingSection").then(m => ({ default: m.TokenFactoryPricingSection })))
  : () => null;

interface Pool {
  id: number;
  name: string;
  gpuModel?: string;
  regionId?: number;
}

interface StripePrice {
  id: string;
  unitAmount: number | null;
  currency: string;
  interval: string;
  intervalCount: number;
}

interface StripeProduct {
  id: string;
  name: string;
  description: string | null;
  prices: StripePrice[];
}

interface StoragePricing {
  storagePricePerGBHourCents: number;
  updatedAt?: string;
  updatedBy?: string;
}

export function ProductsTab() {
  const [products, setProducts] = useState<GpuProduct[]>([]);
  const [pools, setPools] = useState<Pool[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Categories
  const [categories, setCategories] = useState<GpuCategory[]>([]);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [categoryForm, setCategoryForm] = useState({ name: "", slug: "", description: "", displayOrder: 0, active: true });
  const [savingCategory, setSavingCategory] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Stripe products for monthly billing
  const [stripeProducts, setStripeProducts] = useState<StripeProduct[]>([]);
  const [loadingStripeProducts, setLoadingStripeProducts] = useState(false);

  // Storage pricing state
  const [storagePricing, setStoragePricing] = useState<StoragePricing | null>(null);
  const [storagePriceInput, setStoragePriceInput] = useState("");
  const [savingStorage, setSavingStorage] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    billingType: "hourly" as "hourly" | "monthly",
    pricePerHour: "",
    pricePerMonth: "",
    stripeProductId: "" as string,
    stripePriceId: "" as string,
    poolIds: [] as number[],
    displayOrder: 0,
    active: true,
    featured: false,
    badgeText: "",
    vramGb: "",
    cudaCores: "",
    gpuFamily: "",
    supportsSharedStorage: true,
    serviceId: "" as string,
    categoryIds: [] as string[],
  });
  const [servicePickerOpen, setServicePickerOpen] = useState(false);

  // Load products, pools, and storage pricing
  const loadData = async () => {
    setLoading(true);
    try {
      const [productsRes, poolsRes, pricingRes] = await Promise.all([
        fetch("/api/admin/gpu-products"),
        fetch("/api/admin/pool-settings"),
        fetch("/api/admin/pricing"),
      ]);

      const productsData = await productsRes.json();
      const poolsData = await poolsRes.json();
      const pricingData = await pricingRes.json();

      if (productsData.success) {
        setProducts(productsData.data);
        if (productsData.categories) {
          setCategories(productsData.categories);
        }
      }
      if (poolsData.success && poolsData.data.availablePools) {
        setPools(poolsData.data.availablePools);
      }
      if (pricingData.pricing) {
        setStoragePricing(pricingData.pricing);
        // Convert cents to dollars for display (8 decimal places)
        const priceInDollars = pricingData.pricing.storagePricePerGBHourCents / 100;
        setStoragePriceInput(priceInDollars.toFixed(8));
      }
    } catch (error) {
      console.error("Failed to load data:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Load Stripe products for monthly billing picker
  const loadStripeProducts = async () => {
    setLoadingStripeProducts(true);
    try {
      const res = await fetch("/api/admin/stripe-products");
      const data = await res.json();
      if (data.success) {
        setStripeProducts(data.data);
      }
    } catch (error) {
      console.error("Failed to load Stripe products:", error);
    } finally {
      setLoadingStripeProducts(false);
    }
  };

  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");
  const exportMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!exportMenuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setExportMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [exportMenuOpen]);

  const buildExportRows = (variant: "full" | "marketing") => {
    const categoryNameById = new Map(categories.map(c => [c.id, c.name]));
    const fullHeaders = [
      "id", "name", "gpuFamily", "billingType",
      "pricePerHour", "pricePerMonth", "vramGb", "cudaCores",
      "active", "featured", "badgeText", "displayOrder",
      "stripeProductId", "stripePriceId", "serviceId", "poolIds",
      "categories", "description", "updatedAt",
    ];
    const marketingHeaders = [
      "name", "gpuFamily", "billingType",
      "pricePerHour", "pricePerMonth",
      "vramGb", "active", "featured", "badgeText", "description",
    ];
    const headers = variant === "full" ? fullHeaders : marketingHeaders;
    const rows = products.map(p => {
      const full: Record<string, string | number | boolean> = {
        id: p.id,
        name: p.name,
        gpuFamily: p.gpuFamily ?? "",
        billingType: p.billingType,
        pricePerHour: (p.pricePerHourCents / 100).toFixed(2),
        pricePerMonth: p.pricePerMonthCents != null ? (p.pricePerMonthCents / 100).toFixed(2) : "",
        vramGb: p.vramGb ?? "",
        cudaCores: p.cudaCores ?? "",
        active: p.active,
        featured: p.featured,
        badgeText: p.badgeText ?? "",
        displayOrder: p.displayOrder,
        stripeProductId: p.stripeProductId ?? "",
        stripePriceId: p.stripePriceId ?? "",
        serviceId: p.serviceId ?? "",
        poolIds: p.poolIds.join(","),
        categories: p.categoryIds.map(id => categoryNameById.get(id) ?? id).join(","),
        description: p.description ?? "",
        updatedAt: p.updatedAt,
      };
      return headers.map(h => full[h]);
    });
    return { headers, rows };
  };

  const toDelimited = (headers: string[], rows: (string | number | boolean)[][], delim: "\t" | ",") => {
    const escape = (v: unknown) => {
      const s = v === null || v === undefined ? "" : String(v);
      if (delim === ",") {
        // CSV: quote if contains comma, quote, or newline; escape inner quotes
        if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
        return s;
      }
      // TSV: strip tabs/newlines
      return s.replace(/\t/g, " ").replace(/\r?\n/g, " ");
    };
    return [headers.map(escape).join(delim), ...rows.map(r => r.map(escape).join(delim))].join("\n");
  };

  const handleCopyTsv = async (variant: "full" | "marketing") => {
    const { headers, rows } = buildExportRows(variant);
    const tsv = toDelimited(headers, rows, "\t");
    try {
      await navigator.clipboard.writeText(tsv);
      setCopyState("copied");
      setExportMenuOpen(false);
      setTimeout(() => setCopyState("idle"), 2000);
    } catch (err) {
      console.error("Failed to copy TSV:", err);
      alert("Copy failed — check console");
    }
  };

  const familyColorHex = (family: string | null): { bg: string; fg: string } => {
    const f = (family ?? "").toUpperCase();
    if (f.includes("B200")) return { bg: "#fae8ff", fg: "#86198f" };
    if (f.includes("H100") || f.includes("H200")) return { bg: "#ffe4e6", fg: "#9f1239" };
    if (f.includes("A100")) return { bg: "#ffedd5", fg: "#9a3412" };
    if (f.includes("L40")) return { bg: "#cffafe", fg: "#155e75" };
    if (f.includes("RTX 6000") || f.includes("6000 PRO")) return { bg: "#d1fae5", fg: "#065f46" };
    if (f.includes("RTX 5090") || f.includes("5090")) return { bg: "#ecfccb", fg: "#3f6212" };
    if (f.includes("RTX")) return { bg: "#ccfbf1", fg: "#115e59" };
    return { bg: "#f1f5f9", fg: "#334155" };
  };

  const handleCopyHtml = async (variant: "full" | "marketing") => {
    const categoryNameById = new Map(categories.map(c => [c.id, c.name]));
    const fullCols = [
      "name", "gpuFamily", "billingType",
      "pricePerHour", "pricePerMonth", "vramGb", "cudaCores",
      "active", "featured", "badgeText", "displayOrder",
      "stripeProductId", "stripePriceId", "serviceId", "poolIds",
      "categories", "description",
    ];
    const marketingCols = [
      "name", "gpuFamily", "billingType",
      "pricePerHour", "pricePerMonth",
      "vramGb", "active", "featured", "badgeText", "description",
    ];
    const cols = variant === "full" ? fullCols : marketingCols;
    const esc = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

    const headerHtml = cols
      .map(c => `<th style="background:#1a4fff;color:#fff;padding:8px 12px;font:600 12px/1.4 -apple-system,sans-serif;text-align:left;letter-spacing:0.04em;text-transform:uppercase;">${esc(c)}</th>`)
      .join("");

    const cellStyle = (extra = "") =>
      `padding:8px 12px;font:13px/1.5 -apple-system,sans-serif;border-bottom:1px solid #e4e7ef;${extra}`;

    const bodyHtml = products.map(p => {
      const family = familyColorHex(p.gpuFamily);
      const billingBg = p.billingType === "monthly" ? "#e0e7ff" : "#e0f2fe";
      const billingFg = p.billingType === "monthly" ? "#3730a3" : "#0369a1";
      const activeBg = p.active ? "#dcfce7" : "#f1f5f9";
      const activeFg = p.active ? "#15803d" : "#64748b";
      const featuredBg = p.featured ? "#fef3c7" : "transparent";
      const featuredFg = p.featured ? "#92400e" : "#64748b";

      const cellFor = (c: string): string => {
        switch (c) {
          case "name":
            return `<td style="${cellStyle("font-weight:600;color:#0b0f1c;")}">${esc(p.name)}</td>`;
          case "gpuFamily":
            return `<td style="${cellStyle(`background:${family.bg};color:${family.fg};font-weight:600;`)}">${esc(p.gpuFamily ?? "")}</td>`;
          case "billingType":
            return `<td style="${cellStyle(`background:${billingBg};color:${billingFg};font-weight:600;text-transform:uppercase;font-size:11px;letter-spacing:0.05em;`)}">${esc(p.billingType)}</td>`;
          case "pricePerHour":
            return `<td style="${cellStyle("font-family:ui-monospace,Menlo,monospace;color:#0b0f1c;")}">$${(p.pricePerHourCents / 100).toFixed(2)}</td>`;
          case "pricePerMonth":
            return `<td style="${cellStyle("font-family:ui-monospace,Menlo,monospace;color:#0b0f1c;")}">${p.pricePerMonthCents != null ? `$${(p.pricePerMonthCents / 100).toFixed(2)}` : "—"}</td>`;
          case "vramGb":
            return `<td style="${cellStyle("font-family:ui-monospace,Menlo,monospace;")}">${p.vramGb ?? ""}</td>`;
          case "cudaCores":
            return `<td style="${cellStyle("font-family:ui-monospace,Menlo,monospace;")}">${p.cudaCores ?? ""}</td>`;
          case "active":
            return `<td style="${cellStyle(`background:${activeBg};color:${activeFg};font-weight:600;`)}">${p.active ? "Active" : "Inactive"}</td>`;
          case "featured":
            return `<td style="${cellStyle(`background:${featuredBg};color:${featuredFg};${p.featured ? "font-weight:600;" : ""}`)}">${p.featured ? "Featured" : ""}</td>`;
          case "badgeText":
            return `<td style="${cellStyle(p.badgeText ? "background:#ede9fe;color:#6d28d9;font-weight:600;" : "")}">${esc(p.badgeText ?? "")}</td>`;
          case "displayOrder":
            return `<td style="${cellStyle("color:#64748b;text-align:right;")}">${p.displayOrder}</td>`;
          case "stripeProductId":
            return `<td style="${cellStyle(p.stripeProductId ? "font-family:ui-monospace,Menlo,monospace;color:#0b0f1c;" : "color:#94a3b8;font-style:italic;")}">${esc(p.stripeProductId ?? "—")}</td>`;
          case "stripePriceId":
            return `<td style="${cellStyle(p.stripePriceId ? "font-family:ui-monospace,Menlo,monospace;color:#0b0f1c;" : "color:#94a3b8;font-style:italic;")}">${esc(p.stripePriceId ?? "—")}</td>`;
          case "serviceId":
            return `<td style="${cellStyle(p.serviceId ? "font-family:ui-monospace,Menlo,monospace;font-size:11px;" : "color:#94a3b8;font-style:italic;")}">${esc(p.serviceId ?? "—")}</td>`;
          case "poolIds":
            return `<td style="${cellStyle(p.poolIds.length ? "" : "color:#94a3b8;font-style:italic;")}">${esc(p.poolIds.length ? p.poolIds.join(", ") : "—")}</td>`;
          case "categories": {
            const cats = p.categoryIds.map(id => categoryNameById.get(id) ?? id).join(", ");
            return `<td style="${cellStyle(cats ? "" : "color:#94a3b8;font-style:italic;")}">${esc(cats || "—")}</td>`;
          }
          case "description":
            return `<td style="${cellStyle("color:#64748b;")}">${esc(p.description ?? "")}</td>`;
          default:
            return `<td style="${cellStyle()}"></td>`;
        }
      };
      return `<tr>${cols.map(cellFor).join("")}</tr>`;
    }).join("");

    const html = `<meta charset="utf-8"><table style="border-collapse:collapse;">${
      `<thead><tr>${headerHtml}</tr></thead>`
    }<tbody>${bodyHtml}</tbody></table>`;

    // Plain-text fallback so non-HTML targets still get usable TSV
    const { headers: tsvHeaders, rows: tsvRows } = buildExportRows(variant);
    const plain = toDelimited(tsvHeaders, tsvRows, "\t");

    try {
      const item = new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([plain], { type: "text/plain" }),
      });
      await navigator.clipboard.write([item]);
      setCopyState("copied");
      setExportMenuOpen(false);
      setTimeout(() => setCopyState("idle"), 2000);
    } catch (err) {
      console.error("Failed to copy HTML, falling back to TSV:", err);
      try {
        await navigator.clipboard.writeText(plain);
        setCopyState("copied");
        setExportMenuOpen(false);
        setTimeout(() => setCopyState("idle"), 2000);
      } catch (err2) {
        console.error("Plain copy also failed:", err2);
        alert("Copy failed — check console");
      }
    }
  };

  const handleDownloadCsv = () => {
    const { headers, rows } = buildExportRows("full");
    const csv = toDelimited(headers, rows, ",");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const ts = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `gpu-products-${ts}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setExportMenuOpen(false);
  };

  const resetForm = () => {
    setFormData({
      name: "",
      description: "",
      billingType: "hourly",
      pricePerHour: "",
      pricePerMonth: "",
      stripeProductId: "",
      stripePriceId: "",
      poolIds: [],
      displayOrder: 0,
      active: true,
      featured: false,
      badgeText: "",
      vramGb: "",
      cudaCores: "",
      gpuFamily: "",
      supportsSharedStorage: true,
      serviceId: "",
      categoryIds: [],
    });
  };

  const openEditModal = (product: GpuProduct) => {
    setFormData({
      name: product.name,
      description: product.description || "",
      billingType: product.billingType || "hourly",
      pricePerHour: (product.pricePerHourCents / 100).toFixed(2),
      pricePerMonth: product.pricePerMonthCents ? (product.pricePerMonthCents / 100).toFixed(2) : "",
      stripeProductId: product.stripeProductId || "",
      stripePriceId: product.stripePriceId || "",
      poolIds: product.poolIds,
      displayOrder: product.displayOrder,
      active: product.active,
      featured: product.featured,
      badgeText: product.badgeText || "",
      vramGb: product.vramGb?.toString() || "",
      cudaCores: product.cudaCores?.toString() || "",
      gpuFamily: product.gpuFamily || "",
      supportsSharedStorage: product.supportsSharedStorage,
      serviceId: product.serviceId || "",
      categoryIds: product.categoryIds || [],
    });
    setEditingId(product.id);
    setShowCreateModal(true);
    if (product.billingType === "monthly") {
      loadStripeProducts();
    }
  };

  const handleSave = async () => {
    const isMonthly = formData.billingType === "monthly";

    if (!formData.name) {
      alert("Name is required");
      return;
    }
    if (!isMonthly && !formData.pricePerHour) {
      alert("Price per hour is required for hourly products");
      return;
    }
    if (isMonthly && !formData.pricePerMonth) {
      alert("Price per month is required for monthly products");
      return;
    }
    if (!formData.serviceId) {
      alert("HAI Service is required");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        action: editingId ? "update" : "create",
        id: editingId,
        name: formData.name,
        description: formData.description || null,
        billingType: formData.billingType,
        pricePerHourCents: isMonthly ? 0 : Math.round(parseFloat(formData.pricePerHour) * 100),
        pricePerMonthCents: isMonthly && formData.pricePerMonth ? Math.round(parseFloat(formData.pricePerMonth) * 100) : null,
        stripeProductId: isMonthly && formData.stripeProductId ? formData.stripeProductId : null,
        stripePriceId: isMonthly && formData.stripePriceId ? formData.stripePriceId : null,
        poolIds: formData.poolIds,
        displayOrder: formData.displayOrder,
        active: formData.active,
        featured: formData.featured,
        badgeText: formData.badgeText || null,
        vramGb: formData.vramGb ? parseInt(formData.vramGb) : null,
        cudaCores: formData.cudaCores ? parseInt(formData.cudaCores) : null,
        gpuFamily: formData.gpuFamily || null,
        supportsSharedStorage: formData.supportsSharedStorage,
        serviceId: formData.serviceId || null,
        categoryIds: formData.categoryIds,
      };

      const post = (body: Record<string, unknown>) =>
        fetch("/api/admin/gpu-products", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }).then((r) => r.json());

      let data = await post(payload);
      // The server refuses to withdraw a monthly product its subscribers still pay
      // for. Confirming here is the only way an intended withdrawal gets through.
      if (data.requiresForce && confirm(`${data.error}\n\nWithdraw it anyway?`)) {
        data = await post({ ...payload, force: true });
      }
      if (data.success) {
        setShowCreateModal(false);
        setEditingId(null);
        resetForm();
        loadData();
      } else if (!data.requiresForce) {
        alert(data.error || "Failed to save product");
      }
    } catch (error) {
      console.error("Save error:", error);
      alert("Failed to save product");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this product?")) return;

    try {
      const res = await fetch("/api/admin/gpu-products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", id }),
      });

      const data = await res.json();
      if (data.success) {
        loadData();
      } else {
        alert(data.error || "Failed to delete product");
      }
    } catch (error) {
      console.error("Delete error:", error);
      alert("Failed to delete product");
    }
  };

  // Category CRUD handlers
  const handleSaveCategory = async () => {
    if (!categoryForm.name) { alert("Category name is required"); return; }
    setSavingCategory(true);
    try {
      const res = await fetch("/api/admin/gpu-products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: editingCategoryId ? "update-category" : "create-category",
          id: editingCategoryId,
          ...categoryForm,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setShowCategoryModal(false);
        setEditingCategoryId(null);
        setCategoryForm({ name: "", slug: "", description: "", displayOrder: 0, active: true });
        loadData();
      } else {
        alert(data.error || "Failed to save category");
      }
    } catch { alert("Failed to save category"); }
    finally { setSavingCategory(false); }
  };

  const handleDeleteCategory = async (id: string) => {
    if (!confirm("Delete this category? Products must be moved first.")) return;
    try {
      const res = await fetch("/api/admin/gpu-products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete-category", id }),
      });
      const data = await res.json();
      if (data.success) { loadData(); }
      else { alert(data.error || "Failed to delete category"); }
    } catch { alert("Failed to delete category"); }
  };

  const getCategoryNames = (categoryIds: string[]) => {
    if (!categoryIds?.length) return "Uncategorized";
    return categoryIds.map(id => categories.find(c => c.id === id)?.name || "Unknown").join(", ");
  };

  const togglePoolAssignment = (poolId: number) => {
    setFormData((prev) => {
      const newPoolIds = prev.poolIds.includes(poolId)
        ? prev.poolIds.filter((id) => id !== poolId)
        : [...prev.poolIds, poolId];

      // Auto-derive gpuFamily from the first selected pool's gpuModel (sourced from
      // hostedai-user gpu_model_type) so the identifier stays consistent with the
      // user panel service record. Only update if not manually overridden.
      const firstPool = pools.find((p) => newPoolIds.includes(p.id));
      const derivedFamily = firstPool?.gpuModel ?? prev.gpuFamily;

      return { ...prev, poolIds: newPoolIds, gpuFamily: derivedFamily ?? "" };
    });
  };

  // Get pool name by ID
  const getPoolName = (poolId: number) => {
    const pool = pools.find((p) => p.id === poolId);
    return pool?.name || `Pool ${poolId}`;
  };

  // Save storage pricing
  const handleSaveStoragePricing = async () => {
    const priceValue = parseFloat(storagePriceInput);
    if (isNaN(priceValue) || priceValue < 0) {
      alert("Please enter a valid storage price");
      return;
    }

    setSavingStorage(true);
    try {
      // Convert dollars to cents (8 decimal places supported)
      const priceInCents = Math.round(priceValue * 100 * 100000000) / 100000000;

      const res = await fetch("/api/admin/pricing", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storagePricePerGBHourCents: priceInCents,
        }),
      });

      const data = await res.json();
      if (data.pricing) {
        setStoragePricing(data.pricing);
        const updatedPriceInDollars = data.pricing.storagePricePerGBHourCents / 100;
        setStoragePriceInput(updatedPriceInDollars.toFixed(8));
      } else {
        alert(data.error || "Failed to save storage pricing");
      }
    } catch (error) {
      console.error("Save storage pricing error:", error);
      alert("Failed to save storage pricing");
    } finally {
      setSavingStorage(false);
    }
  };

  // Return other products that already include this pool (pools may be shared)
  const getOtherProductsForPool = (poolId: number, excludeProductId?: string) => {
    return products.filter(
      (p) => p.id !== excludeProductId && p.poolIds.includes(poolId)
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-[#1a4fff]" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-[#0b0f1c]">GPU Products</h2>
          <p className="text-sm text-[#5b6476]">
            Create pricing categories and assign pools to products
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative" ref={exportMenuRef}>
            <button
              onClick={() => setExportMenuOpen(o => !o)}
              disabled={products.length === 0}
              title="Export GPU products"
              className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-all ${
                copyState === "copied"
                  ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                  : exportMenuOpen
                  ? "bg-[#eef2ff] border-[#c7d2fe] text-[#1a4fff]"
                  : "bg-white border-[#e4e7ef] text-[#0b0f1c] hover:bg-[#f7f8fb] hover:border-[#c7d2fe]"
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {copyState === "copied" ? (
                <>
                  <Check className="w-4 h-4" />
                  <span className="text-sm font-medium">Copied</span>
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  <span className="text-sm font-medium">Export</span>
                  <ChevronDown className={`w-4 h-4 transition-transform ${exportMenuOpen ? "rotate-180" : ""}`} />
                </>
              )}
            </button>
            {exportMenuOpen && (
              <div className="absolute right-0 top-full mt-2 w-[22rem] bg-white rounded-xl border border-[#e4e7ef] shadow-xl z-20 overflow-hidden">
                <div className="px-4 py-2.5 bg-gradient-to-r from-[#eef2ff] to-[#f7f8fb] border-b border-[#e4e7ef]">
                  <p className="text-xs font-semibold text-[#0b0f1c] uppercase tracking-wide">Export {products.length} products</p>
                  <p className="text-[11px] text-[#5b6476] mt-0.5">Paste straight into Google Sheets</p>
                </div>

                <button
                  onClick={() => handleCopyHtml("marketing")}
                  className="w-full flex items-start gap-3 px-4 py-3 hover:bg-[#f7f8fb] text-left transition-colors border-b border-[#f1f3f8]"
                >
                  <div className="p-2 bg-gradient-to-br from-emerald-100 to-emerald-50 ring-1 ring-emerald-200 rounded-lg shrink-0">
                    <Sheet className="w-4 h-4 text-emerald-700" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-[#0b0f1c]">Copy for marketing</p>
                      <span className="px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider bg-emerald-100 text-emerald-700 rounded">colored</span>
                    </div>
                    <p className="text-xs text-[#5b6476] leading-snug mt-0.5">Pricing-focused, colored cells per GPU family</p>
                  </div>
                </button>

                <button
                  onClick={() => handleCopyHtml("full")}
                  className="w-full flex items-start gap-3 px-4 py-3 hover:bg-[#f7f8fb] text-left transition-colors border-b border-[#f1f3f8]"
                >
                  <div className="p-2 bg-gradient-to-br from-blue-100 to-blue-50 ring-1 ring-blue-200 rounded-lg shrink-0">
                    <ClipboardCopy className="w-4 h-4 text-[#1a4fff]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-[#0b0f1c]">Copy full (all fields)</p>
                      <span className="px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider bg-blue-100 text-blue-700 rounded">colored</span>
                    </div>
                    <p className="text-xs text-[#5b6476] leading-snug mt-0.5">Includes Stripe IDs, HAI service, pools</p>
                  </div>
                </button>

                <div className="px-4 pt-2.5 pb-1 bg-[#f7f8fb]/50 border-t border-[#f1f3f8]">
                  <p className="text-[10px] font-semibold text-[#5b6476] uppercase tracking-wide">Plain formats</p>
                </div>

                <button
                  onClick={() => handleCopyTsv("marketing")}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-[#f7f8fb] text-left transition-colors"
                >
                  <div className="p-1.5 bg-slate-100 rounded-md shrink-0">
                    <ClipboardCopy className="w-3.5 h-3.5 text-slate-600" />
                  </div>
                  <p className="text-xs text-[#0b0f1c]">Copy as plain TSV (marketing)</p>
                </button>

                <button
                  onClick={() => handleCopyTsv("full")}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-[#f7f8fb] text-left transition-colors border-t border-[#f1f3f8]"
                >
                  <div className="p-1.5 bg-slate-100 rounded-md shrink-0">
                    <ClipboardCopy className="w-3.5 h-3.5 text-slate-600" />
                  </div>
                  <p className="text-xs text-[#0b0f1c]">Copy as plain TSV (full)</p>
                </button>

                <button
                  onClick={handleDownloadCsv}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-[#f7f8fb] text-left transition-colors border-t border-[#f1f3f8]"
                >
                  <div className="p-1.5 bg-amber-100 rounded-md shrink-0">
                    <FileSpreadsheet className="w-3.5 h-3.5 text-amber-700" />
                  </div>
                  <p className="text-xs text-[#0b0f1c]">Download CSV file</p>
                </button>
              </div>
            )}
          </div>
          <button
            onClick={() => {
              resetForm();
              setEditingId(null);
              setShowCreateModal(true);
            }}
            className="flex items-center gap-2 px-4 py-2 bg-[#1a4fff] text-white rounded-lg hover:bg-[#1a4fff]/90 transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span className="text-sm font-medium">Add Product</span>
          </button>
        </div>
      </div>

      {/* Storage Pricing Section */}
      <div className="bg-white rounded-xl border border-[#e4e7ef] p-6">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-[#f7f8fb] rounded-lg">
            <HardDrive className="w-6 h-6 text-[#1a4fff]" />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-semibold text-[#0b0f1c] mb-1">
              Storage Pricing
            </h3>
            <p className="text-sm text-[#5b6476] mb-4">
              Universal storage rate applied to all pods. Set to 0 for free storage.
            </p>
            <div className="flex items-end gap-4">
              <div className="flex-1 max-w-xs">
                <label className="block text-sm font-medium text-[#0b0f1c] mb-1">
                  Price per GB per Hour ($)
                </label>
                <input
                  type="number"
                  step="0.00000001"
                  min="0"
                  value={storagePriceInput}
                  onChange={(e) => setStoragePriceInput(e.target.value)}
                  placeholder="e.g., 0.00010000"
                  className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1a4fff] font-mono text-sm"
                />
                <p className="text-xs text-[#5b6476] mt-1">
                  Supports up to 8 decimal places (e.g., $0.00000001)
                </p>
              </div>
              <button
                onClick={handleSaveStoragePricing}
                disabled={savingStorage}
                className="flex items-center gap-2 px-4 py-2 bg-[#1a4fff] text-white rounded-lg hover:bg-[#1a4fff]/90 transition-colors disabled:opacity-50"
              >
                {savingStorage ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Check className="w-4 h-4" />
                )}
                Save
              </button>
            </div>
            {storagePricing?.updatedAt && (
              <p className="text-xs text-[#5b6476] mt-3">
                Last updated: {new Date(storagePricing.updatedAt).toLocaleString()}
                {storagePricing.updatedBy && ` by ${storagePricing.updatedBy}`}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* GPU Categories */}
      <div className="bg-white rounded-xl border border-[#e4e7ef] p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-[#f7f8fb] rounded-lg">
              <FolderOpen className="w-5 h-5 text-[#1a4fff]" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-[#0b0f1c]">GPU Categories</h3>
              <p className="text-xs text-[#5b6476]">Organize products by GPU type. Each category maps to an HAI scenario.</p>
            </div>
          </div>
          <button
            onClick={() => {
              setCategoryForm({ name: "", slug: "", description: "", displayOrder: 0, active: true });
              setEditingCategoryId(null);
              setShowCategoryModal(true);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-[#1a4fff] text-white rounded-lg hover:bg-[#1a4fff]/90 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Category
          </button>
        </div>
        {categories.length === 0 ? (
          <p className="text-sm text-[#5b6476] py-4 text-center">No categories yet. Create one to organize your GPU products.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {categories.map(cat => (
              <div key={cat.id} className={`rounded-lg border p-3 ${cat.active ? "border-[#e4e7ef]" : "border-dashed border-gray-300 opacity-60"}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-sm text-[#0b0f1c]">{cat.name}</span>
                  <div className="flex items-center gap-1">
                    {(() => {
                      // One copy button per plan type the category actually offers
                      // (hr / mo). Untagged categories default to hourly.
                      const catProducts = products.filter(p => p.categoryIds?.includes(cat.id));
                      const plans: ("hourly" | "monthly")[] = [];
                      if (catProducts.some(p => p.billingType === "hourly")) plans.push("hourly");
                      if (catProducts.some(p => p.billingType === "monthly")) plans.push("monthly");
                      if (plans.length === 0) plans.push("hourly");
                      return plans.map(plan => {
                        const key = `${cat.id}:${plan}`;
                        return (
                          <button
                            key={key}
                            onClick={async () => {
                              const base = process.env.NEXT_PUBLIC_APP_URL || window.location.origin;
                              const url = `${base}/account?gpu=${encodeURIComponent(cat.slug)}&plan=${plan}`;
                              try {
                                await navigator.clipboard.writeText(url);
                                setCopiedKey(key);
                                setTimeout(() => setCopiedKey(null), 1500);
                              } catch {
                                window.prompt("Copy this deep link:", url);
                              }
                            }}
                            className="flex items-center gap-0.5 p-1 text-[#5b6476] hover:text-[#1a4fff] rounded"
                            title={`Copy ${plan} deeplink → /account?gpu=${cat.slug}&plan=${plan}`}
                          >
                            {copiedKey === key
                              ? <Check className="w-3 h-3 text-green-600" />
                              : <ClipboardCopy className="w-3 h-3" />}
                            <span className="text-[10px] leading-none">{plan === "hourly" ? "hr" : "mo"}</span>
                          </button>
                        );
                      });
                    })()}
                    <button onClick={() => {
                      setCategoryForm({ name: cat.name, slug: cat.slug, description: cat.description || "", displayOrder: cat.displayOrder, active: cat.active });
                      setEditingCategoryId(cat.id);
                      setShowCategoryModal(true);
                    }} className="p-1 text-[#5b6476] hover:text-[#1a4fff] rounded" title="Edit">
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button onClick={() => handleDeleteCategory(cat.id)} className="p-1 text-[#5b6476] hover:text-red-600 rounded" title="Delete">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-xs text-[#5b6476]">
                  <span>{products.filter(p => p.categoryIds?.includes(cat.id)).length} products</span>
                  {!cat.scenarioId && (
                    <span className="flex items-center gap-0.5 text-amber-600" title="HAI scenario not configured">
                      <AlertCircle className="w-3 h-3" /> Pending
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Category Create/Edit Modal */}
      {showCategoryModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="p-6 border-b border-[#e4e7ef]">
              <h3 className="text-lg font-semibold text-[#0b0f1c]">
                {editingCategoryId ? "Edit Category" : "Create Category"}
              </h3>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-[#0b0f1c] mb-1">Name *</label>
                <input
                  type="text"
                  value={categoryForm.name}
                  onChange={e => setCategoryForm({ ...categoryForm, name: e.target.value, slug: e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") })}
                  placeholder="e.g., H100"
                  className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1a4fff]"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#0b0f1c] mb-1">Slug</label>
                <input
                  type="text"
                  value={categoryForm.slug}
                  onChange={e => setCategoryForm({ ...categoryForm, slug: e.target.value })}
                  placeholder="auto-generated"
                  className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1a4fff] font-mono text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#0b0f1c] mb-1">Description</label>
                <input
                  type="text"
                  value={categoryForm.description}
                  onChange={e => setCategoryForm({ ...categoryForm, description: e.target.value })}
                  placeholder="Optional"
                  className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1a4fff]"
                />
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={categoryForm.active}
                  onChange={e => setCategoryForm({ ...categoryForm, active: e.target.checked })}
                  className="w-4 h-4 rounded border-[#e4e7ef] text-[#1a4fff] focus:ring-[#1a4fff]"
                />
                <span className="text-sm text-[#0b0f1c]">Active</span>
              </label>
            </div>
            <div className="p-6 border-t border-[#e4e7ef] flex justify-end gap-3">
              <button onClick={() => { setShowCategoryModal(false); setEditingCategoryId(null); }} className="px-4 py-2 text-[#5b6476] hover:bg-[#f7f8fb] rounded-lg transition-colors">Cancel</button>
              <button onClick={handleSaveCategory} disabled={savingCategory} className="flex items-center gap-2 px-4 py-2 bg-[#1a4fff] text-white rounded-lg hover:bg-[#1a4fff]/90 disabled:opacity-50">
                {savingCategory && <Loader2 className="w-4 h-4 animate-spin" />}
                {editingCategoryId ? "Save" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Products Table */}
      <div className="bg-white rounded-xl border border-[#e4e7ef] overflow-hidden">
        <table className="w-full">
          <thead className="bg-[#f7f8fb] border-b border-[#e4e7ef]">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-[#5b6476] uppercase tracking-wider w-8">
                #
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-[#5b6476] uppercase tracking-wider">
                Product Name
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-[#5b6476] uppercase tracking-wider">
                Category
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-[#5b6476] uppercase tracking-wider">
                Pricing
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-[#5b6476] uppercase tracking-wider">
                Assigned Pools
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-[#5b6476] uppercase tracking-wider">
                Status
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-[#5b6476] uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#e4e7ef]">
            {products.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-[#5b6476]">
                  No products yet. Click &quot;Add Product&quot; to create one.
                </td>
              </tr>
            ) : (
              products.map((product) => (
                <tr key={product.id} className="hover:bg-[#f7f8fb]/50">
                  <td className="px-4 py-3">
                    <GripVertical className="w-4 h-4 text-[#5b6476]/50" />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-[#0b0f1c]">
                        {product.name}
                      </span>
                      {product.featured && (
                        <span className="px-2 py-0.5 text-xs bg-amber-100 text-amber-700 rounded">
                          Featured
                        </span>
                      )}
                      {product.badgeText && (
                        <span className="px-2 py-0.5 text-xs bg-violet-100 text-violet-700 rounded">
                          {product.badgeText}
                        </span>
                      )}
                    </div>
                    {product.description && (
                      <p className="text-xs text-[#5b6476] mt-0.5">
                        {product.description}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 text-xs bg-[#f7f8fb] text-[#5b6476] rounded">
                      {getCategoryNames(product.categoryIds)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className={`px-1.5 py-0.5 text-[10px] font-semibold uppercase rounded ${
                        product.billingType === "monthly"
                          ? "bg-indigo-100 text-indigo-700"
                          : "bg-sky-100 text-sky-700"
                      }`}>
                        {product.billingType === "monthly" ? "Monthly" : "Hourly"}
                      </span>
                      <span className="font-mono text-[#0b0f1c]">
                        {product.billingType === "monthly" && product.pricePerMonthCents
                          ? `$${(product.pricePerMonthCents / 100).toFixed(2)}/mo`
                          : `$${(product.pricePerHourCents / 100).toFixed(2)}/hr`}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {product.poolIds.length === 0 ? (
                      <span className="text-[#5b6476] text-sm">No pools assigned</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {product.poolIds.slice(0, 3).map((poolId) => (
                          <span
                            key={poolId}
                            className="px-2 py-0.5 text-xs bg-[#f7f8fb] text-[#5b6476] rounded"
                          >
                            {getPoolName(poolId)}
                          </span>
                        ))}
                        {product.poolIds.length > 3 && (
                          <span className="px-2 py-0.5 text-xs bg-[#f7f8fb] text-[#5b6476] rounded">
                            +{product.poolIds.length - 3} more
                          </span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded ${
                        product.active
                          ? "bg-green-100 text-green-700"
                          : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {product.active ? (
                        <>
                          <Check className="w-3 h-3" /> Active
                        </>
                      ) : (
                        <>
                          <X className="w-3 h-3" /> Inactive
                        </>
                      )}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => openEditModal(product)}
                        className="p-1.5 text-[#5b6476] hover:text-[#1a4fff] hover:bg-[#1a4fff]/10 rounded transition-colors"
                        title="Edit"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(product.id)}
                        className="p-1.5 text-[#5b6476] hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Token Factory Pricing */}
      <TokenFactoryPricingSection />

      {/* Create/Edit Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className={`rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto ${
            formData.billingType === "monthly"
              ? "bg-indigo-50 ring-2 ring-indigo-200"
              : "bg-white"
          }`}>
            <div className={`p-6 border-b ${
              formData.billingType === "monthly"
                ? "border-indigo-200"
                : "border-[#e4e7ef]"
            }`}>
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-[#0b0f1c]">
                  {editingId ? "Edit Product" : "Create Product"}
                </h3>
                {formData.billingType === "monthly" && (
                  <span className="px-2.5 py-1 text-xs font-semibold bg-indigo-100 text-indigo-700 rounded-full">
                    Stripe Subscription
                  </span>
                )}
              </div>
            </div>

            <div className="p-6 space-y-6">
              {/* Billing Type Toggle */}
              <div>
                <label className="block text-sm font-medium text-[#0b0f1c] mb-2">
                  Billing Type
                </label>
                <div className="flex rounded-lg border border-[#e4e7ef] overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, billingType: "hourly" })}
                    className={`flex-1 px-4 py-2.5 text-sm font-medium transition-colors ${
                      formData.billingType === "hourly"
                        ? "bg-sky-600 text-white"
                        : "bg-white text-[#5b6476] hover:bg-[#f7f8fb]"
                    }`}
                  >
                    Hourly (Wallet)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setFormData({ ...formData, billingType: "monthly" });
                      if (stripeProducts.length === 0) loadStripeProducts();
                    }}
                    className={`flex-1 px-4 py-2.5 text-sm font-medium transition-colors ${
                      formData.billingType === "monthly"
                        ? "bg-indigo-600 text-white"
                        : "bg-white text-[#5b6476] hover:bg-[#f7f8fb]"
                    }`}
                  >
                    Monthly (Stripe)
                  </button>
                </div>
                <p className="text-xs text-[#5b6476] mt-1.5">
                  {formData.billingType === "hourly"
                    ? "Hourly products are billed from the user's wallet balance."
                    : "Monthly products use a Stripe recurring subscription."}
                </p>
              </div>

              {/* Basic Info */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[#0b0f1c] mb-1">
                    Product Name *
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) =>
                      setFormData({ ...formData, name: e.target.value })
                    }
                    placeholder="e.g., RTX 6000 Ada"
                    className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1a4fff] bg-white"
                  />
                </div>
                <div>
                  {formData.billingType === "hourly" ? (
                    <>
                      <label className="block text-sm font-medium text-[#0b0f1c] mb-1">
                        Price per Hour ($) *
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={formData.pricePerHour}
                        onChange={(e) =>
                          setFormData({ ...formData, pricePerHour: e.target.value })
                        }
                        placeholder="e.g., 2.00"
                        className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1a4fff] bg-white"
                      />
                    </>
                  ) : (
                    <>
                      <label className="block text-sm font-medium text-[#0b0f1c] mb-1">
                        Price per Month ($) *
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={formData.pricePerMonth}
                        onChange={(e) =>
                          setFormData({ ...formData, pricePerMonth: e.target.value })
                        }
                        placeholder="e.g., 199.00"
                        className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                      />
                    </>
                  )}
                </div>
              </div>

              {/* Stripe Product Picker (monthly only) */}
              {formData.billingType === "monthly" && (
                <div className="bg-white rounded-lg border border-indigo-200 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-[#0b0f1c]">
                      Link Stripe Product
                    </label>
                    <button
                      type="button"
                      onClick={loadStripeProducts}
                      disabled={loadingStripeProducts}
                      className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700"
                    >
                      <RefreshCw className={`w-3 h-3 ${loadingStripeProducts ? "animate-spin" : ""}`} />
                      Refresh
                    </button>
                  </div>
                  <p className="text-xs text-[#5b6476] mb-3">
                    Select a Stripe product with a recurring price to link to this product.
                  </p>
                  {loadingStripeProducts ? (
                    <div className="flex items-center justify-center py-4">
                      <Loader2 className="w-5 h-5 animate-spin text-indigo-500" />
                    </div>
                  ) : stripeProducts.length === 0 ? (
                    <p className="text-sm text-[#5b6476] py-2">
                      No Stripe products with recurring prices found.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {stripeProducts.map((sp) => (
                        <div key={sp.id} className="space-y-1">
                          {sp.prices.map((price) => (
                            <label
                              key={price.id}
                              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${
                                formData.stripeProductId === sp.id && formData.stripePriceId === price.id
                                  ? "border-indigo-500 bg-indigo-50"
                                  : "border-[#e4e7ef] hover:border-indigo-300 hover:bg-indigo-50/50"
                              }`}
                            >
                              <input
                                type="radio"
                                name="stripePrice"
                                checked={formData.stripeProductId === sp.id && formData.stripePriceId === price.id}
                                onChange={() => {
                                  setFormData({
                                    ...formData,
                                    stripeProductId: sp.id,
                                    stripePriceId: price.id,
                                    pricePerMonth: price.unitAmount ? (price.unitAmount / 100).toFixed(2) : "",
                                  });
                                }}
                                className="w-4 h-4 text-indigo-600 focus:ring-indigo-500"
                              />
                              <div className="flex-1">
                                <span className="text-sm font-medium text-[#0b0f1c]">{sp.name}</span>
                                <span className="text-xs text-[#5b6476] ml-2">
                                  ${price.unitAmount ? (price.unitAmount / 100).toFixed(2) : "0.00"}/{price.interval}
                                </span>
                              </div>
                              <span className="text-[10px] font-mono text-[#5b6476]">{price.id.slice(0, 20)}...</span>
                            </label>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-[#0b0f1c] mb-1">
                  Description
                </label>
                <input
                  type="text"
                  value={formData.description}
                  onChange={(e) =>
                    setFormData({ ...formData, description: e.target.value })
                  }
                  placeholder="Optional description"
                  className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1a4fff] bg-white"
                />
              </div>

              {/* GPU Specs */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[#0b0f1c] mb-1">
                    VRAM (GB)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={formData.vramGb}
                    onChange={(e) =>
                      setFormData({ ...formData, vramGb: e.target.value })
                    }
                    placeholder="e.g., 48"
                    className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1a4fff]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#0b0f1c] mb-1">
                    Badge Text
                  </label>
                  <input
                    type="text"
                    value={formData.badgeText}
                    onChange={(e) =>
                      setFormData({ ...formData, badgeText: e.target.value })
                    }
                    placeholder="e.g., Popular, Best Value"
                    className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1a4fff]"
                  />
                </div>
              </div>

              {/* GPU Family — auto-derived from pool gpu_model_type, overridable */}
              <div>
                <label className="block text-sm font-medium text-[#0b0f1c] mb-1">
                  GPU Family
                </label>
                <input
                  type="text"
                  value={formData.gpuFamily}
                  onChange={(e) =>
                    setFormData({ ...formData, gpuFamily: e.target.value })
                  }
                  placeholder="Auto-set from pool (e.g. H100, A100, B200)"
                  className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1a4fff]"
                />
                <p className="text-xs text-[#5b6476] mt-1">
                  Groups products in the launch modal filter. Auto-derived from the first assigned pool&apos;s GPU model — override only if needed.
                </p>
              </div>

              {/* Category Assignment (multi-select) */}
              <div>
                <label className="block text-sm font-medium text-[#0b0f1c] mb-1">
                  Categories
                </label>
                <p className="text-xs text-[#5b6476] mb-2">
                  Assign to one or more GPU categories. Product appears in each selected category in the launch modal.
                </p>
                {categories.length === 0 ? (
                  <p className="text-sm text-[#5b6476] py-2">No categories yet. Create one above first.</p>
                ) : (
                  <div className="border border-[#e4e7ef] rounded-lg max-h-36 overflow-y-auto divide-y divide-[#e4e7ef]">
                    {categories.map(cat => (
                      <label key={cat.id} className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-[#f7f8fb]">
                        <input
                          type="checkbox"
                          checked={formData.categoryIds.includes(cat.id)}
                          onChange={() => {
                            setFormData(prev => ({
                              ...prev,
                              categoryIds: prev.categoryIds.includes(cat.id)
                                ? prev.categoryIds.filter(id => id !== cat.id)
                                : [...prev.categoryIds, cat.id],
                            }));
                          }}
                          className="w-4 h-4 rounded border-[#e4e7ef] text-[#1a4fff] focus:ring-[#1a4fff]"
                        />
                        <span className="text-sm font-medium text-[#0b0f1c]">{cat.name}</span>
                        {!cat.scenarioId && (
                          <span className="text-xs text-amber-600">(scenario pending)</span>
                        )}
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {/* Toggles */}
              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.active}
                    onChange={(e) =>
                      setFormData({ ...formData, active: e.target.checked })
                    }
                    className="w-4 h-4 rounded border-[#e4e7ef] text-[#1a4fff] focus:ring-[#1a4fff]"
                  />
                  <span className="text-sm text-[#0b0f1c]">Active</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.featured}
                    onChange={(e) =>
                      setFormData({ ...formData, featured: e.target.checked })
                    }
                    className="w-4 h-4 rounded border-[#e4e7ef] text-[#1a4fff] focus:ring-[#1a4fff]"
                  />
                  <span className="text-sm text-[#0b0f1c]">Featured</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.supportsSharedStorage}
                    onChange={(e) =>
                      setFormData({ ...formData, supportsSharedStorage: e.target.checked })
                    }
                    className="w-4 h-4 rounded border-[#e4e7ef] text-[#1a4fff] focus:ring-[#1a4fff]"
                  />
                  <span className="text-sm text-[#0b0f1c]">Supports Shared Storage</span>
                </label>
              </div>

              {/* Pool Assignment */}
              <div>
                <label className="block text-sm font-medium text-[#0b0f1c] mb-2">
                  Assign Pools
                </label>
                <p className="text-xs text-[#5b6476] mb-3">
                  Select pools to include in this product. Pools can be shared across multiple products.
                </p>
                <div className="border border-[#e4e7ef] rounded-lg max-h-48 overflow-y-auto">
                  {pools.length === 0 ? (
                    <div className="p-4 text-center text-[#5b6476] text-sm">
                      No pools available
                    </div>
                  ) : (
                    <div className="divide-y divide-[#e4e7ef]">
                      {pools.map((pool) => {
                        const otherProducts = getOtherProductsForPool(pool.id, editingId || undefined);
                        const isSelected = formData.poolIds.includes(pool.id);

                        return (
                          <label
                            key={pool.id}
                            className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-[#f7f8fb]"
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => togglePoolAssignment(pool.id)}
                              className="w-4 h-4 rounded border-[#e4e7ef] text-[#1a4fff] focus:ring-[#1a4fff]"
                            />
                            <div className="flex-1">
                              <span className="text-sm font-medium text-[#0b0f1c]">
                                {pool.name}
                              </span>
                              {pool.gpuModel && (
                                <span className="text-xs text-[#5b6476] ml-2">
                                  ({pool.gpuModel})
                                </span>
                              )}
                              {otherProducts.length > 0 && (
                                <span className="text-xs text-[#5b6476] ml-2">
                                  · also in {otherProducts.map((p) => p.name).join(", ")}
                                </span>
                              )}
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* HAI Service (unified instance) */}
              <div>
                <label className="block text-sm font-medium text-[#0b0f1c] mb-2">
                  HAI Service *
                </label>
                <p className="text-xs text-[#5b6476] mb-3">
                  Link to a HAI 2.2 service for unified instance creation. Products with a service use the new deployment path.
                </p>
                <div className="flex items-center gap-2">
                  {formData.serviceId ? (
                    <span className="text-xs font-mono bg-zinc-50 px-2 py-1 rounded border border-zinc-200 truncate max-w-[200px]" title={formData.serviceId}>
                      {formData.serviceId.slice(0, 20)}...
                    </span>
                  ) : (
                    <span className="text-xs text-zinc-400">No service linked</span>
                  )}
                  <button
                    type="button"
                    onClick={() => setServicePickerOpen(true)}
                    className="px-3 py-1.5 text-xs bg-teal-50 text-teal-700 rounded-lg hover:bg-teal-100 transition-colors"
                  >
                    {formData.serviceId ? "Change" : "Select Service"}
                  </button>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className={`p-6 border-t flex justify-end gap-3 ${
              formData.billingType === "monthly" ? "border-indigo-200" : "border-[#e4e7ef]"
            }`}>
              <button
                onClick={() => {
                  setShowCreateModal(false);
                  setEditingId(null);
                  resetForm();
                }}
                className="px-4 py-2 text-[#5b6476] hover:bg-[#f7f8fb] rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 bg-[#1a4fff] text-white rounded-lg hover:bg-[#1a4fff]/90 transition-colors disabled:opacity-50"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {editingId ? "Save Changes" : "Create Product"}
              </button>
            </div>
          </div>
        </div>
      )}

      <ServicePickerDialog
        open={servicePickerOpen}
        onClose={() => setServicePickerOpen(false)}
        onSelect={(id) => {
          setFormData(prev => ({ ...prev, serviceId: id }));
          setServicePickerOpen(false);
        }}
        currentServiceId={formData.serviceId || undefined}
      />
    </div>
  );
}
