"use client";

import { useCallback, useState } from "react";

export type TopupHandler = (
  amount: number,
  voucherCode?: string,
  launchProductId?: string
) => Promise<boolean>;

export interface WalletTopup {
  topupLoading: boolean;
  handleTopup: TopupHandler;
}

// Opens a Stripe checkout session for a wallet top-up and redirects to it.
// Resolves true only when a session was created, so callers can track it.
export function useWalletTopup(token: string | null): WalletTopup {
  const [topupLoading, setTopupLoading] = useState(false);

  const handleTopup = useCallback<TopupHandler>(
    async (amount, voucherCode, launchProductId) => {
      if (!token || topupLoading) return false;

      setTopupLoading(true);
      try {
        const res = await fetch("/api/account/wallet-topup", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ amount, voucherCode, launchProductId }),
        });
        const result = await res.json();
        if (result.url) {
          window.location.href = result.url;
          return true;
        }
        alert(result.error || "Failed to create checkout");
        return false;
      } catch {
        alert("Failed to initiate top-up");
        return false;
      } finally {
        setTopupLoading(false);
      }
    },
    [token, topupLoading]
  );

  return { topupLoading, handleTopup };
}
