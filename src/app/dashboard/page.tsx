"use client";

import { Suspense } from "react";
import { DashboardContent } from "./components";

export default function DashboardPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-screen">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-500"></div>
        </div>
      }
    >
      <DashboardContent />
    </Suspense>
  );
}
