/**
 * QA Test Plan Data
 *
 * Comprehensive test cases for the GPU cloud platform.
 *
 * @module admin/components/qa/test-data
 */

import type { TestCategory } from "./types";

export const TEST_PLAN: TestCategory[] = [
  {
    id: "signup",
    name: "Signup Flow",
    tests: [
      {
        id: "signup-1",
        name: "Access code bypass",
        description: "Enter access code on Coming Soon modal to unlock signup",
        steps: [
          "Go to your-domain.com",
          "Click 'Have an access code?'",
          "Enter 'your-access-code' and click Go",
          "Verify Coming Soon modal disappears",
        ],
      },
      {
        id: "signup-2",
        name: "Checkout page access",
        description: "Reach checkout page and see real signup form",
        steps: [
          "After bypass, click 'Get Started'",
          "Verify checkout page shows email + voucher fields",
          "Verify 'Continue to Payment' button visible",
        ],
      },
      {
        id: "signup-3",
        name: "Voucher validation at signup",
        description: "Test voucher code validation during signup",
        steps: [
          "On checkout page, enter a valid voucher code",
          "Click Apply",
          "Verify success message shows bonus amount",
          "Try invalid code, verify error message",
        ],
      },
      {
        id: "signup-4",
        name: "Stripe checkout redirect",
        description: "Complete signup redirects to Stripe",
        steps: [
          "Enter email address",
          "Click Continue to Payment",
          "Verify redirect to Stripe Checkout",
          "Verify correct amount shown ($100)",
        ],
      },
      {
        id: "signup-5",
        name: "Stripe payment completion",
        description: "Complete payment and account created",
        steps: [
          "Complete Stripe payment with test card 4242...",
          "Verify redirect to success page",
          "Verify welcome email received",
          "Verify can login to dashboard",
        ],
      },
      {
        id: "signup-6",
        name: "Voucher applied after signup",
        description: "Voucher bonus credited after payment",
        steps: [
          "Sign up with valid voucher code",
          "After payment, check wallet balance",
          "Verify $100 deposit + voucher bonus visible",
        ],
      },
    ],
  },
  {
    id: "login",
    name: "Login Flow",
    tests: [
      {
        id: "login-1",
        name: "Magic link request",
        description: "Request login link via email",
        steps: [
          "Go to your-domain.com/account",
          "Enter registered email",
          "Click Send Login Link",
          "Verify success message",
        ],
      },
      {
        id: "login-2",
        name: "Magic link login",
        description: "Login via emailed link",
        steps: [
          "Check email for login link",
          "Click link in email",
          "Verify redirect to dashboard",
          "Verify correct account loaded",
        ],
      },
      {
        id: "login-3",
        name: "Session persistence",
        description: "Session remains active",
        steps: [
          "After login, refresh the page",
          "Verify still logged in",
          "Navigate between tabs",
          "Verify session maintained",
        ],
      },
      {
        id: "login-4",
        name: "Non-existent email handling",
        description: "Error shown for unknown email",
        steps: [
          "Enter email that's not registered",
          "Click Send Login Link",
          "Verify appropriate error message",
        ],
      },
    ],
  },
  {
    id: "dashboard",
    name: "Dashboard",
    tests: [
      {
        id: "dash-1",
        name: "Dashboard loads",
        description: "Main dashboard displays correctly",
        steps: [
          "Login to dashboard",
          "Verify wallet balance shown",
          "Verify sidebar navigation works",
          "Verify user name/email displayed",
        ],
      },
      {
        id: "dash-2",
        name: "Instance list",
        description: "GPU instances displayed correctly",
        steps: [
          "Go to Dashboard tab",
          "Verify instance cards show (or empty state)",
          "Check instance status indicators",
        ],
      },
      {
        id: "dash-3",
        name: "Billing page",
        description: "Billing info and history correct",
        steps: [
          "Go to Billing tab",
          "Verify wallet balance matches",
          "Check transaction history if any",
          "Verify Top Up button present",
        ],
      },
    ],
  },
  {
    id: "topup",
    name: "Wallet Top-up",
    tests: [
      {
        id: "topup-1",
        name: "Top-up modal opens",
        description: "Modal displays with amount options",
        steps: [
          "Go to Billing tab",
          "Click Top Up button",
          "Verify modal opens with amount options",
          "Verify voucher code link visible",
        ],
      },
      {
        id: "topup-2",
        name: "Amount selection",
        description: "Can select different amounts",
        steps: [
          "In top-up modal, click $25 option",
          "Verify it's selected (highlighted)",
          "Click $100 option",
          "Verify selection changes",
        ],
      },
      {
        id: "topup-3",
        name: "Voucher code in top-up",
        description: "Voucher validation works in top-up",
        steps: [
          "Click 'Have a voucher code?'",
          "Enter valid voucher code",
          "Click Apply",
          "Verify bonus amount shown",
        ],
      },
      {
        id: "topup-4",
        name: "Stripe top-up payment",
        description: "Complete top-up payment",
        steps: [
          "Select amount",
          "Click Top Up button",
          "Complete Stripe payment",
          "Verify wallet balance updated",
        ],
      },
    ],
  },
  {
    id: "referrals",
    name: "Referral Program",
    tests: [
      {
        id: "ref-1",
        name: "Referral code displayed",
        description: "User has unique referral code",
        steps: [
          "Go to Referrals tab",
          "Verify unique code displayed (e.g., COSMIC-PENGUIN)",
          "Verify Copy button works",
          "Check stats show (Available, Shared, etc.)",
        ],
      },
      {
        id: "ref-2",
        name: "Apply friend's code",
        description: "Can enter someone else's referral code",
        steps: [
          "Go to Referrals tab",
          "Enter a valid referral code in input",
          "Click Apply",
          "Verify success message",
        ],
      },
      {
        id: "ref-3",
        name: "Self-referral blocked",
        description: "Cannot use own referral code",
        steps: [
          "Copy your own referral code",
          "Try to apply it",
          "Verify error message about self-referral",
        ],
      },
      {
        id: "ref-4",
        name: "Referral reward processing",
        description: "Both parties get credit after qualifying top-up",
        steps: [
          "New user signs up with referral code",
          "New user tops up $100+",
          "Verify referrer gets credit",
          "Verify referee gets credit",
        ],
      },
      {
        id: "ref-5",
        name: "Referral stats update",
        description: "Stats reflect referral activity",
        steps: [
          "After referral is used",
          "Check referrer's stats page",
          "Verify Shared count increased",
          "After activation, verify Activated count",
        ],
      },
    ],
  },
  {
    id: "gpu",
    name: "GPU Provisioning",
    tests: [
      {
        id: "gpu-1",
        name: "Launch GPU instance",
        description: "Can provision a new GPU",
        steps: [
          "Go to Dashboard",
          "Click Launch/New Instance",
          "Select GPU type and image",
          "Confirm launch",
          "Verify instance appears in list",
        ],
      },
      {
        id: "gpu-2",
        name: "Instance status updates",
        description: "Status reflects actual state",
        steps: [
          "Watch instance after launch",
          "Verify status changes (provisioning -> running)",
          "Check connection info appears",
        ],
      },
      {
        id: "gpu-3",
        name: "SSH connection",
        description: "Can connect to running instance",
        steps: [
          "Get connection info from instance",
          "SSH to instance using provided credentials",
          "Verify can run commands",
        ],
      },
      {
        id: "gpu-4",
        name: "Stop instance",
        description: "Can stop running instance",
        steps: [
          "Click Stop on running instance",
          "Confirm stop action",
          "Verify status changes to stopped",
          "Verify billing stops",
        ],
      },
      {
        id: "gpu-5",
        name: "Terminate instance",
        description: "Can delete instance",
        steps: [
          "Click Terminate/Delete on instance",
          "Confirm deletion",
          "Verify instance removed from list",
        ],
      },
    ],
  },
  {
    id: "pod-lifecycle",
    name: "Pod Lifecycle (Save/Pause/Restore)",
    tests: [
      {
        id: "pod-1",
        name: "Save pod (create snapshot)",
        description: "Can save running pod state to snapshot",
        steps: [
          "Have a running GPU instance",
          "Click Save/Pause button on instance card",
          "Confirm save action",
          "Verify saving status shown",
          "Wait for snapshot to complete",
          "Verify pod appears in Saved Pods section",
        ],
      },
      {
        id: "pod-2",
        name: "Saved pod storage billing",
        description: "Saved pods incur storage costs only",
        steps: [
          "Save a pod",
          "Wait for billing sync (30 min)",
          "Check billing transactions",
          "Verify 'Saved Pod Storage' charge appears",
          "Verify GPU usage stops being charged",
        ],
      },
      {
        id: "pod-3",
        name: "Resume saved pod",
        description: "Can restore pod from snapshot",
        steps: [
          "Go to Saved Pods section",
          "Click Resume/Restore on a saved pod",
          "Select GPU type if prompted",
          "Confirm restore",
          "Verify pod starts with saved state",
          "Verify files and environment restored",
        ],
      },
      {
        id: "pod-4",
        name: "Delete saved pod",
        description: "Can permanently delete saved pod",
        steps: [
          "Go to Saved Pods section",
          "Click Delete on a saved pod",
          "Confirm deletion",
          "Verify pod removed from list",
          "Verify storage billing stops",
        ],
      },
      {
        id: "pod-5",
        name: "Multiple snapshots",
        description: "Can have multiple saved pods",
        steps: [
          "Save multiple different pods",
          "Verify all appear in Saved Pods list",
          "Verify each has correct name/details",
          "Restore one while others remain saved",
        ],
      },
      {
        id: "pod-6",
        name: "Snapshot with custom name",
        description: "Can name pod when saving",
        steps: [
          "Click Save on running instance",
          "Enter custom name for snapshot",
          "Confirm save",
          "Verify custom name appears in Saved Pods",
        ],
      },
      {
        id: "pod-7",
        name: "Pod metadata preserved",
        description: "Display name and notes preserved across save/restore",
        steps: [
          "Set display name and notes on running pod",
          "Save the pod",
          "Verify name/notes shown on saved pod",
          "Restore the pod",
          "Verify name/notes preserved on restored pod",
        ],
      },
    ],
  },
  {
    id: "huggingface",
    name: "HuggingFace Deployment",
    tests: [
      {
        id: "hf-1",
        name: "Search HF models",
        description: "Can search for models",
        steps: [
          "Go to Hugging Face tab",
          "Enter model name in search",
          "Verify results appear",
          "Check model details shown",
        ],
      },
      {
        id: "hf-2",
        name: "Deploy HF model",
        description: "Can deploy a model from HF",
        steps: [
          "Select a model from search",
          "Click Deploy",
          "Select GPU configuration",
          "Confirm deployment",
          "Verify deployment starts",
        ],
      },
      {
        id: "hf-3",
        name: "vLLM endpoint ready",
        description: "Model becomes accessible",
        steps: [
          "Wait for deployment to complete",
          "Check endpoint URL shown",
          "Test API endpoint with curl",
          "Verify model responds",
        ],
      },
    ],
  },
  {
    id: "team",
    name: "Team Management",
    tests: [
      {
        id: "team-1",
        name: "View team members",
        description: "Team tab shows members",
        steps: [
          "Go to Team tab",
          "Verify current user shown",
          "Check role displayed correctly",
        ],
      },
      {
        id: "team-2",
        name: "Invite team member",
        description: "Can invite new member",
        steps: [
          "Click Invite Member",
          "Enter email address",
          "Select role",
          "Click Send Invite",
          "Verify invite sent",
        ],
      },
      {
        id: "team-3",
        name: "Accept team invite",
        description: "Invitee can join team",
        steps: [
          "Check email for invite",
          "Click invite link",
          "Complete signup if needed",
          "Verify added to team",
        ],
      },
    ],
  },
  {
    id: "settings",
    name: "Settings & Security",
    tests: [
      {
        id: "set-1",
        name: "Enable 2FA",
        description: "Can enable two-factor auth",
        steps: [
          "Go to Settings tab",
          "Click Enable 2FA",
          "Scan QR code with authenticator app",
          "Enter code to confirm",
          "Verify 2FA enabled",
        ],
      },
      {
        id: "set-2",
        name: "Login with 2FA",
        description: "2FA required on login",
        steps: [
          "Logout",
          "Request login link",
          "Click login link",
          "Verify 2FA code required",
          "Enter code and login",
        ],
      },
      {
        id: "set-3",
        name: "Backup codes",
        description: "Can generate backup codes",
        steps: [
          "In Settings, view backup codes",
          "Verify codes displayed",
          "Test login with backup code",
        ],
      },
      {
        id: "set-4",
        name: "Disable 2FA",
        description: "Can disable 2FA",
        steps: [
          "Go to Settings",
          "Click Disable 2FA",
          "Confirm with current 2FA code",
          "Verify 2FA disabled",
        ],
      },
    ],
  },
  {
    id: "vouchers-admin",
    name: "Admin: Vouchers",
    tests: [
      {
        id: "vadmin-1",
        name: "Create voucher",
        description: "Admin can create voucher codes",
        steps: [
          "Go to Admin > Vouchers",
          "Click Create Voucher",
          "Fill in code, name, credit amount",
          "Save voucher",
          "Verify appears in list",
        ],
      },
      {
        id: "vadmin-2",
        name: "Voucher redemption tracking",
        description: "Can see who used vouchers",
        steps: [
          "Click on a voucher with redemptions",
          "Verify redemption list shows",
          "Check customer email, date, amount",
        ],
      },
      {
        id: "vadmin-3",
        name: "Deactivate voucher",
        description: "Can disable a voucher",
        steps: [
          "Find active voucher",
          "Toggle active status off",
          "Try to use voucher",
          "Verify it's rejected",
        ],
      },
    ],
  },
  {
    id: "referrals-admin",
    name: "Admin: Referrals",
    tests: [
      {
        id: "radmin-1",
        name: "View all referrals",
        description: "Admin can see all referral activity",
        steps: [
          "Go to Admin > Referrals",
          "Verify list of referral claims",
          "Check filter by status works",
        ],
      },
      {
        id: "radmin-2",
        name: "Referral settings",
        description: "Can modify referral program settings",
        steps: [
          "Check reward amount setting",
          "Check max referrals setting",
          "Modify and save",
          "Verify changes apply",
        ],
      },
    ],
  },
  {
    id: "support",
    name: "Support Tickets",
    tests: [
      {
        id: "support-1",
        name: "Create support ticket",
        description: "Can create a new support ticket with subject",
        steps: [
          "Go to Support tab in dashboard",
          "Click 'New Ticket' button",
          "Enter subject and message",
          "Click 'Create Ticket'",
          "Verify ticket created with PKT-{number} format",
        ],
      },
      {
        id: "support-2",
        name: "Ticket number format",
        description: "Ticket numbers follow PKT-{messageId} format",
        steps: [
          "Create a new support ticket",
          "Verify ticket number shows as PKT-{number} (e.g., PKT-57261766)",
          "Verify ticket number appears in ticket list",
          "Verify ticket number appears in ticket detail view",
        ],
      },
      {
        id: "support-3",
        name: "View ticket list",
        description: "Can see all support tickets",
        steps: [
          "Go to Support tab",
          "Verify all tickets listed with ticket numbers",
          "Check ticket status (open/closed) shown",
          "Verify last message preview shown",
        ],
      },
      {
        id: "support-4",
        name: "Reply to ticket",
        description: "Can send message in existing ticket",
        steps: [
          "Click on existing ticket",
          "Enter reply message",
          "Click Send",
          "Verify message appears in conversation",
        ],
      },
      {
        id: "support-5",
        name: "Deep link to ticket",
        description: "Can access ticket directly via URL",
        steps: [
          "Create a support ticket",
          "Get the ticket deep link from email notification",
          "Open the deep link",
          "Verify ticket opens directly in dashboard",
        ],
      },
      {
        id: "support-6",
        name: "Email notification for replies",
        description: "Customer receives email when staff replies",
        steps: [
          "Have staff reply to ticket in the support system",
          "Check customer email for notification",
          "Verify email contains ticket number",
          "Verify email contains link to view reply",
        ],
      },
    ],
  },
  {
    id: "billing-features",
    name: "Billing Features",
    tests: [
      {
        id: "billing-1",
        name: "Saved Pod Storage billing label",
        description: "Storage costs show as 'Saved Pod Storage' in billing",
        steps: [
          "Have a paused/saved pod with storage",
          "Go to Billing tab",
          "Check transaction history",
          "Verify storage charges show as 'Saved Pod Storage: XGB @ $X/GB/hr'",
          "Verify it's clear this is NOT persistent volume storage",
        ],
      },
      {
        id: "billing-2",
        name: "GPU usage billing",
        description: "GPU usage correctly charged",
        steps: [
          "Run a GPU instance for some time",
          "Check billing transactions",
          "Verify GPU usage appears with correct hourly rate",
          "Verify hours are calculated correctly",
        ],
      },
    ],
  },
  {
    id: "stopped-instance-billing",
    name: "Stopped Instance Billing",
    tests: [
      {
        id: "stopped-1",
        name: "Stop confirmation shows cost warning",
        description: "User warned about reservation cost when stopping instance",
        steps: [
          "Have a running GPU instance",
          "Click Stop button",
          "Verify confirmation dialog shows reservation cost",
          "Verify it explains the percentage of hourly rate (e.g., 25%)",
          "Verify it mentions option to terminate to stop all charges",
        ],
      },
      {
        id: "stopped-2",
        name: "Admin can configure stopped instance rate",
        description: "Stopped instance rate percentage configurable in admin settings",
        steps: [
          "Go to Admin > Settings",
          "Find 'Stopped Instance Rate' setting",
          "Verify default is 25%",
          "Change to different value (e.g., 30%)",
          "Save and verify change persisted",
        ],
      },
      {
        id: "stopped-3",
        name: "Stopped instance billed at reduced rate",
        description: "Stopped instances charged at configured percentage of hourly rate",
        steps: [
          "Stop a running GPU instance",
          "Wait for billing sync (30 minutes)",
          "Check billing transactions",
          "Verify 'Reserved Instance Fee' charge appears",
          "Verify amount is reduced rate (e.g., 25% of $2/hr per GPU)",
        ],
      },
      {
        id: "stopped-4",
        name: "Stopped instance billing description",
        description: "Billing shows clear description of stopped instance charge",
        steps: [
          "Stop an instance",
          "Wait for billing sync",
          "Check transaction description",
          "Verify shows GPU count, rate percentage, and reduced hourly rate",
          "Example: 'Reserved Instance Fee: 1 GPU(s) stopped @ 25% rate ($0.50/hr)'",
        ],
      },
      {
        id: "stopped-5",
        name: "Terminated instance stops billing",
        description: "Terminating a stopped instance stops all charges",
        steps: [
          "Have a stopped GPU instance",
          "Click Terminate button",
          "Confirm termination",
          "Wait for billing sync",
          "Verify no more 'Reserved Instance Fee' charges",
        ],
      },
      {
        id: "stopped-6",
        name: "Start instance resumes full billing",
        description: "Starting a stopped instance returns to full hourly rate",
        steps: [
          "Have a stopped GPU instance",
          "Click Start button",
          "Wait for instance to be running",
          "Wait for billing sync",
          "Verify full GPU usage billing resumes",
          "Verify 'Reserved Instance Fee' stops",
        ],
      },
    ],
  },
  {
    id: "edge",
    name: "Edge Cases & Error Handling",
    tests: [
      {
        id: "edge-1",
        name: "Insufficient balance",
        description: "Handle low wallet balance",
        steps: [
          "Try to launch GPU with $0 balance",
          "Verify appropriate error/prompt to top up",
        ],
      },
      {
        id: "edge-2",
        name: "Expired voucher",
        description: "Expired voucher rejected",
        steps: [
          "Try to use expired voucher code",
          "Verify clear expiration error",
        ],
      },
      {
        id: "edge-3",
        name: "Max redemptions reached",
        description: "Voucher limit enforced",
        steps: [
          "Create voucher with max 1 use",
          "Use it once",
          "Try to use again",
          "Verify max uses error",
        ],
      },
      {
        id: "edge-4",
        name: "Network error handling",
        description: "Graceful error on network issues",
        steps: [
          "Disable network",
          "Try various actions",
          "Verify error messages shown",
          "Re-enable, verify recovery",
        ],
      },
    ],
  },
  {
    id: "admin-invites",
    name: "Admin: Invitations",
    tests: [
      {
        id: "ainv-1",
        name: "Add admin sends invite email",
        description: "Adding new admin automatically sends invite email",
        steps: [
          "Go to Admin > Admins tab",
          "Enter a new email address",
          "Click Add Admin",
          "Check email inbox of invited admin",
          "Verify invite email received immediately",
          "Verify email contains Accept Invitation link",
        ],
      },
      {
        id: "ainv-2",
        name: "Admin invite link works",
        description: "New admin can login via invite link",
        steps: [
          "Click Accept Invitation link in email",
          "Verify redirected to admin dashboard",
          "Verify logged in as the invited admin",
        ],
      },
      {
        id: "ainv-3",
        name: "Resend invite works",
        description: "Can resend invite to pending admin",
        steps: [
          "Go to Admin > Admins tab",
          "Find admin who hasn't logged in yet",
          "Click Resend Invite",
          "Verify new email sent",
          "Verify new link works (old may be expired)",
        ],
      },
    ],
  },
  {
    id: "email-templates",
    name: "Admin: Email Templates",
    tests: [
      {
        id: "email-1",
        name: "View email templates list",
        description: "Can view all email templates",
        steps: [
          "Go to Admin > Email Templates tab",
          "Verify list of customizable templates shown",
          "Check default templates available (welcome, login, etc.)",
        ],
      },
      {
        id: "email-2",
        name: "Create custom email template",
        description: "Can customize a default template",
        steps: [
          "Click Customize on a default template (e.g., welcome)",
          "Edit the subject line",
          "Edit the HTML content",
          "Add/use variables like {{customerName}}",
          "Click Save",
          "Verify template appears in custom templates list",
        ],
      },
      {
        id: "email-3",
        name: "Preview email template",
        description: "Can preview template with sample data",
        steps: [
          "Edit or view a template",
          "Click Preview tab",
          "Verify variables replaced with sample values",
          "Check HTML renders correctly",
        ],
      },
      {
        id: "email-4",
        name: "Edit existing template",
        description: "Can modify saved template",
        steps: [
          "Click Edit on a custom template",
          "Make changes to subject or content",
          "Save changes",
          "Verify changes persisted",
        ],
      },
      {
        id: "email-5",
        name: "Toggle template active status",
        description: "Can enable/disable template",
        steps: [
          "Edit a custom template",
          "Toggle the Active switch off",
          "Save",
          "Verify template marked as inactive",
          "Verify system uses code fallback when inactive",
        ],
      },
      {
        id: "email-6",
        name: "Delete custom template",
        description: "Can delete custom template",
        steps: [
          "Click Delete on a custom template",
          "Confirm deletion",
          "Verify template removed from list",
          "Verify default template still shows in Available Templates",
        ],
      },
      {
        id: "email-7",
        name: "Template used in actual emails",
        description: "Custom template used when sending emails",
        steps: [
          "Customize the welcome email template",
          "Sign up a new customer",
          "Check their welcome email",
          "Verify custom content appears (not default)",
        ],
      },
    ],
  },
  {
    id: "gpu-products",
    name: "Admin: GPU Products",
    tests: [
      {
        id: "gprod-1",
        name: "View GPU products list",
        description: "Can view all GPU product configurations",
        steps: [
          "Go to Admin > Products tab",
          "Verify list of GPU products shown",
          "Check product details (name, price, description)",
        ],
      },
      {
        id: "gprod-2",
        name: "Create new GPU product",
        description: "Can add a new GPU product",
        steps: [
          "Click Add Product",
          "Enter name (e.g., 'H100 Starter')",
          "Enter Stripe Price ID",
          "Enter price amount",
          "Add description",
          "Set GPU backend policy IDs if applicable",
          "Save product",
          "Verify appears in list",
        ],
      },
      {
        id: "gprod-3",
        name: "Edit GPU product",
        description: "Can modify existing product",
        steps: [
          "Click Edit on a product",
          "Change name or description",
          "Save changes",
          "Verify changes persisted",
        ],
      },
      {
        id: "gprod-4",
        name: "Product shown on checkout",
        description: "Products appear on checkout page",
        steps: [
          "Go to public checkout page",
          "Verify product options shown",
          "Verify product names match admin config",
          "Verify prices correct",
        ],
      },
      {
        id: "gprod-5",
        name: "Toggle product active status",
        description: "Can show/hide products from checkout",
        steps: [
          "Edit a product",
          "Toggle active status off",
          "Save",
          "Check checkout page",
          "Verify inactive product not shown",
        ],
      },
      {
        id: "gprod-6",
        name: "Delete GPU product",
        description: "Can remove a product",
        steps: [
          "Click Delete on a product",
          "Confirm deletion",
          "Verify removed from list",
          "Verify not shown on checkout",
        ],
      },
    ],
  },
  {
    id: "dynamic-pricing",
    name: "Dynamic Products (No Hardcoding)",
    tests: [
      {
        id: "dyn-1",
        name: "Checkout uses database products",
        description: "Checkout page pulls products from database, not hardcoded",
        steps: [
          "Go to checkout page",
          "Note the product names and prices",
          "Go to Admin > Products",
          "Add or edit a product",
          "Refresh checkout page",
          "Verify new/updated product appears",
        ],
      },
      {
        id: "dyn-2",
        name: "Stripe webhook uses product metadata",
        description: "Subscription created with correct product from DB",
        steps: [
          "Complete a checkout with a specific product",
          "Check customer account",
          "Verify plan name matches the product selected",
          "Verify wallet/credits match product configuration",
        ],
      },
      {
        id: "dyn-3",
        name: "Product changes reflect immediately",
        description: "No deploy needed for product updates",
        steps: [
          "Change a product's description in admin",
          "Refresh checkout page",
          "Verify new description shows without deployment",
        ],
      },
    ],
  },
];
