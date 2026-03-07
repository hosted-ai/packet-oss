"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Gamepad2,
  Trophy,
  Ticket,
  TrendingUp,
  Clock,
  RefreshCw,
  Users,
  Target,
} from "lucide-react";

interface GameStats {
  totals: {
    plays: number;
    wins: number;
    vouchersClaimed: number;
    winRate: number;
  };
  today: {
    plays: number;
    wins: number;
    vouchers: number;
    winRate: number;
  };
  week: {
    plays: number;
  };
  month: {
    plays: number;
  };
  averages: {
    score: number;
    utilization: number;
    duration: number;
    linesCleared: number;
  };
  recentPlays: Array<{
    id: string;
    score: number;
    avgUtilization: number;
    duration: number;
    won: boolean;
    voucherClaimed: boolean;
    email: string | null;
    isMobile: boolean;
    createdAt: string;
  }>;
  hourlyStats: Array<{
    hour: string;
    plays: number;
    wins: number;
  }>;
  dailyStats: Array<{
    date: string;
    plays: number;
    wins: number;
    vouchers: number;
  }>;
  topWinners: Array<{
    id: string;
    email: string | null;
    score: number;
    avgUtilization: number;
    duration: number;
    voucherCode: string | null;
    createdAt: string;
  }>;
}

function StatCard({
  icon: Icon,
  label,
  value,
  subValue,
  trend,
  color = "blue",
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  subValue?: string;
  trend?: "up" | "down" | "neutral";
  color?: "blue" | "green" | "yellow" | "purple" | "teal";
}) {
  const colorClasses = {
    blue: "bg-blue-50 text-blue-600",
    green: "bg-green-50 text-green-600",
    yellow: "bg-yellow-50 text-yellow-600",
    purple: "bg-purple-50 text-purple-600",
    teal: "bg-teal-50 text-teal-600",
  };

  return (
    <div className="bg-white rounded-xl border border-[#e4e7ef] p-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-[#5b6476]">{label}</p>
          <p className="text-2xl font-bold text-[#0b0f1c] mt-1">{value}</p>
          {subValue && (
            <p className="text-xs text-[#5b6476] mt-1">{subValue}</p>
          )}
        </div>
        <div className={`p-2 rounded-lg ${colorClasses[color]}`}>
          <Icon className="w-5 h-5" />
        </div>
      </div>
      {trend && (
        <div className="mt-2 flex items-center gap-1">
          <TrendingUp
            className={`w-3 h-3 ${
              trend === "up"
                ? "text-green-500"
                : trend === "down"
                  ? "text-red-500 rotate-180"
                  : "text-gray-400"
            }`}
          />
          <span
            className={`text-xs ${
              trend === "up"
                ? "text-green-600"
                : trend === "down"
                  ? "text-red-600"
                  : "text-gray-500"
            }`}
          >
            {trend === "up" ? "Trending up" : trend === "down" ? "Trending down" : "Stable"}
          </span>
        </div>
      )}
    </div>
  );
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function formatTimeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

export function GameStatsTab() {
  const [stats, setStats] = useState<GameStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch("/api/game/stats");
      const data = await res.json();
      if (data.success) {
        setStats(data.stats);
        setLastUpdate(new Date());
        setError(null);
      } else {
        setError(data.error || "Failed to fetch stats");
      }
    } catch (err) {
      console.error("Failed to fetch game stats:", err);
      setError("Failed to connect to server");
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  // Auto-refresh every 5 seconds
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(fetchStats, 5000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchStats]);

  if (loading && !stats) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#1a4fff]"></div>
      </div>
    );
  }

  if (error && !stats) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
        {error}
      </div>
    );
  }

  if (!stats) return null;

  // Calculate the max for the bar chart
  const maxDailyPlays = Math.max(...stats.dailyStats.map((d) => d.plays), 1);

  return (
    <div className="space-y-6">
      {/* Header with refresh controls */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-[#0b0f1c]">GPU Tetris Analytics</h2>
          <p className="text-sm text-[#5b6476]">
            Real-time game statistics and player metrics
          </p>
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-[#5b6476] cursor-pointer">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded border-gray-300 text-[#1a4fff] focus:ring-[#1a4fff]"
            />
            Auto-refresh
          </label>
          <button
            onClick={fetchStats}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-1.5 text-sm bg-[#f7f8fb] hover:bg-[#e4e7ef] rounded-lg transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          {lastUpdate && (
            <span className="text-xs text-[#5b6476]">
              Updated: {lastUpdate.toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      {/* Live indicator */}
      {autoRefresh && (
        <div className="flex items-center gap-2 text-sm text-green-600">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
          </span>
          Live - updating every 5 seconds
        </div>
      )}

      {/* Today's Stats */}
      <div>
        <h3 className="text-sm font-semibold text-[#5b6476] uppercase tracking-wider mb-3">
          Today
        </h3>
        <div className="grid grid-cols-4 gap-4">
          <StatCard
            icon={Gamepad2}
            label="Games Played"
            value={stats.today.plays}
            subValue={`${stats.week.plays} this week`}
            color="blue"
          />
          <StatCard
            icon={Trophy}
            label="Wins"
            value={stats.today.wins}
            subValue={`${stats.today.winRate}% win rate`}
            color="green"
          />
          <StatCard
            icon={Ticket}
            label="Vouchers Claimed"
            value={stats.today.vouchers}
            subValue={`$${(stats.today.vouchers * 1.5).toFixed(2)} in credits`}
            color="yellow"
          />
          <StatCard
            icon={Target}
            label="Avg Utilization"
            value={`${stats.averages.utilization}%`}
            subValue="Across all games"
            color="teal"
          />
        </div>
      </div>

      {/* All-Time Stats */}
      <div>
        <h3 className="text-sm font-semibold text-[#5b6476] uppercase tracking-wider mb-3">
          All Time
        </h3>
        <div className="grid grid-cols-4 gap-4">
          <StatCard
            icon={Users}
            label="Total Games"
            value={stats.totals.plays.toLocaleString()}
            subValue={`${stats.month.plays} this month`}
            color="purple"
          />
          <StatCard
            icon={Trophy}
            label="Total Wins"
            value={stats.totals.wins.toLocaleString()}
            subValue={`${stats.totals.winRate}% win rate`}
            color="green"
          />
          <StatCard
            icon={Ticket}
            label="Vouchers Issued"
            value={stats.totals.vouchersClaimed.toLocaleString()}
            subValue={`$${(stats.totals.vouchersClaimed * 1.5).toFixed(2)} total`}
            color="yellow"
          />
          <StatCard
            icon={Clock}
            label="Avg Duration"
            value={formatDuration(stats.averages.duration)}
            subValue={`Avg score: ${stats.averages.score.toLocaleString()}`}
            color="blue"
          />
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-2 gap-6">
        {/* Daily Chart */}
        <div className="bg-white rounded-xl border border-[#e4e7ef] p-4">
          <h3 className="text-sm font-semibold text-[#0b0f1c] mb-4">
            Last 30 Days
          </h3>
          <div className="h-48 flex items-end gap-1">
            {stats.dailyStats.slice(0, 30).reverse().map((day, i) => (
              <div
                key={day.date}
                className="flex-1 flex flex-col items-center gap-1"
                title={`${day.date}: ${day.plays} plays, ${day.wins} wins`}
              >
                <div
                  className="w-full bg-[#1a4fff] rounded-t transition-all hover:bg-[#1238c9]"
                  style={{
                    height: `${(day.plays / maxDailyPlays) * 100}%`,
                    minHeight: day.plays > 0 ? "4px" : "0px",
                  }}
                />
                {i % 7 === 0 && (
                  <span className="text-[10px] text-[#5b6476] -rotate-45 origin-left whitespace-nowrap">
                    {new Date(day.date).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                )}
              </div>
            ))}
          </div>
          <div className="flex justify-between mt-4 text-xs text-[#5b6476]">
            <span>30 days ago</span>
            <span>Today</span>
          </div>
        </div>

        {/* Hourly Chart */}
        <div className="bg-white rounded-xl border border-[#e4e7ef] p-4">
          <h3 className="text-sm font-semibold text-[#0b0f1c] mb-4">
            Last 24 Hours
          </h3>
          <div className="h-48 flex items-end gap-1">
            {stats.hourlyStats.slice(0, 24).reverse().map((hour, i) => {
              const maxHourly = Math.max(...stats.hourlyStats.map((h) => h.plays), 1);
              return (
                <div
                  key={hour.hour}
                  className="flex-1 flex flex-col items-center gap-1"
                  title={`${hour.hour}: ${hour.plays} plays`}
                >
                  <div
                    className="w-full bg-[#18b6a8] rounded-t transition-all hover:bg-[#139e92]"
                    style={{
                      height: `${(hour.plays / maxHourly) * 100}%`,
                      minHeight: hour.plays > 0 ? "4px" : "0px",
                    }}
                  />
                  {i % 6 === 0 && (
                    <span className="text-[10px] text-[#5b6476]">
                      {hour.hour.split(" ")[1]?.replace(":00", "h") || ""}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex justify-between mt-4 text-xs text-[#5b6476]">
            <span>24h ago</span>
            <span>Now</span>
          </div>
        </div>
      </div>

      {/* Recent Games Table */}
      <div className="bg-white rounded-xl border border-[#e4e7ef] overflow-hidden">
        <div className="px-4 py-3 border-b border-[#e4e7ef]">
          <h3 className="text-sm font-semibold text-[#0b0f1c]">Recent Games</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[#f7f8fb]">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-[#5b6476]">Time</th>
                <th className="px-4 py-2 text-left font-medium text-[#5b6476]">Score</th>
                <th className="px-4 py-2 text-left font-medium text-[#5b6476]">Utilization</th>
                <th className="px-4 py-2 text-left font-medium text-[#5b6476]">Duration</th>
                <th className="px-4 py-2 text-left font-medium text-[#5b6476]">Result</th>
                <th className="px-4 py-2 text-left font-medium text-[#5b6476]">Device</th>
                <th className="px-4 py-2 text-left font-medium text-[#5b6476]">Email</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e4e7ef]">
              {stats.recentPlays.map((play) => (
                <tr key={play.id} className="hover:bg-[#f7f8fb]">
                  <td className="px-4 py-2 text-[#5b6476]">
                    {formatTimeAgo(play.createdAt)}
                  </td>
                  <td className="px-4 py-2 font-medium text-[#0b0f1c]">
                    {play.score.toLocaleString()}
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={`${
                        play.avgUtilization >= 80
                          ? "text-green-600"
                          : play.avgUtilization >= 60
                            ? "text-yellow-600"
                            : "text-red-600"
                      }`}
                    >
                      {play.avgUtilization}%
                    </span>
                  </td>
                  <td className="px-4 py-2 text-[#5b6476]">
                    {formatDuration(play.duration)}
                  </td>
                  <td className="px-4 py-2">
                    {play.voucherClaimed ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-yellow-100 text-yellow-700 rounded-full text-xs font-medium">
                        <Ticket className="w-3 h-3" />
                        Voucher
                      </span>
                    ) : play.won ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-xs font-medium">
                        <Trophy className="w-3 h-3" />
                        Won
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full text-xs">
                        Lost
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-[#5b6476]">
                    {play.isMobile ? "Mobile" : "Desktop"}
                  </td>
                  <td className="px-4 py-2 text-[#5b6476]">
                    {play.email ? (
                      <span className="font-mono text-xs">{play.email}</span>
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </td>
                </tr>
              ))}
              {stats.recentPlays.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-[#5b6476]">
                    No games played yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Top Winners (Voucher Claimers) Table */}
      <div className="bg-white rounded-xl border border-[#e4e7ef] overflow-hidden">
        <div className="px-4 py-3 border-b border-[#e4e7ef] flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-[#0b0f1c]">Top Winners</h3>
            <p className="text-xs text-[#5b6476]">Players who claimed vouchers, sorted by score</p>
          </div>
          <div className="flex items-center gap-1 text-xs text-yellow-600 bg-yellow-50 px-2 py-1 rounded-full">
            <Trophy className="w-3 h-3" />
            {stats.topWinners.length} winners
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[#f7f8fb]">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-[#5b6476]">#</th>
                <th className="px-4 py-2 text-left font-medium text-[#5b6476]">Email</th>
                <th className="px-4 py-2 text-left font-medium text-[#5b6476]">Score</th>
                <th className="px-4 py-2 text-left font-medium text-[#5b6476]">Utilization</th>
                <th className="px-4 py-2 text-left font-medium text-[#5b6476]">Duration</th>
                <th className="px-4 py-2 text-left font-medium text-[#5b6476]">Voucher Code</th>
                <th className="px-4 py-2 text-left font-medium text-[#5b6476]">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e4e7ef]">
              {stats.topWinners.map((winner, index) => (
                <tr key={winner.id} className="hover:bg-[#f7f8fb]">
                  <td className="px-4 py-2">
                    {index < 3 ? (
                      <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${
                        index === 0 ? "bg-yellow-100 text-yellow-700" :
                        index === 1 ? "bg-gray-100 text-gray-600" :
                        "bg-orange-100 text-orange-600"
                      }`}>
                        {index + 1}
                      </span>
                    ) : (
                      <span className="text-[#5b6476]">{index + 1}</span>
                    )}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-[#0b0f1c]">
                    {winner.email || "-"}
                  </td>
                  <td className="px-4 py-2 font-semibold text-[#0b0f1c]">
                    {winner.score.toLocaleString()}
                  </td>
                  <td className="px-4 py-2">
                    <span className={`${
                      winner.avgUtilization >= 80 ? "text-green-600" :
                      winner.avgUtilization >= 60 ? "text-yellow-600" :
                      "text-red-600"
                    }`}>
                      {winner.avgUtilization}%
                    </span>
                  </td>
                  <td className="px-4 py-2 text-[#5b6476]">
                    {formatDuration(winner.duration)}
                  </td>
                  <td className="px-4 py-2">
                    {winner.voucherCode ? (
                      <code className="px-2 py-0.5 bg-yellow-50 text-yellow-700 rounded text-xs font-mono">
                        {winner.voucherCode}
                      </code>
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-[#5b6476]">
                    {new Date(winner.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
              {stats.topWinners.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-[#5b6476]">
                    No vouchers claimed yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
