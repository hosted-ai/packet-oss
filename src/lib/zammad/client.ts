/**
 * Zammad API Client
 *
 * Handles all communication with the Zammad ticketing system.
 * API endpoint and token configured via environment variables.
 */

import type {
  ZammadOrganization,
  CreateOrganizationInput,
  ZammadUser,
  CreateUserInput,
  ZammadTicket,
  CreateTicketInput,
  ZammadArticle,
  CreateArticleInput,
  ZammadGroup,
  ZammadTicketState,
} from "./types";

// Configuration from environment
function getConfig() {
  const apiUrl = process.env.ZAMMAD_API_URL;
  const apiToken = process.env.ZAMMAD_API_TOKEN;

  if (!apiUrl) {
    throw new Error("ZAMMAD_API_URL environment variable is required");
  }
  if (!apiToken) {
    throw new Error("ZAMMAD_API_TOKEN environment variable is required");
  }

  return { apiUrl: apiUrl.replace(/\/$/, ""), apiToken };
}

// Common fetch helper
async function zammadFetch<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const { apiUrl, apiToken } = getConfig();
  const url = `${apiUrl}${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Token token=${apiToken}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`Zammad API error [${response.status}]:`, errorText);
    throw new Error(
      `Zammad API error: ${response.status} ${response.statusText} - ${errorText}`
    );
  }

  // Some endpoints return empty body (204)
  const text = await response.text();
  if (!text) {
    return {} as T;
  }

  return JSON.parse(text) as T;
}

// ============================================================================
// Organizations
// ============================================================================

/**
 * Get all organizations
 */
export async function getOrganizations(): Promise<ZammadOrganization[]> {
  return zammadFetch<ZammadOrganization[]>("/api/v1/organizations");
}

/**
 * Get organization by ID
 */
export async function getOrganization(id: number): Promise<ZammadOrganization> {
  return zammadFetch<ZammadOrganization>(`/api/v1/organizations/${id}`);
}

/**
 * Search organizations by name or other criteria
 */
export async function searchOrganizations(
  query: string
): Promise<ZammadOrganization[]> {
  return zammadFetch<ZammadOrganization[]>(
    `/api/v1/organizations/search?query=${encodeURIComponent(query)}`
  );
}

/**
 * Create a new organization
 * We add the custom 'brand' attribute
 */
export async function createOrganization(
  input: CreateOrganizationInput
): Promise<ZammadOrganization> {
  return zammadFetch<ZammadOrganization>("/api/v1/organizations", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/**
 * Update an organization
 */
export async function updateOrganization(
  id: number,
  input: Partial<CreateOrganizationInput>
): Promise<ZammadOrganization> {
  return zammadFetch<ZammadOrganization>(`/api/v1/organizations/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

// ============================================================================
// Users
// ============================================================================

/**
 * Get all users
 */
export async function getUsers(): Promise<ZammadUser[]> {
  return zammadFetch<ZammadUser[]>("/api/v1/users");
}

/**
 * Get user by ID
 */
export async function getUser(id: number): Promise<ZammadUser> {
  return zammadFetch<ZammadUser>(`/api/v1/users/${id}`);
}

/**
 * Search users by email or other criteria
 */
export async function searchUsers(query: string): Promise<ZammadUser[]> {
  return zammadFetch<ZammadUser[]>(
    `/api/v1/users/search?query=${encodeURIComponent(query)}`
  );
}

/**
 * Find user by exact email match
 */
export async function findUserByEmail(
  email: string
): Promise<ZammadUser | null> {
  const users = await searchUsers(email);
  return users.find((u) => u.email.toLowerCase() === email.toLowerCase()) || null;
}

/**
 * Create a new user
 */
export async function createUser(input: CreateUserInput): Promise<ZammadUser> {
  return zammadFetch<ZammadUser>("/api/v1/users", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/**
 * Update a user
 */
export async function updateUser(
  id: number,
  input: Partial<CreateUserInput>
): Promise<ZammadUser> {
  return zammadFetch<ZammadUser>(`/api/v1/users/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

// ============================================================================
// Groups
// ============================================================================

/**
 * Get all groups
 */
export async function getGroups(): Promise<ZammadGroup[]> {
  return zammadFetch<ZammadGroup[]>("/api/v1/groups");
}

/**
 * Get group by ID
 */
export async function getGroup(id: number): Promise<ZammadGroup> {
  return zammadFetch<ZammadGroup>(`/api/v1/groups/${id}`);
}

/**
 * Find group by name
 */
export async function findGroupByName(
  name: string
): Promise<ZammadGroup | null> {
  const groups = await getGroups();
  return groups.find((g) => g.name === name) || null;
}

// ============================================================================
// Ticket States
// ============================================================================

/**
 * Get all ticket states
 */
export async function getTicketStates(): Promise<ZammadTicketState[]> {
  return zammadFetch<ZammadTicketState[]>("/api/v1/ticket_states");
}

/**
 * Find state by name
 */
export async function findStateByName(
  name: string
): Promise<ZammadTicketState | null> {
  const states = await getTicketStates();
  return (
    states.find((s) => s.name.toLowerCase() === name.toLowerCase()) || null
  );
}

// ============================================================================
// Tickets
// ============================================================================

/**
 * Get all tickets (paginated)
 */
export async function getTickets(
  page: number = 1,
  perPage: number = 100
): Promise<ZammadTicket[]> {
  return zammadFetch<ZammadTicket[]>(
    `/api/v1/tickets?page=${page}&per_page=${perPage}`
  );
}

/**
 * Get ticket by ID
 */
export async function getTicket(id: number): Promise<ZammadTicket> {
  return zammadFetch<ZammadTicket>(`/api/v1/tickets/${id}`);
}

/**
 * Search tickets
 */
export async function searchTickets(query: string): Promise<ZammadTicket[]> {
  return zammadFetch<ZammadTicket[]>(
    `/api/v1/tickets/search?query=${encodeURIComponent(query)}`
  );
}

/**
 * Search tickets with pagination — fetches ALL matching results across pages
 */
export async function searchAllTickets(query: string): Promise<ZammadTicket[]> {
  const perPage = 200;
  const allTickets: ZammadTicket[] = [];
  let page = 1;

  while (true) {
    const batch = await zammadFetch<ZammadTicket[]>(
      `/api/v1/tickets/search?query=${encodeURIComponent(query)}&page=${page}&per_page=${perPage}`
    );
    allTickets.push(...batch);
    if (batch.length < perPage) break;
    page++;
  }

  return allTickets;
}

/**
 * Get tickets by customer ID
 * Only returns tickets from platform support groups
 */
export async function getTicketsByCustomer(
  customerId: number
): Promise<ZammadTicket[]> {
  const [tickets, groupIds] = await Promise.all([
    searchTickets(`customer_id:${customerId}`),
    getPacketGroupIds(),
  ]);
  return filterPacketTickets(tickets, groupIds);
}

/**
 * Create a new ticket with article
 */
export async function createTicket(
  input: CreateTicketInput
): Promise<ZammadTicket> {
  return zammadFetch<ZammadTicket>("/api/v1/tickets", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/**
 * Update a ticket
 */
export async function updateTicket(
  id: number,
  input: Partial<Omit<CreateTicketInput, "article">>
): Promise<ZammadTicket> {
  return zammadFetch<ZammadTicket>(`/api/v1/tickets/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

// ============================================================================
// Articles (Messages)
// ============================================================================

/**
 * Get articles for a ticket
 */
export async function getTicketArticles(
  ticketId: number
): Promise<ZammadArticle[]> {
  return zammadFetch<ZammadArticle[]>(
    `/api/v1/ticket_articles/by_ticket/${ticketId}`
  );
}

/**
 * Create an article (reply) for a ticket
 */
export async function createArticle(
  input: CreateArticleInput
): Promise<ZammadArticle> {
  return zammadFetch<ZammadArticle>("/api/v1/ticket_articles", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

// ============================================================================
// High-level platform helpers
// ============================================================================

// The group to create tickets in
const PACKET_SUPPORT_GROUP = process.env.ZAMMAD_SUPPORT_GROUP || "Support::L1 - packet.ai";

// All support groups we should show tickets from
const PACKET_GROUP_NAMES = (process.env.ZAMMAD_GROUP_NAMES || "Support::L1 - packet.ai,Support::Escalated - packet.ai").split(",").map(s => s.trim());

// Cached group IDs for support groups
let packetGroupIds: number[] | null = null;

/**
 * Get the Zammad group IDs for support groups.
 * Results are cached for the lifetime of the process, but only if non-empty.
 * Empty results are NOT cached — this prevents permanent breakage if
 * the Zammad API is temporarily unreachable during process startup.
 */
async function getPacketGroupIds(): Promise<number[]> {
  if (packetGroupIds && packetGroupIds.length > 0) return packetGroupIds;

  const allGroups = await getGroups();
  const ids = allGroups
    .filter((g) => PACKET_GROUP_NAMES.some((name) => g.name === name))
    .map((g) => g.id);

  if (ids.length === 0) {
    console.warn("[Zammad] No support groups found! Expected:", PACKET_GROUP_NAMES);
    return ids; // Don't cache — retry next time
  }

  packetGroupIds = ids;
  console.log("[Zammad] Support group IDs:", packetGroupIds);
  return packetGroupIds;
}

/**
 * Filter tickets to only those in support groups
 */
function filterPacketTickets(tickets: ZammadTicket[], groupIds: number[]): ZammadTicket[] {
  return tickets.filter((t) => groupIds.includes(t.group_id));
}

/**
 * Get or create a Zammad organization for a platform customer.
 * Organizations are created with brand='packet' custom attribute.
 */
export async function getOrCreatePacketOrganization(
  stripeCustomerId: string,
  customerName?: string
): Promise<ZammadOrganization> {
  // Search for existing org by Stripe customer ID in the name or domain
  const searchQuery = stripeCustomerId;
  const existing = await searchOrganizations(searchQuery);

  // Check if any org matches our stripe customer ID pattern
  const matchingOrg = existing.find(
    (org) =>
      org.name.includes(stripeCustomerId) ||
      org.domain.includes(stripeCustomerId)
  );

  if (matchingOrg) {
    return matchingOrg;
  }

  // Create new organization
  const orgName = customerName
    ? `${customerName} (${stripeCustomerId})`
    : `Customer ${stripeCustomerId}`;

  return createOrganization({
    name: orgName,
    shared: true,
    active: true,
    brand: process.env.ZAMMAD_BRAND || "packet",
    note: `Platform customer. Stripe ID: ${stripeCustomerId}`,
  });
}

/**
 * Get or create a Zammad user for a platform customer.
 * Users are associated with their organization.
 */
export async function getOrCreatePacketUser(
  email: string,
  organizationId: number,
  name?: string
): Promise<ZammadUser> {
  // Search for existing user by email
  const existingUser = await findUserByEmail(email);

  if (existingUser) {
    // Update organization if not set or different
    if (existingUser.organization_id !== organizationId) {
      return updateUser(existingUser.id, { organization_id: organizationId });
    }
    return existingUser;
  }

  // Parse name into first/last
  const nameParts = name?.split(" ") || email.split("@")[0].split(".");
  const firstname = nameParts[0] || email.split("@")[0];
  const lastname = nameParts.slice(1).join(" ") || "";

  // Create new user - role_ids: [3] is typically "Customer" role
  return createUser({
    email,
    firstname,
    lastname,
    organization_id: organizationId,
    active: true,
    verified: true,
    role_ids: [3], // Customer role
  });
}

// Zammad priority IDs
export const ZAMMAD_PRIORITIES = {
  low: 1,
  normal: 2,
  high: 3, // urgent
} as const;

// Zammad state IDs
export const ZAMMAD_STATES = {
  new: 1,
  open: 2,
  pending_reminder: 3,
  closed: 4,
  merged: 5,
  pending_close: 6,
} as const;

/**
 * Create a support ticket for a platform customer.
 * Tickets are created with type 'web' in the designated support group.
 */
export async function createPacketSupportTicket(params: {
  customerId: number;
  subject: string;
  message: string;
  priority?: "low" | "normal" | "high";
}): Promise<ZammadTicket> {
  const { customerId, subject, message, priority = "normal" } = params;

  return createTicket({
    title: subject,
    group: PACKET_SUPPORT_GROUP,
    customer_id: customerId,
    priority_id: ZAMMAD_PRIORITIES[priority],
    article: {
      subject,
      body: message,
      type: "web",
      sender: "Customer",
      internal: false,
    },
  });
}

/**
 * Close a ticket (mark as resolved)
 */
export async function closeTicket(ticketId: number): Promise<ZammadTicket> {
  return updateTicket(ticketId, {
    state_id: ZAMMAD_STATES.closed,
  } as unknown as Partial<Omit<CreateTicketInput, "article">>);
}

/**
 * Add a customer reply to a ticket
 */
export async function addCustomerReply(params: {
  ticketId: number;
  message: string;
}): Promise<ZammadArticle> {
  const { ticketId, message } = params;

  return createArticle({
    ticket_id: ticketId,
    body: message,
    type: "web",
    sender: "Customer",
    internal: false,
  });
}

/**
 * Add an agent (admin) reply to a ticket
 */
export async function addAgentReply(params: {
  ticketId: number;
  message: string;
  internal?: boolean;
}): Promise<ZammadArticle> {
  const { ticketId, message, internal = false } = params;

  return createArticle({
    ticket_id: ticketId,
    body: message,
    type: "note", // Agent notes
    sender: "Agent",
    internal,
  });
}

/**
 * Reopen a closed ticket
 */
export async function reopenTicket(ticketId: number): Promise<ZammadTicket> {
  return updateTicket(ticketId, {
    state_id: ZAMMAD_STATES.open,
  } as unknown as Partial<Omit<CreateTicketInput, "article">>);
}

/**
 * Get all tickets for admin view (with optional filters)
 * Only returns tickets from support groups
 */
export async function getAllTickets(params?: {
  state?: "open" | "closed" | "all";
  page?: number;
  perPage?: number;
}): Promise<ZammadTicket[]> {
  const { state = "all", page = 1, perPage = 100 } = params || {};
  const groupIds = await getPacketGroupIds();

  let tickets: ZammadTicket[];

  if (state === "open") {
    tickets = await searchAllTickets("state.name:open OR state.name:new OR state.name:pending*");
  } else if (state === "closed") {
    tickets = await searchAllTickets("state.name:closed OR state.name:merged");
  } else {
    // Fetch all pages
    const allTickets: ZammadTicket[] = [];
    let p = 1;
    while (true) {
      const batch = await getTickets(p, 200);
      allTickets.push(...batch);
      if (batch.length < 200) break;
      p++;
    }
    tickets = allTickets;
  }

  // Filter to only support groups
  const filtered = filterPacketTickets(tickets, groupIds);

  // Apply pagination
  const start = (page - 1) * perPage;
  return filtered.slice(start, start + perPage);
}

/**
 * Get the state name for a ticket state ID
 */
let statesCache: ZammadTicketState[] | null = null;
export async function getStateName(stateId: number): Promise<string> {
  if (!statesCache) {
    statesCache = await getTicketStates();
  }
  const state = statesCache.find((s) => s.id === stateId);
  return state?.name || "unknown";
}

/**
 * Check if a ticket is closed based on its state
 */
export async function isTicketClosed(ticket: ZammadTicket): Promise<boolean> {
  const stateName = await getStateName(ticket.state_id);
  return ["closed", "merged", "removed"].includes(stateName.toLowerCase());
}
