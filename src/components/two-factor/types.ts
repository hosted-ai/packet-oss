export type UserType = "customer" | "admin" | "investor";

export type TwoFactorTheme = "light" | "dark";

export interface SetupData {
  qrCode: string;
  secret: string;
  backupCodes: string[];
}

export interface TwoFactorStatus {
  enabled: boolean;
  hasBackupCodes: boolean;
}

export interface TwoFactorConfig {
  userType: UserType;
  apiEndpoint: string;
  token?: string;
  theme: TwoFactorTheme;
  accentColor: string;
  accentColorHover: string;
  focusRingColor: string;
  accountTypeLabel: string;
}

export interface TwoFactorSettingsProps {
  userType: UserType;
  apiEndpoint: string;
  token?: string;
  initialEnabled?: boolean;
  initialHasBackupCodes?: boolean;
  onStatusChange: () => void;
}

// Theme configuration for each user type
export const USER_TYPE_CONFIG: Record<UserType, Omit<TwoFactorConfig, "userType" | "apiEndpoint" | "token">> = {
  customer: {
    theme: "light",
    accentColor: "var(--blue)",
    accentColorHover: "var(--blue-dark)",
    focusRingColor: "var(--blue)",
    accountTypeLabel: "your account",
  },
  admin: {
    theme: "light",
    accentColor: "#1a4fff",
    accentColorHover: "#1238c9",
    focusRingColor: "#1a4fff",
    accountTypeLabel: "your admin account",
  },
  investor: {
    theme: "light",
    accentColor: "#1a4fff",
    accentColorHover: "#1238c9",
    focusRingColor: "#1a4fff",
    accountTypeLabel: "your investor account",
  },
};
