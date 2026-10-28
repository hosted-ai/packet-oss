/**
 * Team management functions for hosted.ai
 */

import crypto from "crypto";
import { hostedaiRequest, getApiUrl } from "./client";
import { getDefaultBaremetalPolicies } from "./default-policies";
import type {
  Team,
  CreateTeamParams,
  OTLResponse,
  TeamMembersResponse,
  TeamMemberRow,
} from "./types";

/**
 * Sanitize a name for hosted.ai API
 * Removes special characters like +, ., etc. that hosted.ai doesn't accept
 */
function sanitizeName(name: string): string {
  // Remove all characters except alphanumeric, hyphen, and space
  const sanitized = name.replace(/[^a-zA-Z0-9 -]/g, "").trim();
  return sanitized || "User";
}

/**
 * Generate a secure random password meeting hosted.ai requirements.
 * Requirements: uppercase, lowercase, digit, special character (#), min 12 chars
 */
function generateSecurePassword(): string {
  const length = 16;
  const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const lower = "abcdefghijklmnopqrstuvwxyz";
  const digits = "0123456789";
  const special = "#$@!%*?&";
  const all = upper + lower + digits + special;

  // Ensure at least one of each required character type
  let password = "";
  password += upper[crypto.randomInt(upper.length)];
  password += lower[crypto.randomInt(lower.length)];
  password += digits[crypto.randomInt(digits.length)];
  password += special[crypto.randomInt(special.length)];

  // Fill the rest with random characters
  for (let i = password.length; i < length; i++) {
    password += all[crypto.randomInt(all.length)];
  }

  // Shuffle the password
  return password
    .split("")
    .sort(() => crypto.randomInt(3) - 1)
    .join("");
}

// Create a team with policies - matches WHMCS module approach
export async function createTeam(params: CreateTeamParams): Promise<Team> {
  // Sanitize team name to remove special characters that hosted.ai doesn't accept
  const sanitizedTeamName = sanitizeName(params.name);

  // PA-353: ariel does NO server-side policy defaulting — assignPolicySetToTeam
  // only runs for natures the client flags and requires all 5 IDs — so a
  // general-only body leaves the team with zero baremetal policies (no default
  // baremetal resource policy). Fetch the baremetal defaults and send them too.
  // Best-effort: if they can't be fetched, create the team general-only rather
  // than failing signup/checkout/webhook team creation.
  const baremetalDefaults = await getDefaultBaremetalPolicies();
  if (!baremetalDefaults) {
    console.error(
      "[HAI.createTeam] baremetal default policies unavailable — creating team without a baremetal policy set (PA-353)"
    );
  }

  const postData = {
    color: params.color || "#6366F1", // Must be UPPERCASE hex
    description: params.description || "",
    // Titan: flat top-level policy keys
    image_policy_id: params.image_policy_id,
    instance_type_policy_id: params.instance_type_policy_id,
    members: params.members.map((m) => ({
      email: m.email,
      // Sanitize member name to remove special characters (e.g., + from email aliases)
      name: sanitizeName(m.name || m.email.split("@")[0]),
      role: m.role, // API uses 'role' field (not 'role_id')
      send_email_invite: m.send_email_invite ?? false, // Default to no invite email
      ...(m.password && { password: m.password }), // Include password if provided
      ...(m.pre_onboard !== undefined && { pre_onboard: m.pre_onboard }), // Include pre_onboard if provided
    })),
    name: sanitizedTeamName,
    pricing_policy_id: params.pricing_policy_id,
    resource_policy_id: params.resource_policy_id,
    service_policy_id: params.service_policy_id,
    // Ariel: the same policy IDs nested under `general`, gated by
    // has_general_policies. Ariel removed the flat top-level keys above and
    // hard-rejects team creation unless one of has_general/baremetal_policies
    // is set. Titan ignores these unknown fields (plain json.Decode), so this
    // body is compatible with both backends — see HAI Ariel compat sweep.
    has_general_policies: true,
    general: {
      resource_policy_id: params.resource_policy_id,
      service_policy_id: params.service_policy_id,
      pricing_policy_id: params.pricing_policy_id,
      image_policy_id: params.image_policy_id,
      instance_type_policy_id: params.instance_type_policy_id,
    },
    // PA-353: default baremetal policy set, gated by has_baremetal_policies.
    // Titan ignores these unknown fields, same as the general block above.
    ...(baremetalDefaults && {
      has_baremetal_policies: true,
      baremetal: {
        resource_policy_id: baremetalDefaults.resource,
        service_policy_id: baremetalDefaults.service,
        pricing_policy_id: baremetalDefaults.pricing,
        image_policy_id: baremetalDefaults.image,
        instance_type_policy_id: baremetalDefaults.instanceType,
      },
    }),
  };

  return hostedaiRequest<Team>("POST", "/team", postData);
}

// Onboard a user with name and password (public endpoint)
// This sets up the user so they don't need to complete the onboarding form
export async function onboardUser(params: {
  email: string;
  name: string;
  password: string;
}): Promise<{ success: boolean }> {
  const url = `${await getApiUrl()}/api/onboard`;

  console.log("Onboarding user:", params.email, "with name:", params.name);
  console.log("Password details - length:", params.password.length,
    "hasUpper:", /[A-Z]/.test(params.password),
    "hasLower:", /[a-z]/.test(params.password),
    "hasDigit:", /[0-9]/.test(params.password),
    "hasSpecial:", /#/.test(params.password));

  try {
    const requestBody = {
      email: params.email,
      name: params.name,
      password: params.password,
    };
    console.log("Onboard request body:", JSON.stringify({ ...requestBody, password: "***" }));

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    const text = await response.text();
    console.log("Onboard API response status:", response.status, "body:", text);

    if (!response.ok) {
      // If user already onboarded, that's fine - continue
      if (text.includes("already") || response.status === 409) {
        console.log("User already onboarded, continuing...");
        return { success: true };
      }
      throw new Error(`Onboard API error: ${response.status} - ${text}`);
    }

    return { success: true };
  } catch (error) {
    console.error("Failed to onboard user:", error);
    // Don't fail the whole flow if onboarding fails - user can still complete it manually
    return { success: false };
  }
}

// Create one-time login token for dashboard access
export async function createOneTimeLogin(params: {
  email: string;
  send_email_invite?: boolean;
  teamId?: string;
  roleId?: string;
  userName?: string;
  password?: string;
}): Promise<OTLResponse> {
  const requestData: Record<string, unknown> = {
    email: params.email,
    send_email_invite: params.send_email_invite ?? false,
  };

  // Add team and role if provided
  if (params.teamId) {
    requestData.team_id = params.teamId;
  }
  if (params.roleId) {
    requestData.role_id = params.roleId;
  }

  // Always include user_details with pre_onboard: true and onboard_config
  // The hosted.ai API requires this for generating OTL links for new or existing users
  // Without user_details, the API returns: "user details are required / invalid to generate OTL link"
  requestData.user_details = {
    pre_onboard: true,
    onboard_config: {
      // Sanitize name to remove special characters (e.g., + from email aliases)
      name: sanitizeName(params.userName || params.email.split("@")[0]),
      password: params.password || process.env.DEFAULT_USER_PASSWORD || generateSecurePassword(),
    },
  };

  console.log("Creating OTL with data:", JSON.stringify(requestData, null, 2));

  return hostedaiRequest<OTLResponse>("POST", "/create-otl", requestData);
}

// Suspend team (on payment failure)
export async function suspendTeam(teamId: string): Promise<void> {
  await hostedaiRequest("POST", `/team/${teamId}/suspend`);
}

// Unsuspend team (on payment success)
export async function unsuspendTeam(teamId: string): Promise<void> {
  await hostedaiRequest("POST", `/team/${teamId}/unsuspend`);
}

// Terminate/delete team (on subscription cancellation)
export async function terminateTeam(teamId: string): Promise<void> {
  await hostedaiRequest("DELETE", `/team/${teamId}`);
}

// Get team details. Ariel's GET /team/{id} wraps the team in a
// GetTeamResponse ({ team, members_count, ... }); Titan returned it flat.
// Unwrap so callers always get the team object (name, policy_info, ...).
export async function getTeam(teamId: string): Promise<Team> {
  const res = await hostedaiRequest<Team | { team: Team }>(
    "GET",
    `/team/${teamId}`
  );
  return (res as { team?: Team })?.team ?? (res as Team);
}

// List HAI team members. `search` narrows server-side (HAI matches against
// email + name). Page size defaults to 200 to comfortably cover almost
// all unsearched lists in a single request.
export async function listTeamMembers(
  teamId: string,
  opts: { page?: number; itemsPerPage?: number; search?: string } = {},
): Promise<TeamMembersResponse> {
  const page = opts.page ?? 0;
  const itemsPerPage = opts.itemsPerPage ?? 200;
  const qs = new URLSearchParams({
    page: String(page),
    itemsPerPage: String(itemsPerPage),
  });
  if (opts.search) qs.set("search", opts.search);
  return hostedaiRequest<TeamMembersResponse>(
    "GET",
    `/team/${teamId}/members?${qs.toString()}`,
  );
}

// Find a team member by email (case-insensitive). Resolves the HAI
// user_id we need for the role-change / status endpoints. Uses HAI's
// server-side ?search= for cheap targeted lookup; we still filter results
// client-side for an exact email match in case search is fuzzy.
export async function findTeamMemberByEmail(
  teamId: string,
  email: string,
): Promise<TeamMemberRow | null> {
  const target = email.toLowerCase();
  const res = await listTeamMembers(teamId, {
    itemsPerPage: 50,
    search: email,
  });
  // HAI returns null (or omits) `members` when the team has zero rows;
  // normalize to [] so callers can iterate without a guard.
  const members = Array.isArray(res?.members) ? res.members : [];
  for (const m of members) {
    if (m.user?.email?.toLowerCase() === target) return m;
  }
  return null;
}

// PA-175 — change a member's HAI role. Resolves the HAI user_id from
// PA-175 — invite a user to a HAI team with a specific role. This is the
// primitive HAI's own panel uses; it lands the user with the correct role
// directly (unlike /create-otl, which always assigns team_admin regardless
// of role_id). Resulting member status is "invited"; activation happens
// either via a follow-up /create-otl or first user action on HAI.
export async function inviteToTeam(params: {
  teamId: string;
  email: string;
  roleId: string;
}): Promise<void> {
  // HAI expects an array of invites; cast via unknown because hostedaiRequest
  // is typed for object bodies but the underlying fetch handles arrays.
  const body = [{ email: params.email, role: params.roleId }] as unknown as Record<string, unknown>;
  await hostedaiRequest("POST", `/team/${params.teamId}/invite`, body);
}

// email, then POSTs to /team/{teamId}/member/{user_id}/role. Throws if
// the member can't be found (caller should treat that as out-of-sync state
// between Packet and HAI and decide whether to roll back).
export async function changeUserRole(params: {
  teamId: string;
  email: string;
  roleId: string;
}): Promise<{ success: boolean }> {
  const member = await findTeamMemberByEmail(params.teamId, params.email);
  if (!member) {
    throw new Error(
      `HAI member not found: email=${params.email} team=${params.teamId}`,
    );
  }
  await hostedaiRequest(
    "POST",
    `/team/${params.teamId}/member/${member.user_id}/role`,
    { role_id: params.roleId },
  );
  return { success: true };
}

// PA-175 — flip a member's status on a HAI team. The /status endpoint is
// what HAI's own panel calls; "removed" deletes them, "active" promotes an
// "invited" member to active. Resolves the HAI user_id via email search,
// then POSTs /team/{teamId}/member/{user_id}/status.
export async function setMemberStatus(params: {
  teamId: string;
  email: string;
  status: "active" | "removed";
}): Promise<{ success: boolean }> {
  const member = await findTeamMemberByEmail(params.teamId, params.email);
  if (!member) {
    // Idempotent for removed; for active, treat as failure since we need
    // to flip an existing row.
    if (params.status === "removed") return { success: true };
    throw new Error(
      `HAI member not found for status change: email=${params.email} team=${params.teamId}`,
    );
  }
  await hostedaiRequest(
    "POST",
    `/team/${params.teamId}/member/${member.user_id}/status`,
    { status: params.status },
  );
  return { success: true };
}

// PA-175 — remove (status='removed') a member from a HAI team. Idempotent:
// if the user isn't on the team in HAI, we treat as success rather than
// erroring (Packet-side revoke is also idempotent).
export async function removeUserFromTeam(params: {
  teamId: string;
  email: string;
}): Promise<{ success: boolean }> {
  const member = await findTeamMemberByEmail(params.teamId, params.email);
  if (!member) {
    console.warn(
      `[HAI.removeUserFromTeam] ${params.email} not on team ${params.teamId} — treating as already removed.`,
    );
    return { success: true };
  }
  await hostedaiRequest(
    "POST",
    `/team/${params.teamId}/member/${member.user_id}/status`,
    { status: "removed" },
  );
  return { success: true };
}

// Change team package (upgrade/downgrade)
export async function changeTeamPackage(
  teamId: string,
  policies: {
    pricing_policy_id: string;
    resource_policy_id: string;
    service_policy_id: string;
    instance_type_policy_id: string;
    image_policy_id: string;
  }
): Promise<void> {
  // Ariel's PUT /team/{id} (a) hard-requires a non-empty, regex-valid `name`
  // and (b) reads policy IDs from a nested `general` object — it removed the
  // flat top-level policy keys that Titan uses. Round-trip the current team
  // name (read-modify-write) so the package change doesn't blank/rename the
  // team, and send BOTH shapes: Titan reads the flat keys and ignores the
  // nested ones, Ariel reads the nested ones and ignores the flat keys (both
  // use plain json.Decode). Compatible with Titan today and Ariel post-upgrade.
  let currentTeam: Team | undefined;
  try {
    currentTeam = await getTeam(teamId);
  } catch (err) {
    console.warn(
      `[HAI.changeTeamPackage] could not read current team ${teamId} (Ariel requires name + baremetal round-trip):`,
      err,
    );
  }
  const currentName = currentTeam?.name;

  // PA-353: Ariel's PUT /team/{id} hard-rejects (400 ERR_TEAM_HAS_BAREMETAL_
  // POLICIES) a body with has_baremetal_policies=false while the team has
  // baremetal policies assigned — so omitting the block breaks package changes
  // for every team with a baremetal policy set. Round-trip the team's current
  // baremetal IDs, filling gaps from the defaults (the ops cron may have
  // assigned only the resource policy). HAI requires the full 5-ID set, so
  // only include the block when all 5 resolve; teams with none get the
  // defaults assigned, healing PA-353 for existing teams on package change.
  const pi = currentTeam?.policy_info;
  const bmDefaults = await getDefaultBaremetalPolicies();
  const baremetal = {
    resource_policy_id: pi?.baremetal_resource_policy?.id ?? bmDefaults?.resource,
    service_policy_id: pi?.baremetal_service_policy?.id ?? bmDefaults?.service,
    pricing_policy_id: pi?.baremetal_pricing_policy?.id ?? bmDefaults?.pricing,
    image_policy_id: pi?.baremetal_image_policy?.id ?? bmDefaults?.image,
    instance_type_policy_id:
      pi?.baremetal_instance_type_policy?.id ?? bmDefaults?.instanceType,
  };
  const baremetalComplete = Object.values(baremetal).every(Boolean);
  if (!baremetalComplete) {
    console.error(
      `[HAI.changeTeamPackage] incomplete baremetal policy set for team ${teamId} and defaults unavailable — omitting baremetal block (PA-353; Ariel will 400 if the team has baremetal policies)`
    );
  }

  const body = {
    ...policies, // Titan: flat top-level policy keys
    ...(currentName ? { name: currentName } : {}), // Ariel: required, round-tripped to avoid rename
    has_general_policies: true, // Ariel: gate flag enabling the nested policy set
    general: {
      // Ariel: same policy IDs nested under `general`
      pricing_policy_id: policies.pricing_policy_id,
      resource_policy_id: policies.resource_policy_id,
      service_policy_id: policies.service_policy_id,
      instance_type_policy_id: policies.instance_type_policy_id,
      image_policy_id: policies.image_policy_id,
    },
    ...(baremetalComplete && {
      has_baremetal_policies: true,
      baremetal,
    }),
  };

  await hostedaiRequest("PUT", `/team/${teamId}`, body);
}
