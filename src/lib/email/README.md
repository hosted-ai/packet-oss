# Email Module (`src/lib/email/`)

Transactional email system using Emailit as the delivery provider.

## File Structure

```
email/
├── index.ts              # Public exports
├── client.ts             # Core email sending functions
├── utils.ts              # HTML escaping, delay helpers
├── templates/
│   ├── welcome.ts        # New customer onboarding
│   ├── contact.ts        # Contact form submissions
│   ├── gpu-events.ts     # GPU notifications
│   └── quotes.ts         # Quote request emails
└── README.md             # This file
```

## Usage

```typescript
import {
  sendWelcomeEmail,
  sendGpuLaunchedEmail,
  sendContactEmail
} from "@/lib/email";

// Welcome email with login link
await sendWelcomeEmail({
  to: "user@example.com",
  customerName: "John",
  loginUrl: "https://the platform/account/verify?token=..."
});

// GPU launch notification
await sendGpuLaunchedEmail({
  to: "user@example.com",
  gpuType: "NVIDIA A100",
  region: "us-east-1"
});
```

## Templates

### Welcome (`templates/welcome.ts`)
Sent when a new customer completes Stripe checkout:
- Login link to access dashboard
- Getting started information

### Contact (`templates/contact.ts`)
Forwards contact form submissions to admins:
- Customer name, email, message
- Company information if provided

### GPU Events (`templates/gpu-events.ts`)
Notifications for GPU lifecycle events:
- `sendGpuLaunchedEmail` - GPU is ready
- `sendGpuTerminatedEmail` - GPU was terminated
- `sendHfDeploymentStartedEmail` - HuggingFace deployment initiated
- `sendHfDeploymentEmail` - Deployment complete with endpoint

### Quotes (`templates/quotes.ts`)
Custom pricing quote workflow:
- `sendQuoteEmail` - Quote sent to customer
- `sendQuoteResponseNotification` - Customer responded
- `sendQuoteReminderEmail` - Reminder for pending quotes

## Low-Level API

For custom emails not covered by templates:

```typescript
import { sendEmail, sendEmailDirect } from "@/lib/email";

// Send with retry and admin copy
await sendEmail({
  to: "user@example.com",
  subject: "Custom Email",
  html: "<p>Email content</p>"
});

// Direct send without retries
await sendEmailDirect({
  to: "user@example.com",
  subject: "Urgent",
  html: "<p>Time-sensitive content</p>"
});
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `EMAILIT_API_KEY` | Yes | Emailit API key for sending |
| `ADMIN_EMAIL` | No | Email address for admin copies |

## Error Handling

All template functions handle errors gracefully:
- Failed sends are logged but don't throw
- Admin copies are sent for important emails
- Retry logic with exponential backoff
