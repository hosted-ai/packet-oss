"use client";

import { useState, useEffect } from "react";

interface CampaignBanner {
  id: string;
  text: string;
  linkUrl: string | null;
  linkText: string | null;
  backgroundColor: string;
  textColor: string;
  active: boolean;
  dismissible: boolean;
  startsAt: string | null;
  expiresAt: string | null;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
}

interface BannerForm {
  text: string;
  linkUrl: string;
  linkText: string;
  backgroundColor: string;
  textColor: string;
  active: boolean;
  dismissible: boolean;
  startsAt: string;
  expiresAt: string;
  displayOrder: number;
}

const EMPTY_FORM: BannerForm = {
  text: "",
  linkUrl: "",
  linkText: "",
  backgroundColor: "#1a4fff",
  textColor: "#ffffff",
  active: true,
  dismissible: true,
  startsAt: "",
  expiresAt: "",
  displayOrder: 0,
};

export function BannersTab() {
  const [banners, setBanners] = useState<CampaignBanner[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<BannerForm>(EMPTY_FORM);
  const [showForm, setShowForm] = useState(false);

  const loadBanners = async () => {
    try {
      const res = await fetch("/api/admin/banners");
      const data = await res.json();
      if (data.success) {
        setBanners(data.data);
      }
    } catch (error) {
      console.error("Failed to load banners:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBanners();
  }, []);

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  };

  const openEdit = (banner: CampaignBanner) => {
    setEditingId(banner.id);
    setForm({
      text: banner.text,
      linkUrl: banner.linkUrl || "",
      linkText: banner.linkText || "",
      backgroundColor: banner.backgroundColor,
      textColor: banner.textColor,
      active: banner.active,
      dismissible: banner.dismissible,
      startsAt: banner.startsAt ? banner.startsAt.slice(0, 16) : "",
      expiresAt: banner.expiresAt ? banner.expiresAt.slice(0, 16) : "",
      displayOrder: banner.displayOrder,
    });
    setShowForm(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/admin/banners", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: editingId ? "update" : "create",
          id: editingId || undefined,
          ...form,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setShowForm(false);
        loadBanners();
      } else {
        alert(data.error || "Failed to save banner");
      }
    } catch {
      alert("Failed to save banner");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this banner?")) return;
    try {
      const res = await fetch("/api/admin/banners", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", id }),
      });
      const data = await res.json();
      if (data.success) {
        loadBanners();
      }
    } catch {
      alert("Failed to delete banner");
    }
  };

  const handleToggleActive = async (banner: CampaignBanner) => {
    try {
      await fetch("/api/admin/banners", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update",
          id: banner.id,
          active: !banner.active,
        }),
      });
      loadBanners();
    } catch {
      alert("Failed to toggle banner");
    }
  };

  if (loading) {
    return <div className="text-center py-8 text-[#5b6476]">Loading banners...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-[#5b6476]">
          Manage campaign banners displayed at the top of the marketing site.
        </p>
        <button
          onClick={openCreate}
          className="px-4 py-2 bg-[#1a4fff] text-white rounded-lg hover:bg-[#1238c9] transition-colors text-sm font-medium"
        >
          Create Banner
        </button>
      </div>

      {/* Banner List */}
      {banners.length === 0 ? (
        <div className="bg-white border border-[#e4e7ef] rounded-lg p-8 text-center text-[#5b6476]">
          No banners yet. Create one to display promotions across the site.
        </div>
      ) : (
        <div className="space-y-3">
          {banners.map((banner) => (
            <div key={banner.id} className="bg-white border border-[#e4e7ef] rounded-lg p-4">
              {/* Preview */}
              <div
                className="rounded-md px-4 py-2 text-center text-sm font-medium mb-3"
                style={{ backgroundColor: banner.backgroundColor, color: banner.textColor }}
              >
                {banner.text}
                {banner.linkUrl && (
                  <span className="underline ml-1">{banner.linkText || "Learn more"}</span>
                )}
              </div>
              {/* Meta */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 text-xs text-[#5b6476]">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                    banner.active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
                  }`}>
                    {banner.active ? "Active" : "Inactive"}
                  </span>
                  {banner.startsAt && <span>From: {new Date(banner.startsAt).toLocaleDateString()}</span>}
                  {banner.expiresAt && <span>Until: {new Date(banner.expiresAt).toLocaleDateString()}</span>}
                  <span>Order: {banner.displayOrder}</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleToggleActive(banner)}
                    className="text-xs text-[#5b6476] hover:text-[#0b0f1c] transition-colors"
                  >
                    {banner.active ? "Deactivate" : "Activate"}
                  </button>
                  <button
                    onClick={() => openEdit(banner)}
                    className="text-xs text-[#1a4fff] hover:text-[#1238c9] transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(banner.id)}
                    className="text-xs text-red-500 hover:text-red-700 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-[#0b0f1c] mb-4">
              {editingId ? "Edit Banner" : "Create Banner"}
            </h3>
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[#0b0f1c] mb-1">Banner Text *</label>
                <input
                  type="text"
                  value={form.text}
                  onChange={(e) => setForm({ ...form, text: e.target.value })}
                  required
                  className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg text-sm focus:ring-2 focus:ring-[#1a4fff] focus:outline-none"
                  placeholder="Limited time: Get 20% off monthly plans!"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[#0b0f1c] mb-1">Link URL</label>
                  <input
                    type="text"
                    value={form.linkUrl}
                    onChange={(e) => setForm({ ...form, linkUrl: e.target.value })}
                    className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg text-sm focus:ring-2 focus:ring-[#1a4fff] focus:outline-none"
                    placeholder="/checkout"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#0b0f1c] mb-1">Link Text</label>
                  <input
                    type="text"
                    value={form.linkText}
                    onChange={(e) => setForm({ ...form, linkText: e.target.value })}
                    className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg text-sm focus:ring-2 focus:ring-[#1a4fff] focus:outline-none"
                    placeholder="Get started"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[#0b0f1c] mb-1">Background Color</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={form.backgroundColor}
                      onChange={(e) => setForm({ ...form, backgroundColor: e.target.value })}
                      className="w-10 h-10 rounded border border-[#e4e7ef] cursor-pointer"
                    />
                    <input
                      type="text"
                      value={form.backgroundColor}
                      onChange={(e) => setForm({ ...form, backgroundColor: e.target.value })}
                      className="flex-1 px-3 py-2 border border-[#e4e7ef] rounded-lg text-sm focus:ring-2 focus:ring-[#1a4fff] focus:outline-none"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#0b0f1c] mb-1">Text Color</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={form.textColor}
                      onChange={(e) => setForm({ ...form, textColor: e.target.value })}
                      className="w-10 h-10 rounded border border-[#e4e7ef] cursor-pointer"
                    />
                    <input
                      type="text"
                      value={form.textColor}
                      onChange={(e) => setForm({ ...form, textColor: e.target.value })}
                      className="flex-1 px-3 py-2 border border-[#e4e7ef] rounded-lg text-sm focus:ring-2 focus:ring-[#1a4fff] focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              {/* Preview */}
              {form.text && (
                <div>
                  <label className="block text-sm font-medium text-[#0b0f1c] mb-1">Preview</label>
                  <div
                    className="rounded-md px-4 py-2 text-center text-sm font-medium"
                    style={{ backgroundColor: form.backgroundColor, color: form.textColor }}
                  >
                    {form.text}
                    {form.linkUrl && (
                      <span className="underline ml-1">{form.linkText || "Learn more"}</span>
                    )}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[#0b0f1c] mb-1">Starts At</label>
                  <input
                    type="datetime-local"
                    value={form.startsAt}
                    onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
                    className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg text-sm focus:ring-2 focus:ring-[#1a4fff] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#0b0f1c] mb-1">Expires At</label>
                  <input
                    type="datetime-local"
                    value={form.expiresAt}
                    onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
                    className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg text-sm focus:ring-2 focus:ring-[#1a4fff] focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[#0b0f1c] mb-1">Display Order</label>
                  <input
                    type="number"
                    value={form.displayOrder}
                    onChange={(e) => setForm({ ...form, displayOrder: parseInt(e.target.value) || 0 })}
                    className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg text-sm focus:ring-2 focus:ring-[#1a4fff] focus:outline-none"
                  />
                </div>
                <label className="flex items-center gap-2 cursor-pointer pt-6">
                  <input
                    type="checkbox"
                    checked={form.active}
                    onChange={(e) => setForm({ ...form, active: e.target.checked })}
                    className="w-4 h-4 rounded border-[#e4e7ef] text-[#1a4fff] focus:ring-[#1a4fff]"
                  />
                  <span className="text-sm text-[#0b0f1c]">Active</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer pt-6">
                  <input
                    type="checkbox"
                    checked={form.dismissible}
                    onChange={(e) => setForm({ ...form, dismissible: e.target.checked })}
                    className="w-4 h-4 rounded border-[#e4e7ef] text-[#1a4fff] focus:ring-[#1a4fff]"
                  />
                  <span className="text-sm text-[#0b0f1c]">Dismissible</span>
                </label>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 py-2 bg-[#1a4fff] text-white rounded-lg hover:bg-[#1238c9] disabled:opacity-50 text-sm font-medium transition-colors"
                >
                  {saving ? "Saving..." : editingId ? "Update Banner" : "Create Banner"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="px-4 py-2 bg-[#e4e7ef] text-[#5b6476] rounded-lg hover:bg-[#d1d5e0] text-sm font-medium transition-colors"
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
