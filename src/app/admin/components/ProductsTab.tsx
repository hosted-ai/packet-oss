"use client";

import { useState, useEffect } from "react";
import { Plus, Pencil, Trash2, Check, X, GripVertical, Loader2, HardDrive, RefreshCw } from "lucide-react";
import type { GpuProduct } from "../types";
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
    serviceId: "" as string,
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
      serviceId: "",
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
      serviceId: product.serviceId || "",
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
        serviceId: formData.serviceId || null,
      };

      const res = await fetch("/api/admin/gpu-products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (data.success) {
        setShowCreateModal(false);
        setEditingId(null);
        resetForm();
        loadData();
      } else {
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

  const togglePoolAssignment = (poolId: number) => {
    setFormData((prev) => ({
      ...prev,
      poolIds: prev.poolIds.includes(poolId)
        ? prev.poolIds.filter((id) => id !== poolId)
        : [...prev.poolIds, poolId],
    }));
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

  // Check if a pool is already assigned to another product
  const isPoolAssigned = (poolId: number, excludeProductId?: string) => {
    return products.some(
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
        <button
          onClick={() => {
            resetForm();
            setEditingId(null);
            setShowCreateModal(true);
          }}
          className="flex items-center gap-2 px-4 py-2 bg-[#1a4fff] text-white rounded-lg hover:bg-[#1a4fff]/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Product
        </button>
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
                <td colSpan={6} className="px-4 py-8 text-center text-[#5b6476]">
                  No products yet. Click &quot;Add Product&quot; to create one.
                </td>
              </tr>
            ) : (
              products.map((product, index) => (
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
              </div>

              {/* Pool Assignment */}
              <div>
                <label className="block text-sm font-medium text-[#0b0f1c] mb-2">
                  Assign Pools
                </label>
                <p className="text-xs text-[#5b6476] mb-3">
                  Select pools to include in this product. Pools already assigned to other products are shown in gray.
                </p>
                <div className="border border-[#e4e7ef] rounded-lg max-h-48 overflow-y-auto">
                  {pools.length === 0 ? (
                    <div className="p-4 text-center text-[#5b6476] text-sm">
                      No pools available
                    </div>
                  ) : (
                    <div className="divide-y divide-[#e4e7ef]">
                      {pools.map((pool) => {
                        const isAssignedElsewhere = isPoolAssigned(pool.id, editingId || undefined);
                        const isSelected = formData.poolIds.includes(pool.id);

                        return (
                          <label
                            key={pool.id}
                            className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-[#f7f8fb] ${
                              isAssignedElsewhere && !isSelected ? "opacity-50" : ""
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => togglePoolAssignment(pool.id)}
                              disabled={isAssignedElsewhere && !isSelected}
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
                              {isAssignedElsewhere && !isSelected && (
                                <span className="text-xs text-amber-600 ml-2">
                                  (assigned to another product)
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
                  HAI Service (optional)
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
                  {formData.serviceId && (
                    <button
                      type="button"
                      onClick={() => setFormData(prev => ({ ...prev, serviceId: "" }))}
                      className="px-2 py-1.5 text-xs text-zinc-400 hover:text-zinc-600"
                    >
                      Clear
                    </button>
                  )}
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
