export function getTimeAgo(date: Date): string {
  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffInSeconds < 60) {
    return "just now";
  }

  const diffInMinutes = Math.floor(diffInSeconds / 60);
  if (diffInMinutes < 60) {
    return `${diffInMinutes}m ago`;
  }

  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) {
    return `${diffInHours}h ago`;
  }

  const diffInDays = Math.floor(diffInHours / 24);
  if (diffInDays < 7) {
    return `${diffInDays}d ago`;
  }

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
}

export function getQuoteStatusColor(status: string): string {
  switch (status) {
    case "pending":
      return "bg-yellow-900 text-yellow-300";
    case "accepted":
      return "bg-green-900 text-green-300";
    case "declined":
      return "bg-red-900 text-red-300";
    case "expired":
      return "bg-zinc-700 text-zinc-400";
    case "converted":
      return "bg-purple-900 text-purple-300";
    default:
      return "bg-zinc-700 text-zinc-400";
  }
}

export function formatCurrency(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
