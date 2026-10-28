/**
 * Mattermost incoming-webhook poster.
 *
 * A Mattermost "incoming webhook" is a per-channel URL that accepts a JSON body
 * and posts it as a message. Create one in Mattermost:
 *   Main Menu → Integrations → Incoming Webhooks → Add (lock it to the channel),
 *   then copy the URL.
 *
 * The URL is stored as an ENCRYPTED SystemSetting (MATTERMOST_OPS_WEBHOOK_URL).
 * It is a secret (anyone with it can post to the channel) — never log it, never
 * echo it back in an API response.
 */

import { getSetting } from "@/lib/settings";

/** SystemSetting / env key holding the ops-channel incoming webhook URL (encrypted). */
export const MATTERMOST_OPS_WEBHOOK_KEY = "MATTERMOST_OPS_WEBHOOK_URL";

export interface MattermostMessage {
  /** Body — Mattermost renders GitHub-flavoured markdown (tables OK). */
  text: string;
  /** Override the bot display name. */
  username?: string;
  /** Emoji shortcode for the avatar, e.g. ":bar_chart:". */
  iconEmoji?: string;
}

/** Resolve the configured ops-channel webhook URL (SystemSetting → env). */
export async function getOpsWebhookUrl(): Promise<string | null> {
  return getSetting(MATTERMOST_OPS_WEBHOOK_KEY);
}

/**
 * POST a message to a Mattermost incoming webhook. Throws on a non-2xx response
 * so callers can alert the failure. Does not retry. The error message never
 * includes the webhook URL.
 */
export async function postToMattermost(
  webhookUrl: string,
  msg: MattermostMessage,
): Promise<void> {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: msg.text,
      username: msg.username,
      icon_emoji: msg.iconEmoji,
    }),
    // A hung webhook shouldn't hang the daily job.
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Mattermost webhook returned ${res.status}: ${body.slice(0, 200)}`);
  }
}
