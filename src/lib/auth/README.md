# Authentication Module (`src/lib/auth/`)

Unified authentication system supporting multiple user types with JWT-based token management.

## User Types

| Type | Description | Token Expiry |
|------|-------------|--------------|
| **Customer** | Stripe customers accessing billing dashboard | 24 hours |
| **Admin** | Internal administrators with full access | 1 hour (session-based) |
| **Investor** | External investors with read-only metrics access | 24 hours |

## File Structure

```
auth/
├── index.ts        # Public exports (use this for imports)
├── customer.ts     # Customer token generation/verification
├── admin.ts        # Admin auth with file-based user storage
├── investor.ts     # Investor auth with file-based user storage
├── two-factor.ts   # TOTP-based 2FA for admin users
└── README.md       # This file
```

## Usage

```typescript
// Import from the module root
import {
  generateCustomerToken,
  verifyCustomerToken,
  isAdmin,
  verifyTOTP
} from "@/lib/auth";

// Or import from legacy paths (backwards compatible)
import { generateCustomerToken } from "@/lib/customer-auth";
import { isAdmin } from "@/lib/admin";
```

## Customer Authentication

Customers authenticate via magic links sent to their email:

```typescript
import { generateCustomerToken, verifyCustomerToken } from "@/lib/auth";

// Generate token for magic link
const token = generateCustomerToken({
  email: "user@example.com",
  customerId: "cus_xxx"
});

// Verify token from request
const payload = verifyCustomerToken(token);
if (payload) {
  // { email, customerId, type: "customer-dashboard" }
}
```

## Admin Authentication

Admins are stored in `data/admins.json` and require 2FA:

```typescript
import { isAdmin, generateAdminToken, verifyAdminToken } from "@/lib/auth";

// Check if email is admin
if (await isAdmin("admin@example.com")) {
  const token = generateAdminToken("admin@example.com");
}
```

## Two-Factor Authentication

TOTP-based 2FA using authenticator apps:

```typescript
import {
  generateSecret,
  generateQRCode,
  verifyTOTP,
  generateBackupCodes
} from "@/lib/auth";

// Setup 2FA
const secret = generateSecret();
const qrCode = await generateQRCode(secret, "admin@example.com");
const backupCodes = generateBackupCodes();

// Verify code
const isValid = verifyTOTP(code, secret);
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ADMIN_JWT_SECRET` | Yes | Secret for signing admin, investor, and provider JWT tokens |
| `CUSTOMER_JWT_SECRET` | Recommended | Separate secret for customer tokens (falls back to `ADMIN_JWT_SECRET`) |

## Security Notes

- All tokens are signed using HS256 algorithm
- Customer tokens use a separate signing secret (`CUSTOMER_JWT_SECRET`) for domain isolation
- Customer tokens include Stripe customer ID for authorization
- Admin tokens require valid 2FA before issuance
- Investor tokens are read-only and cannot modify data
