/**
 * Pipedrive CRM Integration
 * Syncs leads and customers in real-time
 */

const PIPEDRIVE_API_TOKEN = process.env.PIPEDRIVE_API_TOKEN;
const PIPEDRIVE_API_URL = "https://api.pipedrive.com/v1";

// Lead types for tagging
export type LeadType = "gpu" | "cluster";
export type ContactType = "lead" | "customer";

// Pipedrive label IDs (configured in Pipedrive person field settings)
const LABEL_IDS = {
  lead: 153,      // "Packet - Lead"
  customer: 154,  // "Packet - Customer"
  gpu: 155,       // "Packet - GPU"
  cluster: 156,   // "Packet - Cluster"
};

interface PipedrivePersonInput {
  name: string;
  email: string;
  phone?: string;
  company?: string;
  contactType: ContactType;
  leadType?: LeadType; // Only for leads
  notes?: string;
  customFields?: Record<string, string>;
}

interface PipedriveResponse {
  success: boolean;
  data?: any;
  error?: string;
}

/**
 * Make a request to Pipedrive API
 */
async function pipedriveRequest(
  endpoint: string,
  method: "GET" | "POST" | "PUT" | "DELETE" = "GET",
  body?: Record<string, any>
): Promise<PipedriveResponse> {
  if (!PIPEDRIVE_API_TOKEN) {
    console.error("[Pipedrive] API token not configured");
    return { success: false, error: "API token not configured" };
  }

  const url = `${PIPEDRIVE_API_URL}${endpoint}?api_token=${PIPEDRIVE_API_TOKEN}`;

  try {
    const response = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      console.error("[Pipedrive] API error:", data);
      return { success: false, error: data.error || "API request failed" };
    }

    return { success: true, data: data.data };
  } catch (error) {
    console.error("[Pipedrive] Request failed:", error);
    return { success: false, error: String(error) };
  }
}

/**
 * Find or create an organization in Pipedrive
 */
async function findOrCreateOrganization(name: string): Promise<number | null> {
  if (!name) return null;

  // Search for existing org
  const searchResult = await pipedriveRequest(
    `/organizations/search?term=${encodeURIComponent(name)}&limit=1`
  );

  if (searchResult.success && searchResult.data?.items?.length > 0) {
    return searchResult.data.items[0].item.id;
  }

  // Create new org
  const createResult = await pipedriveRequest("/organizations", "POST", {
    name,
  });

  if (createResult.success && createResult.data?.id) {
    console.log(`[Pipedrive] Created organization: ${name} (${createResult.data.id})`);
    return createResult.data.id;
  }

  return null;
}

/**
 * Find a person by email
 */
async function findPersonByEmail(email: string): Promise<any | null> {
  const result = await pipedriveRequest(
    `/persons/search?term=${encodeURIComponent(email)}&fields=email&limit=1`
  );

  if (result.success && result.data?.items?.length > 0) {
    return result.data.items[0].item;
  }

  return null;
}

/**
 * Build label IDs array from contact type and lead type
 */
function buildLabelIds(contactType: ContactType, leadType?: LeadType): number[] {
  const labelIds: number[] = [LABEL_IDS[contactType]];
  if (leadType) {
    labelIds.push(LABEL_IDS[leadType]);
  }
  return labelIds;
}

/**
 * Create or update a person in Pipedrive
 */
export async function syncPersonToPipedrive(
  input: PipedrivePersonInput
): Promise<PipedriveResponse> {
  const { name, email, phone, company, contactType, leadType, notes } = input;

  console.log(`[Pipedrive] Syncing ${contactType}: ${email} (${leadType || "n/a"})`);

  // Check if person already exists
  const existingPerson = await findPersonByEmail(email);

  // Get or create organization
  let orgId: number | null = null;
  if (company) {
    orgId = await findOrCreateOrganization(company);
  }

  // Build person data
  const personData: Record<string, any> = {
    name,
    email: [{ value: email, primary: true, label: "work" }],
  };

  if (phone) {
    personData.phone = [{ value: phone, primary: true, label: "work" }];
  }

  if (orgId) {
    personData.org_id = orgId;
  }

  // Add note with details if provided
  const noteContent = notes || "";

  if (existingPerson) {
    // Update existing person - add label IDs without removing existing ones
    const existingLabelIds: number[] = existingPerson.label_ids || [];
    const newLabelIds = buildLabelIds(contactType, leadType);

    // Merge label IDs (avoid duplicates)
    const allLabelIds = new Set([...existingLabelIds, ...newLabelIds]);
    personData.label_ids = Array.from(allLabelIds);

    const result = await pipedriveRequest(
      `/persons/${existingPerson.id}`,
      "PUT",
      personData
    );

    if (result.success) {
      console.log(`[Pipedrive] Updated person: ${email} (${existingPerson.id})`);

      // Add note if provided
      if (noteContent) {
        await pipedriveRequest("/notes", "POST", {
          content: noteContent,
          person_id: existingPerson.id,
        });
      }
    }

    return result;
  } else {
    // Create new person with label IDs
    personData.label_ids = buildLabelIds(contactType, leadType);

    const result = await pipedriveRequest("/persons", "POST", personData);

    if (result.success && result.data?.id) {
      console.log(`[Pipedrive] Created person: ${email} (${result.data.id})`);

      // Add note if provided
      if (noteContent) {
        await pipedriveRequest("/notes", "POST", {
          content: noteContent,
          person_id: result.data.id,
        });
      }
    }

    return result;
  }
}

/**
 * Sync a quote request lead to Pipedrive
 */
export async function syncQuoteLeadToPipedrive(input: {
  name: string;
  email: string;
  company?: string;
  phone?: string;
  gpuType: string;
  gpuCount: number;
  location?: string;
  commitmentMonths?: number;
  budget?: string;
  requirements?: string;
}): Promise<PipedriveResponse> {
  const {
    name,
    email,
    company,
    phone,
    gpuType,
    gpuCount,
    location,
    commitmentMonths,
    budget,
    requirements,
  } = input;

  // Determine if this is a cluster or GPU lead
  // Cluster: 8+ GPUs, or specific enterprise GPU types, or explicit cluster mention
  const isCluster =
    gpuCount >= 8 ||
    gpuType.toLowerCase().includes("cluster") ||
    gpuType.toLowerCase().includes("h100") ||
    gpuType.toLowerCase().includes("h200") ||
    gpuType.toLowerCase().includes("b200");

  const leadType: LeadType = isCluster ? "cluster" : "gpu";

  // Build notes with quote details
  const noteLines = [
    `📋 Quote Request`,
    ``,
    `GPU Type: ${gpuType}`,
    `GPU Count: ${gpuCount}`,
  ];

  if (location) noteLines.push(`Location: ${location}`);
  if (commitmentMonths) noteLines.push(`Commitment: ${commitmentMonths} months`);
  if (budget) noteLines.push(`Budget: ${budget}`);
  if (requirements) {
    noteLines.push(``);
    noteLines.push(`Requirements:`);
    noteLines.push(requirements);
  }

  return syncPersonToPipedrive({
    name,
    email,
    phone,
    company,
    contactType: "lead",
    leadType,
    notes: noteLines.join("\n"),
  });
}

/**
 * Sync a contact form lead to Pipedrive
 */
export async function syncContactLeadToPipedrive(input: {
  name: string;
  email: string;
  company?: string;
  message: string;
}): Promise<PipedriveResponse> {
  const { name, email, company, message } = input;

  // Determine lead type from message content
  const messageLC = message.toLowerCase();
  const isCluster =
    messageLC.includes("cluster") ||
    messageLC.includes("multi-node") ||
    messageLC.includes("h100") ||
    messageLC.includes("h200") ||
    messageLC.includes("b200") ||
    messageLC.includes("enterprise");

  const leadType: LeadType = isCluster ? "cluster" : "gpu";

  return syncPersonToPipedrive({
    name,
    email,
    company,
    contactType: "lead",
    leadType,
    notes: `📧 Contact Form Message:\n\n${message}`,
  });
}

/**
 * Sync a waitlist signup to Pipedrive
 */
export async function syncWaitlistToPipedrive(input: {
  email: string;
}): Promise<PipedriveResponse> {
  const { email } = input;

  // Use email prefix as name if we don't have a real name
  const emailPrefix = email.split("@")[0];
  const name = emailPrefix.charAt(0).toUpperCase() + emailPrefix.slice(1);

  return syncPersonToPipedrive({
    name,
    email,
    contactType: "lead",
    leadType: "gpu",
    notes: `📋 Waitlist Signup\n\nSigned up for GPU Cloud B200 GPU waitlist.`,
  });
}

/**
 * Sync a new customer to Pipedrive
 */
export async function syncCustomerToPipedrive(input: {
  name: string;
  email: string;
  company?: string;
  productName: string;
  billingType: string;
  stripeCustomerId: string;
}): Promise<PipedriveResponse> {
  const { name, email, company, productName, billingType, stripeCustomerId } = input;

  // Determine if this is a cluster or GPU customer based on product
  const productLC = productName.toLowerCase();
  const isCluster =
    productLC.includes("cluster") ||
    productLC.includes("enterprise") ||
    productLC.includes("h100") ||
    productLC.includes("h200") ||
    productLC.includes("b200");

  const leadType: LeadType = isCluster ? "cluster" : "gpu";

  const noteLines = [
    `✅ New Customer`,
    ``,
    `Product: ${productName}`,
    `Billing: ${billingType}`,
    `Stripe ID: ${stripeCustomerId}`,
  ];

  return syncPersonToPipedrive({
    name,
    email,
    company,
    contactType: "customer",
    leadType,
    notes: noteLines.join("\n"),
  });
}
