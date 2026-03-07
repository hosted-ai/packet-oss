"use client";

import { formatPercentage } from "../utils";

interface StatCardProps {
  title: string;
  value: string;
  subtitle?: string;
  trend?: { value: number; label: string };
  icon?: React.ReactNode;
}

export function StatCard({ title, value, subtitle, trend, icon }: StatCardProps) {
  return (
    <div className="bg-white border border-[#e4e7ef] rounded-xl p-5">
      <div className="flex items-start justify-between mb-2">
        <span className="text-[#5b6476] text-sm">{title}</span>
        {icon && <span className="text-[#5b6476]">{icon}</span>}
      </div>
      <div className="text-2xl font-bold text-[#0b0f1c] mb-1">{value}</div>
      {subtitle && <p className="text-[#5b6476] text-xs">{subtitle}</p>}
      {trend && (
        <div className="mt-2 flex items-center gap-1">
          <span
            className={`text-sm font-medium ${
              trend.value >= 0 ? "text-green-600" : "text-red-600"
            }`}
          >
            {formatPercentage(trend.value)}
          </span>
          <span className="text-[#5b6476] text-xs">{trend.label}</span>
        </div>
      )}
    </div>
  );
}
