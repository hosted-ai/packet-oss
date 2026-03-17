/**
 * Team management functions for hosted.ai
 */

import crypto from "crypto";
import { hostedaiRequest, getApiUrl } from "./client";
import type { Team, CreateTeamParams, OTLResponse } from "./types";

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

  const postData = {
    color: params.color || "#6366F1", // Must be UPPERCASE hex
    description: params.description || "",
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

// Get team details
export async function getTeam(teamId: string): Promise<Team> {
  return hostedaiRequest<Team>("GET", `/team/${teamId}`);
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
  await hostedaiRequest("PUT", `/team/${teamId}`, policies);
}
