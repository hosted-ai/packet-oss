/**
 * Dashboard utility functions
 */

// Time-based greeting
export function getTimeBasedGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  if (hour < 21) return "Good evening";
  return "Good night";
}

// Random motivational taglines
const TAGLINES = [
  "Let's build something amazing",
  "Time to train some models",
  "Your GPUs await",
  "Ready to compute?",
  "Let's crunch some numbers",
  "The cloud is your oyster",
  "Unleash the tensor cores",
];

export function getRandomTagline(): string {
  return TAGLINES[Math.floor(Math.random() * TAGLINES.length)];
}

// Time-based easter eggs
export function getTimeBasedEasterEgg(): string | null {
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay(); // 0 = Sunday, 5 = Friday

  if (day === 5 && hour >= 14) return "TGIF! Let those models train over the weekend";
  if (day === 1 && hour < 12) return "Fresh week, fresh compute";
  if (hour >= 23 || hour < 5) return "Burning the midnight oil?";
  if (day === 0 || day === 6) return "Weekend warrior mode activated";
  return null;
}

// Wallet balance reactions
export function getWalletReaction(balanceCents: number): string | null {
  if (balanceCents >= 50000) return "You're loaded!";
  if (balanceCents >= 20000) return "Looking healthy";
  if (balanceCents < 5000 && balanceCents > 0) return "Running low...";
  if (balanceCents <= 0) return "Time to top up!";
  return null;
}

// GPU status with personality
export function getGpuStatusText(status: string, isActive: boolean): string {
  if (status === "Running" && isActive) return "Crunching numbers";
  if (status === "Running") return "Humming along";
  if (status === "Pending" || status === "subscribing") return "Warming up...";
  if (status === "unsubscribing" || status === "un_subscribing") return "Cooling down...";
  return status;
}

// Running time quips
export function getRunningTimeQuip(createdAt: string | undefined): string | null {
  if (!createdAt) return null;
  const created = new Date(createdAt);
  const now = new Date();
  const diffMs = now.getTime() - created.getTime();
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

  if (hours > 24) {
    const days = Math.floor(hours / 24);
    return `Crunching for ${days}d ${hours % 24}h`;
  }
  if (hours > 0) {
    return `Training hard for ${hours}h ${mins}m`;
  }
  if (mins > 5) {
    return `Spinning up ${mins}m ago`;
  }
  return "Just launched!";
}

// Empty state messages
const EMPTY_STATE_MESSAGES = [
  { title: "It's quiet here...", subtitle: "Launch a GPU to get started" },
  { title: "Your GPU army awaits", subtitle: "Deploy your first instance" },
  { title: "No GPUs running", subtitle: "Ready when you are" },
  { title: "All quiet on the compute front", subtitle: "Spin up a GPU anytime" },
];

export function getEmptyStateMessage(): { title: string; subtitle: string } {
  return EMPTY_STATE_MESSAGES[Math.floor(Math.random() * EMPTY_STATE_MESSAGES.length)];
}

// Activity feed flavor text
export function getActivityFlavorText(type: string): string {
  switch (type) {
    case "gpu_launched": return "Fired up a new GPU";
    case "gpu_terminated": return "GPU took a well-deserved rest";
    case "gpu_restarted": return "Gave the GPU a fresh start";
    case "ssh_key_added": return "New SSH key on file";
    case "ssh_key_injected": return "Key injected successfully";
    case "wallet_funded": return "Wallet topped up!";
    case "login": return "Logged in";
    default: return type.replace(/_/g, " ");
  }
}
