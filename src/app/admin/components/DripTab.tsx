"use client";

import { useState, useEffect } from "react";
import { Play, Pause, RefreshCw, Plus, Clock, Mail, Users, Check, X as XIcon } from "lucide-react";

interface DripStep {
  id: string;
  stepOrder: number;
  delayHours: number;
  templateSlug: string;
  active: boolean;
}

interface DripSequence {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  trigger: string;
  active: boolean;
  steps: DripStep[];
  stats: { active: number; completed: number; cancelled: number; total: number };
}

export function DripTab() {
  const [sequences, setSequences] = useState<DripSequence[]>([]);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const loadSequences = async () => {
    try {
      const res = await fetch("/api/admin/drip");
      const data = await res.json();
      if (data.success) {
        setSequences(data.data);
      }
    } catch (err) {
      console.error("Failed to load drip sequences:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSequences();
  }, []);

  const handleSeed = async () => {
    setSeeding(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/drip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "seed" }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage(data.message);
        loadSequences();
      } else {
        setMessage(data.error || "Failed to seed");
      }
    } catch {
      setMessage("Failed to seed drip sequence");
    } finally {
      setSeeding(false);
    }
  };

  const handleToggle = async (sequenceId: string, active: boolean) => {
    try {
      await fetch("/api/admin/drip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "toggle", sequenceId, active }),
      });
      loadSequences();
    } catch {
      console.error("Failed to toggle sequence");
    }
  };

  const handleToggleStep = async (stepId: string, active: boolean) => {
    try {
      await fetch("/api/admin/drip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update-step", stepId, active }),
      });
      loadSequences();
    } catch {
      console.error("Failed to toggle step");
    }
  };

  const formatDelay = (hours: number) => {
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    const remaining = hours % 24;
    return remaining > 0 ? `${days}d ${remaining}h` : `${days}d`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#1a4fff]" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="text-[#5b6476]">
            Automated email sequences for onboarding and engagement. Emails use the template system and can be customized from Email Templates.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={loadSequences}
            className="p-2 text-[#5b6476] hover:text-[#0b0f1c] hover:bg-[#f7f8fb] rounded-lg"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          {sequences.length === 0 && (
            <button
              onClick={handleSeed}
              disabled={seeding}
              className="flex items-center gap-2 px-4 py-2 bg-[#1a4fff] text-white rounded-lg hover:bg-[#1a4fff]/90 disabled:opacity-50 text-sm"
            >
              <Plus className="w-4 h-4" />
              {seeding ? "Creating..." : "Create Default Sequence"}
            </button>
          )}
        </div>
      </div>

      {message && (
        <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-blue-700 text-sm">
          {message}
        </div>
      )}

      {sequences.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-[#e4e7ef]">
          <Mail className="w-12 h-12 mx-auto text-[#5b6476] mb-4" />
          <h3 className="text-lg font-semibold text-[#0b0f1c] mb-2">No drip sequences yet</h3>
          <p className="text-[#5b6476] mb-6 max-w-md mx-auto">
            Click "Create Default Sequence" to set up the free-signup onboarding campaign. This sends 4 emails over 14 days to guide new developers from first API call to GPU deployment.
          </p>
          <button
            onClick={handleSeed}
            disabled={seeding}
            className="inline-flex items-center gap-2 px-4 py-2 bg-[#1a4fff] text-white rounded-lg hover:bg-[#1a4fff]/90 disabled:opacity-50"
          >
            <Plus className="w-4 h-4" />
            {seeding ? "Creating..." : "Create Default Sequence"}
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {sequences.map((seq) => (
            <div key={seq.id} className="bg-white rounded-xl border border-[#e4e7ef] overflow-hidden">
              {/* Header */}
              <div className="p-5 border-b border-[#e4e7ef]">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-3">
                      <h3 className="text-lg font-semibold text-[#0b0f1c]">{seq.name}</h3>
                      <span className={`text-xs px-2 py-0.5 rounded ${seq.active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}`}>
                        {seq.active ? "Active" : "Paused"}
                      </span>
                      <span className="text-xs px-2 py-0.5 bg-[#f7f8fb] text-[#5b6476] rounded">
                        trigger: {seq.trigger}
                      </span>
                    </div>
                    {seq.description && (
                      <p className="text-sm text-[#5b6476] mt-1">{seq.description}</p>
                    )}
                  </div>
                  <button
                    onClick={() => handleToggle(seq.id, !seq.active)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm ${
                      seq.active
                        ? "text-[#5b6476] hover:text-red-600 hover:bg-red-50"
                        : "text-green-700 hover:bg-green-50"
                    }`}
                  >
                    {seq.active ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                    {seq.active ? "Pause" : "Activate"}
                  </button>
                </div>

                {/* Stats */}
                <div className="flex gap-6 mt-4">
                  <div className="flex items-center gap-2 text-sm">
                    <Users className="w-4 h-4 text-[#5b6476]" />
                    <span className="text-[#0b0f1c] font-medium">{seq.stats.total}</span>
                    <span className="text-[#5b6476]">enrolled</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Clock className="w-4 h-4 text-blue-500" />
                    <span className="text-[#0b0f1c] font-medium">{seq.stats.active}</span>
                    <span className="text-[#5b6476]">active</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Check className="w-4 h-4 text-green-500" />
                    <span className="text-[#0b0f1c] font-medium">{seq.stats.completed}</span>
                    <span className="text-[#5b6476]">completed</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <XIcon className="w-4 h-4 text-gray-400" />
                    <span className="text-[#0b0f1c] font-medium">{seq.stats.cancelled}</span>
                    <span className="text-[#5b6476]">cancelled</span>
                  </div>
                </div>
              </div>

              {/* Steps */}
              <div className="divide-y divide-[#e4e7ef]">
                {seq.steps.map((step, i) => (
                  <div key={step.id} className="px-5 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                        step.active ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-400"
                      }`}>
                        {i + 1}
                      </div>
                      <div>
                        <p className={`text-sm font-medium ${step.active ? "text-[#0b0f1c]" : "text-gray-400 line-through"}`}>
                          {step.templateSlug}
                        </p>
                        <p className="text-xs text-[#5b6476]">
                          <Clock className="w-3 h-3 inline mr-1" />
                          {formatDelay(step.delayHours)} after {i === 0 ? "signup" : `step ${i}`}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => handleToggleStep(step.id, !step.active)}
                      className={`text-xs px-2 py-1 rounded ${
                        step.active
                          ? "text-[#5b6476] hover:text-red-600 hover:bg-red-50"
                          : "text-green-600 hover:bg-green-50"
                      }`}
                    >
                      {step.active ? "Disable" : "Enable"}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
