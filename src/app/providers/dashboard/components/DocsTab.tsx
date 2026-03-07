"use client";

import { useState } from "react";

type DocSection =
  | "getting-started"
  | "adding-servers"
  | "server-requirements"
  | "provisioning"
  | "earnings"
  | "payouts"
  | "faq";

export function DocsTab() {
  const [activeSection, setActiveSection] = useState<DocSection>("getting-started");

  const sections: { id: DocSection; title: string }[] = [
    { id: "getting-started", title: "Getting Started" },
    { id: "adding-servers", title: "Adding Servers" },
    { id: "server-requirements", title: "Server Requirements" },
    { id: "provisioning", title: "Provisioning Process" },
    { id: "earnings", title: "Earnings & Revenue" },
    { id: "payouts", title: "Payouts" },
    { id: "faq", title: "FAQ" },
  ];

  return (
    <div className="flex gap-8">
      {/* Sidebar Navigation */}
      <div className="w-64 flex-shrink-0">
        <div className="bg-white border border-[#e4e7ef] rounded-lg p-4 sticky top-8">
          <h3 className="font-semibold text-[#0b0f1c] mb-4">Documentation</h3>
          <nav className="space-y-1">
            {sections.map((section) => (
              <button
                key={section.id}
                onClick={() => setActiveSection(section.id)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                  activeSection === section.id
                    ? "bg-[#1a4fff]/10 text-[#1a4fff] font-medium"
                    : "text-[#5b6476] hover:bg-[#f7f8fb] hover:text-[#0b0f1c]"
                }`}
              >
                {section.title}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 min-w-0">
        <div className="bg-white border border-[#e4e7ef] rounded-lg p-8">
          {activeSection === "getting-started" && <GettingStartedContent />}
          {activeSection === "adding-servers" && <AddingServersContent />}
          {activeSection === "server-requirements" && <ServerRequirementsContent />}
          {activeSection === "provisioning" && <ProvisioningContent />}
          {activeSection === "earnings" && <EarningsContent />}
          {activeSection === "payouts" && <PayoutsContent />}
          {activeSection === "faq" && <FAQContent />}
        </div>
      </div>
    </div>
  );
}

function GettingStartedContent() {
  return (
    <div className="prose prose-slate max-w-none">
      <h1 className="text-2xl font-bold text-[#0b0f1c] mb-6">Getting Started as a Provider</h1>

      <p className="text-[#5b6476] mb-6">
        Welcome to the GPU Cloud Provider Network! This guide will help you get started with
        monetizing your GPU infrastructure.
      </p>

      <h2 className="text-lg font-semibold text-[#0b0f1c] mt-8 mb-4">Overview</h2>
      <p className="text-[#5b6476] mb-4">
        As a GPU Cloud provider, you can earn money by making your GPU servers available to our
        customers. We handle all the customer-facing aspects including billing, support, and
        orchestration, while you focus on maintaining your hardware.
      </p>

      <h2 className="text-lg font-semibold text-[#0b0f1c] mt-8 mb-4">Quick Start Steps</h2>
      <ol className="list-decimal list-inside space-y-3 text-[#5b6476]">
        <li>
          <span className="font-medium text-[#0b0f1c]">Set up your server</span> - Ensure your server
          meets our requirements (Ubuntu 22.04+, NVIDIA GPUs, CUDA installed)
        </li>
        <li>
          <span className="font-medium text-[#0b0f1c]">Add SSH access</span> - Create a user account
          with SSH access that we can use for validation and management
        </li>
        <li>
          <span className="font-medium text-[#0b0f1c]">Submit your server</span> - Use the
          &quot;Add Server&quot; button in the Infrastructure tab to submit your server details
        </li>
        <li>
          <span className="font-medium text-[#0b0f1c]">Wait for validation</span> - Our system will
          automatically validate your server and detect GPU specifications
        </li>
        <li>
          <span className="font-medium text-[#0b0f1c]">Go live</span> - Once approved, your server
          becomes available to customers and starts earning
        </li>
      </ol>

      <h2 className="text-lg font-semibold text-[#0b0f1c] mt-8 mb-4">Dashboard Overview</h2>
      <p className="text-[#5b6476] mb-4">Your provider dashboard includes:</p>
      <ul className="list-disc list-inside space-y-2 text-[#5b6476]">
        <li>
          <span className="font-medium text-[#0b0f1c]">Infrastructure</span> - Manage your servers,
          view status, and add new servers
        </li>
        <li>
          <span className="font-medium text-[#0b0f1c]">Rates</span> - View current payout rates for
          different GPU types
        </li>
        <li>
          <span className="font-medium text-[#0b0f1c]">Revenue</span> - Track your earnings and
          utilization
        </li>
        <li>
          <span className="font-medium text-[#0b0f1c]">Payouts</span> - View payout history and
          upcoming payments
        </li>
        <li>
          <span className="font-medium text-[#0b0f1c]">Settings</span> - Update your company
          information and contact details
        </li>
      </ul>

      <div className="mt-8 p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <p className="text-blue-800 font-medium">Need Help?</p>
        <p className="text-blue-700 text-sm mt-1">
          Contact our provider support team at{" "}
          <a href="mailto:support@example.com" className="underline">
            support@example.com
          </a>
        </p>
      </div>
    </div>
  );
}

function AddingServersContent() {
  return (
    <div className="prose prose-slate max-w-none">
      <h1 className="text-2xl font-bold text-[#0b0f1c] mb-6">Adding Servers</h1>

      <p className="text-[#5b6476] mb-6">
        Follow these steps to add a new GPU server to the GPU Cloud network.
      </p>

      <h2 className="text-lg font-semibold text-[#0b0f1c] mt-8 mb-4">Step 1: Prepare Your Server</h2>
      <p className="text-[#5b6476] mb-4">Before adding a server, ensure:</p>
      <ul className="list-disc list-inside space-y-2 text-[#5b6476]">
        <li>The server is running Ubuntu 22.04 or later</li>
        <li>NVIDIA drivers and CUDA are installed</li>
        <li>SSH is enabled and accessible from the internet</li>
        <li>You have root or sudo access credentials</li>
      </ul>

      <h2 className="text-lg font-semibold text-[#0b0f1c] mt-8 mb-4">Step 2: Create SSH Access</h2>
      <p className="text-[#5b6476] mb-4">
        We recommend creating a dedicated user for GPU Cloud management:
      </p>
      <div className="bg-[#0b0f1c] rounded-lg p-4 mb-4">
        <code className="text-green-400 text-sm whitespace-pre-wrap">
{`# Create a new user
sudo adduser packetai

# Grant sudo privileges
sudo usermod -aG sudo packetai

# Set a strong password
sudo passwd packetai`}
        </code>
      </div>

      <h2 className="text-lg font-semibold text-[#0b0f1c] mt-8 mb-4">Step 3: Submit Server Details</h2>
      <p className="text-[#5b6476] mb-4">
        In the Infrastructure tab, click &quot;Add Server&quot; and provide:
      </p>
      <ul className="list-disc list-inside space-y-2 text-[#5b6476]">
        <li>
          <span className="font-medium text-[#0b0f1c]">IP Address</span> - Public IP address of your
          server
        </li>
        <li>
          <span className="font-medium text-[#0b0f1c]">SSH Port</span> - Usually 22, or your custom
          SSH port
        </li>
        <li>
          <span className="font-medium text-[#0b0f1c]">Username</span> - SSH username (e.g.,
          packetai)
        </li>
        <li>
          <span className="font-medium text-[#0b0f1c]">Password</span> - SSH password for
          authentication
        </li>
        <li>
          <span className="font-medium text-[#0b0f1c]">GPU Type</span> - Select the GPU model in
          your server
        </li>
      </ul>

      <h2 className="text-lg font-semibold text-[#0b0f1c] mt-8 mb-4">Step 4: Automatic Validation</h2>
      <p className="text-[#5b6476] mb-4">
        After submission, our system will automatically:
      </p>
      <ol className="list-decimal list-inside space-y-2 text-[#5b6476]">
        <li>Connect to your server via SSH</li>
        <li>Verify GPU hardware and detect specifications</li>
        <li>Check system compatibility</li>
        <li>Install required management software</li>
      </ol>

      <div className="mt-8 p-4 bg-amber-50 border border-amber-200 rounded-lg">
        <p className="text-amber-800 font-medium">Important Note</p>
        <p className="text-amber-700 text-sm mt-1">
          After removing a server, you must wait 20 minutes before re-adding it. This cooldown
          prevents issues with our provisioning system.
        </p>
      </div>
    </div>
  );
}

function ServerRequirementsContent() {
  return (
    <div className="prose prose-slate max-w-none">
      <h1 className="text-2xl font-bold text-[#0b0f1c] mb-6">Server Requirements</h1>

      <p className="text-[#5b6476] mb-6">
        To join the GPU Cloud provider network, your servers must meet the following requirements.
      </p>

      <h2 className="text-lg font-semibold text-[#0b0f1c] mt-8 mb-4">Hardware Requirements</h2>
      <div className="overflow-x-auto">
        <table className="min-w-full border border-[#e4e7ef] rounded-lg overflow-hidden">
          <thead className="bg-[#f7f8fb]">
            <tr>
              <th className="text-left py-3 px-4 text-sm font-medium text-[#0b0f1c]">Component</th>
              <th className="text-left py-3 px-4 text-sm font-medium text-[#0b0f1c]">Minimum</th>
              <th className="text-left py-3 px-4 text-sm font-medium text-[#0b0f1c]">Recommended</th>
            </tr>
          </thead>
          <tbody className="text-[#5b6476]">
            <tr className="border-t border-[#e4e7ef]">
              <td className="py-3 px-4">GPU</td>
              <td className="py-3 px-4">NVIDIA RTX 3090 or equivalent</td>
              <td className="py-3 px-4">NVIDIA A100 / H100</td>
            </tr>
            <tr className="border-t border-[#e4e7ef]">
              <td className="py-3 px-4">CPU</td>
              <td className="py-3 px-4">8 cores</td>
              <td className="py-3 px-4">32+ cores</td>
            </tr>
            <tr className="border-t border-[#e4e7ef]">
              <td className="py-3 px-4">RAM</td>
              <td className="py-3 px-4">32 GB</td>
              <td className="py-3 px-4">128+ GB</td>
            </tr>
            <tr className="border-t border-[#e4e7ef]">
              <td className="py-3 px-4">Storage</td>
              <td className="py-3 px-4">500 GB SSD</td>
              <td className="py-3 px-4">2+ TB NVMe SSD</td>
            </tr>
            <tr className="border-t border-[#e4e7ef]">
              <td className="py-3 px-4">Network</td>
              <td className="py-3 px-4">1 Gbps</td>
              <td className="py-3 px-4">10+ Gbps</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2 className="text-lg font-semibold text-[#0b0f1c] mt-8 mb-4">Software Requirements</h2>
      <ul className="list-disc list-inside space-y-2 text-[#5b6476]">
        <li>
          <span className="font-medium text-[#0b0f1c]">Operating System:</span> Ubuntu 22.04 LTS or
          later
        </li>
        <li>
          <span className="font-medium text-[#0b0f1c]">NVIDIA Driver:</span> Version 525.60.13 or
          later
        </li>
        <li>
          <span className="font-medium text-[#0b0f1c]">CUDA:</span> Version 12.0 or later
        </li>
        <li>
          <span className="font-medium text-[#0b0f1c]">Docker:</span> Version 24.0 or later
          (optional, installed during provisioning)
        </li>
      </ul>

      <h2 className="text-lg font-semibold text-[#0b0f1c] mt-8 mb-4">Network Requirements</h2>
      <ul className="list-disc list-inside space-y-2 text-[#5b6476]">
        <li>Public static IP address</li>
        <li>SSH access (port 22 or custom port)</li>
        <li>Unrestricted outbound internet access</li>
        <li>Low latency connection ({"<"}50ms to major cloud regions preferred)</li>
      </ul>

      <h2 className="text-lg font-semibold text-[#0b0f1c] mt-8 mb-4">Supported GPU Models</h2>
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-[#f7f8fb] border border-[#e4e7ef] rounded-lg p-4">
          <h3 className="font-medium text-[#0b0f1c] mb-2">Data Center GPUs</h3>
          <ul className="text-sm text-[#5b6476] space-y-1">
            <li>NVIDIA A100 (40GB / 80GB)</li>
            <li>NVIDIA H100</li>
            <li>NVIDIA H200</li>
            <li>NVIDIA B200</li>
            <li>NVIDIA B300</li>
            <li>NVIDIA A10</li>
            <li>NVIDIA L40S</li>
          </ul>
        </div>
        <div className="bg-[#f7f8fb] border border-[#e4e7ef] rounded-lg p-4">
          <h3 className="font-medium text-[#0b0f1c] mb-2">Professional GPUs</h3>
          <ul className="text-sm text-[#5b6476] space-y-1">
            <li>NVIDIA RTX PRO 6000 Blackwell (96GB)</li>
            <li>NVIDIA RTX 4090</li>
            <li>NVIDIA RTX 3090</li>
            <li>NVIDIA RTX A6000</li>
          </ul>
        </div>
      </div>

      <div className="mt-8 p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <p className="text-blue-800 font-medium">Verification Command</p>
        <p className="text-blue-700 text-sm mt-1">
          Run <code className="bg-blue-100 px-1 rounded">nvidia-smi</code> on your server to verify
          GPU detection and driver installation.
        </p>
      </div>
    </div>
  );
}

function ProvisioningContent() {
  return (
    <div className="prose prose-slate max-w-none">
      <h1 className="text-2xl font-bold text-[#0b0f1c] mb-6">Provisioning Process</h1>

      <p className="text-[#5b6476] mb-6">
        When you add a server, it goes through a multi-step provisioning process before becoming
        available to customers.
      </p>

      <h2 className="text-lg font-semibold text-[#0b0f1c] mt-8 mb-4">Provisioning Steps</h2>
      <div className="space-y-4">
        <div className="flex gap-4 p-4 bg-[#f7f8fb] rounded-lg">
          <div className="w-8 h-8 bg-[#1a4fff] text-white rounded-full flex items-center justify-center flex-shrink-0 font-medium">
            1
          </div>
          <div>
            <h3 className="font-medium text-[#0b0f1c]">SSH Connection</h3>
            <p className="text-sm text-[#5b6476] mt-1">
              We establish an SSH connection to your server using the provided credentials.
            </p>
          </div>
        </div>

        <div className="flex gap-4 p-4 bg-[#f7f8fb] rounded-lg">
          <div className="w-8 h-8 bg-[#1a4fff] text-white rounded-full flex items-center justify-center flex-shrink-0 font-medium">
            2
          </div>
          <div>
            <h3 className="font-medium text-[#0b0f1c]">Hardware Detection</h3>
            <p className="text-sm text-[#5b6476] mt-1">
              Our system automatically detects GPU model, count, memory, CPU specs, RAM, and storage.
            </p>
          </div>
        </div>

        <div className="flex gap-4 p-4 bg-[#f7f8fb] rounded-lg">
          <div className="w-8 h-8 bg-[#1a4fff] text-white rounded-full flex items-center justify-center flex-shrink-0 font-medium">
            3
          </div>
          <div>
            <h3 className="font-medium text-[#0b0f1c]">Validation</h3>
            <p className="text-sm text-[#5b6476] mt-1">
              We verify that your server meets minimum requirements and the hardware matches your
              selected GPU type.
            </p>
          </div>
        </div>

        <div className="flex gap-4 p-4 bg-[#f7f8fb] rounded-lg">
          <div className="w-8 h-8 bg-[#1a4fff] text-white rounded-full flex items-center justify-center flex-shrink-0 font-medium">
            4
          </div>
          <div>
            <h3 className="font-medium text-[#0b0f1c]">Region Assignment</h3>
            <p className="text-sm text-[#5b6476] mt-1">
              Your server is assigned to a region based on location and network characteristics.
            </p>
          </div>
        </div>

        <div className="flex gap-4 p-4 bg-[#f7f8fb] rounded-lg">
          <div className="w-8 h-8 bg-[#1a4fff] text-white rounded-full flex items-center justify-center flex-shrink-0 font-medium">
            5
          </div>
          <div>
            <h3 className="font-medium text-[#0b0f1c]">Pool Creation</h3>
            <p className="text-sm text-[#5b6476] mt-1">
              A GPU pool is created for your server, making it available for customer workloads.
            </p>
          </div>
        </div>

        <div className="flex gap-4 p-4 bg-green-50 rounded-lg">
          <div className="w-8 h-8 bg-green-500 text-white rounded-full flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div>
            <h3 className="font-medium text-green-800">Active</h3>
            <p className="text-sm text-green-700 mt-1">
              Your server is now live and can accept customer workloads. You start earning!
            </p>
          </div>
        </div>
      </div>

      <h2 className="text-lg font-semibold text-[#0b0f1c] mt-8 mb-4">Server Statuses</h2>
      <div className="overflow-x-auto">
        <table className="min-w-full border border-[#e4e7ef] rounded-lg overflow-hidden">
          <thead className="bg-[#f7f8fb]">
            <tr>
              <th className="text-left py-3 px-4 text-sm font-medium text-[#0b0f1c]">Status</th>
              <th className="text-left py-3 px-4 text-sm font-medium text-[#0b0f1c]">Description</th>
            </tr>
          </thead>
          <tbody className="text-[#5b6476]">
            <tr className="border-t border-[#e4e7ef]">
              <td className="py-3 px-4">
                <span className="px-2 py-1 bg-yellow-100 text-yellow-800 text-xs rounded-full">
                  Validating
                </span>
              </td>
              <td className="py-3 px-4">Server is being validated</td>
            </tr>
            <tr className="border-t border-[#e4e7ef]">
              <td className="py-3 px-4">
                <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-full">
                  Provisioning
                </span>
              </td>
              <td className="py-3 px-4">Server passed validation, being set up</td>
            </tr>
            <tr className="border-t border-[#e4e7ef]">
              <td className="py-3 px-4">
                <span className="px-2 py-1 bg-green-100 text-green-800 text-xs rounded-full">
                  Active
                </span>
              </td>
              <td className="py-3 px-4">Server is live and earning</td>
            </tr>
            <tr className="border-t border-[#e4e7ef]">
              <td className="py-3 px-4">
                <span className="px-2 py-1 bg-red-100 text-red-800 text-xs rounded-full">
                  Validation Failed
                </span>
              </td>
              <td className="py-3 px-4">Server did not pass validation checks</td>
            </tr>
            <tr className="border-t border-[#e4e7ef]">
              <td className="py-3 px-4">
                <span className="px-2 py-1 bg-orange-100 text-orange-800 text-xs rounded-full">
                  Removal Scheduled
                </span>
              </td>
              <td className="py-3 px-4">Server is scheduled for removal</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="mt-8 p-4 bg-amber-50 border border-amber-200 rounded-lg">
        <p className="text-amber-800 font-medium">Provisioning Time</p>
        <p className="text-amber-700 text-sm mt-1">
          The provisioning process typically takes 5-15 minutes. You can monitor progress in the
          Infrastructure tab.
        </p>
      </div>

      <h2 className="text-lg font-semibold text-[#0b0f1c] mt-8 mb-4">Server Removal</h2>
      <p className="text-[#5b6476] mb-4">
        If you need to remove a server from the network, you can do so from the Infrastructure tab.
        The removal process depends on whether there are active customers using the server:
      </p>

      <div className="space-y-4">
        <div className="flex gap-4 p-4 bg-green-50 rounded-lg">
          <div className="w-8 h-8 bg-green-500 text-white rounded-full flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div>
            <h3 className="font-medium text-green-800">No Active Users</h3>
            <p className="text-sm text-green-700 mt-1">
              Server can be removed immediately. You&apos;ll continue earning until the removal is processed.
            </p>
          </div>
        </div>

        <div className="flex gap-4 p-4 bg-amber-50 rounded-lg">
          <div className="w-8 h-8 bg-amber-500 text-white rounded-full flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <h3 className="font-medium text-amber-800">Active Users Present - 7-Day Notice Required</h3>
            <p className="text-sm text-amber-700 mt-1">
              When customers are actively using your server, a <span className="font-semibold">7-day notice period</span> is required.
              This gives customers time to migrate their data and workloads to another server. During this period:
            </p>
            <ul className="text-sm text-amber-700 mt-2 list-disc list-inside space-y-1">
              <li>Your server remains active and continues earning</li>
              <li>Customers are notified about the upcoming removal</li>
              <li>New customers cannot be assigned to the server</li>
              <li>After 7 days, the server is automatically removed</li>
            </ul>
          </div>
        </div>
      </div>

      <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <p className="text-blue-800 font-medium">Canceling a Removal Request</p>
        <p className="text-blue-700 text-sm mt-1">
          If you change your mind during the notice period, you can cancel the removal request from the
          Infrastructure tab. The server will return to normal operation.
        </p>
      </div>
    </div>
  );
}

function EarningsContent() {
  return (
    <div className="prose prose-slate max-w-none">
      <h1 className="text-2xl font-bold text-[#0b0f1c] mb-6">Earnings & Revenue</h1>

      <p className="text-[#5b6476] mb-6">
        Understand how you earn money as a GPU Cloud provider.
      </p>

      <h2 className="text-lg font-semibold text-[#0b0f1c] mt-8 mb-4">How Earnings Work</h2>
      <p className="text-[#5b6476] mb-4">
        You earn a fixed rate per GPU per hour based on your GPU type. Earnings are calculated in
        real-time and can be viewed in the Revenue tab.
      </p>

      <div className="bg-[#f7f8fb] border border-[#e4e7ef] rounded-lg p-6 mb-6">
        <h3 className="font-medium text-[#0b0f1c] mb-3">Earnings Formula</h3>
        <p className="text-[#0b0f1c] font-mono bg-white border border-[#e4e7ef] rounded p-3">
          Earnings = GPU Count x Hourly Rate x Utilized Hours
        </p>
        <p className="text-sm text-[#5b6476] mt-3">
          Example: 4 A100 GPUs at $2.00/hr with 80% utilization over 720 hours (month)
          <br />= 4 x $2.00 x (720 x 0.80) = $4,608/month
        </p>
      </div>

      <h2 className="text-lg font-semibold text-[#0b0f1c] mt-8 mb-4">Utilization</h2>
      <p className="text-[#5b6476] mb-4">
        Utilization is the percentage of time your GPUs are being used by customers. Higher
        utilization means higher earnings.
      </p>
      <ul className="list-disc list-inside space-y-2 text-[#5b6476]">
        <li>
          <span className="font-medium text-[#0b0f1c]">100% Utilization:</span> All GPUs are in use
          24/7
        </li>
        <li>
          <span className="font-medium text-[#0b0f1c]">80% Utilization:</span> GPUs are in use ~19
          hours/day
        </li>
        <li>
          <span className="font-medium text-[#0b0f1c]">60% Utilization:</span> GPUs are in use ~14
          hours/day
        </li>
      </ul>

      <h2 className="text-lg font-semibold text-[#0b0f1c] mt-8 mb-4">Revenue Dashboard</h2>
      <p className="text-[#5b6476] mb-4">The Revenue tab shows:</p>
      <ul className="list-disc list-inside space-y-2 text-[#5b6476]">
        <li>Your total provider earnings</li>
        <li>Customer revenue generated by your servers</li>
        <li>Current utilization percentage</li>
        <li>Hours occupied (utilized)</li>
        <li>Average revenue per occupied hour</li>
        <li>Daily revenue chart</li>
        <li>Revenue breakdown by server</li>
      </ul>

      <h2 className="text-lg font-semibold text-[#0b0f1c] mt-8 mb-4">Factors Affecting Earnings</h2>
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <h3 className="font-medium text-green-800 mb-2">Increases Earnings</h3>
          <ul className="text-sm text-green-700 space-y-1">
            <li>Higher-tier GPUs</li>
            <li>Better uptime/reliability</li>
            <li>More GPUs per server</li>
            <li>Faster network speeds</li>
          </ul>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <h3 className="font-medium text-red-800 mb-2">Decreases Earnings</h3>
          <ul className="text-sm text-red-700 space-y-1">
            <li>Server downtime</li>
            <li>Network issues</li>
            <li>Hardware failures</li>
            <li>Low market demand</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

function PayoutsContent() {
  return (
    <div className="prose prose-slate max-w-none">
      <h1 className="text-2xl font-bold text-[#0b0f1c] mb-6">Payouts</h1>

      <p className="text-[#5b6476] mb-6">
        Learn about how and when you get paid for your GPU contributions.
      </p>

      <h2 className="text-lg font-semibold text-[#0b0f1c] mt-8 mb-4">Payout Schedule</h2>
      <div className="bg-[#f7f8fb] border border-[#e4e7ef] rounded-lg p-6 mb-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-[#1a4fff] text-white rounded-full flex items-center justify-center">
            <span className="text-xl font-bold">1</span>
          </div>
          <div>
            <p className="font-medium text-[#0b0f1c]">Monthly Payouts</p>
            <p className="text-sm text-[#5b6476]">
              Payouts are processed on the 1st of each month for the previous month&apos;s earnings.
            </p>
          </div>
        </div>
      </div>

      <h2 className="text-lg font-semibold text-[#0b0f1c] mt-8 mb-4">Payout Process</h2>
      <ol className="list-decimal list-inside space-y-3 text-[#5b6476]">
        <li>
          <span className="font-medium text-[#0b0f1c]">End of Month:</span> Your earnings for the
          month are calculated
        </li>
        <li>
          <span className="font-medium text-[#0b0f1c]">1st of Month:</span> Payout is initiated via
          wire transfer
        </li>
        <li>
          <span className="font-medium text-[#0b0f1c]">Processing:</span> Typically takes 3-5
          business days
        </li>
        <li>
          <span className="font-medium text-[#0b0f1c]">Confirmation:</span> You receive confirmation
          and invoice
        </li>
      </ol>

      <h2 className="text-lg font-semibold text-[#0b0f1c] mt-8 mb-4">Payout Methods</h2>
      <p className="text-[#5b6476] mb-4">We currently support:</p>
      <ul className="list-disc list-inside space-y-2 text-[#5b6476]">
        <li>
          <span className="font-medium text-[#0b0f1c]">Wire Transfer (USD):</span> Bank transfer to
          your registered account
        </li>
        <li>
          <span className="font-medium text-[#0b0f1c]">Wire Transfer (EUR):</span> For European
          providers
        </li>
      </ul>

      <h2 className="text-lg font-semibold text-[#0b0f1c] mt-8 mb-4">Payout Statuses</h2>
      <div className="overflow-x-auto">
        <table className="min-w-full border border-[#e4e7ef] rounded-lg overflow-hidden">
          <thead className="bg-[#f7f8fb]">
            <tr>
              <th className="text-left py-3 px-4 text-sm font-medium text-[#0b0f1c]">Status</th>
              <th className="text-left py-3 px-4 text-sm font-medium text-[#0b0f1c]">Description</th>
            </tr>
          </thead>
          <tbody className="text-[#5b6476]">
            <tr className="border-t border-[#e4e7ef]">
              <td className="py-3 px-4">
                <span className="px-2 py-1 bg-yellow-100 text-yellow-800 text-xs rounded-full">
                  Pending
                </span>
              </td>
              <td className="py-3 px-4">Payout is scheduled but not yet processed</td>
            </tr>
            <tr className="border-t border-[#e4e7ef]">
              <td className="py-3 px-4">
                <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-full">
                  Processing
                </span>
              </td>
              <td className="py-3 px-4">Payout is being processed</td>
            </tr>
            <tr className="border-t border-[#e4e7ef]">
              <td className="py-3 px-4">
                <span className="px-2 py-1 bg-green-100 text-green-800 text-xs rounded-full">
                  Paid
                </span>
              </td>
              <td className="py-3 px-4">Payment has been sent to your account</td>
            </tr>
            <tr className="border-t border-[#e4e7ef]">
              <td className="py-3 px-4">
                <span className="px-2 py-1 bg-red-100 text-red-800 text-xs rounded-full">
                  Failed
                </span>
              </td>
              <td className="py-3 px-4">Payment failed - contact support</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2 className="text-lg font-semibold text-[#0b0f1c] mt-8 mb-4">Minimum Payout</h2>
      <p className="text-[#5b6476] mb-4">
        The minimum payout threshold is <span className="font-medium text-[#0b0f1c]">$100</span>. If
        your monthly earnings are below this amount, they will roll over to the next month.
      </p>

      <h2 className="text-lg font-semibold text-[#0b0f1c] mt-8 mb-4">Invoices</h2>
      <p className="text-[#5b6476] mb-4">
        Invoices are automatically generated for each payout and can be downloaded from the Payouts
        tab. Invoices include:
      </p>
      <ul className="list-disc list-inside space-y-2 text-[#5b6476]">
        <li>Billing period dates</li>
        <li>Gross earnings breakdown</li>
        <li>Any deductions or fees</li>
        <li>Net payout amount</li>
        <li>Payment details</li>
      </ul>

      <div className="mt-8 p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <p className="text-blue-800 font-medium">Update Payment Details</p>
        <p className="text-blue-700 text-sm mt-1">
          To update your bank account or payment preferences, contact us at{" "}
          <a href="mailto:support@example.com" className="underline">
            support@example.com
          </a>
        </p>
      </div>
    </div>
  );
}

function FAQContent() {
  const faqs = [
    {
      question: "What happens if my server goes offline?",
      answer:
        "If your server goes offline, it stops earning until it comes back online. We recommend maintaining high uptime for maximum earnings. Extended downtime may affect your reliability score.",
    },
    {
      question: "Can I remove a server at any time?",
      answer:
        "Yes, you can request server removal from the Infrastructure tab. If there are active customer workloads on the server, a 7-day notice period is required to give customers time to migrate their data. Servers with no active users can be removed immediately. Note that after removal, you must wait 20 minutes before adding the same server again.",
    },
    {
      question: "How is utilization calculated?",
      answer:
        "Utilization is calculated as the percentage of time your GPU is actively being used by customers, compared to the total time it's available. We calculate this in real-time and display it in your dashboard.",
    },
    {
      question: "What if my GPU type isn't listed?",
      answer:
        "Contact us at support@example.com with your GPU specifications. We're constantly expanding our supported GPU list based on provider availability and customer demand.",
    },
    {
      question: "Can I set custom pricing?",
      answer:
        "Custom pricing arrangements may be available for large-scale providers. Contact us to discuss enterprise options.",
    },
    {
      question: "What maintenance is required?",
      answer:
        "We recommend keeping your operating system and NVIDIA drivers up to date. Major updates should be scheduled during low-demand periods. You can schedule maintenance through the dashboard.",
    },
    {
      question: "How do I contact support?",
      answer:
        "For provider support, email support@example.com. We typically respond within 24 business hours.",
    },
    {
      question: "What security measures do you take?",
      answer:
        "We use SSH key authentication, encrypted communications, and isolated container environments for customer workloads. Customer data is never stored on your servers beyond their active session.",
    },
    {
      question: "Can I add multiple servers?",
      answer:
        "Yes, there's no limit to the number of servers you can add. Each server goes through the same validation and provisioning process.",
    },
    {
      question: "What if validation fails?",
      answer:
        "If validation fails, you'll see the specific error in the Infrastructure tab. Common issues include incorrect SSH credentials, missing NVIDIA drivers, or GPU type mismatch. Fix the issue and try adding the server again.",
    },
  ];

  return (
    <div className="prose prose-slate max-w-none">
      <h1 className="text-2xl font-bold text-[#0b0f1c] mb-6">Frequently Asked Questions</h1>

      <div className="space-y-4">
        {faqs.map((faq, index) => (
          <div key={index} className="border border-[#e4e7ef] rounded-lg overflow-hidden">
            <div className="p-4 bg-[#f7f8fb]">
              <h3 className="font-medium text-[#0b0f1c]">{faq.question}</h3>
            </div>
            <div className="p-4">
              <p className="text-[#5b6476]">{faq.answer}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-8 p-6 bg-gradient-to-r from-[#1a4fff]/10 to-[#1a4fff]/5 border border-[#1a4fff]/20 rounded-lg">
        <h3 className="font-semibold text-[#0b0f1c] mb-2">Still have questions?</h3>
        <p className="text-[#5b6476] mb-4">
          Our provider support team is here to help you succeed.
        </p>
        <a
          href="mailto:support@example.com"
          className="inline-flex items-center px-4 py-2 bg-[#1a4fff] text-white rounded-lg font-medium hover:bg-[#1a4fff]/90"
        >
          Contact Support
        </a>
      </div>
    </div>
  );
}
