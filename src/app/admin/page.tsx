"use client";

import { Suspense } from "react";
import { AdminDashboard } from "./components/AdminDashboard";

export default function AdminPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-screen">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-500"></div>
        </div>
      }
    >
      <AdminDashboard />
    </Suspense>
  );
}
