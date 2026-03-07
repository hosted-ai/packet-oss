/**
 * SSH Parameter Validation
 *
 * Prevents command injection in SSH operations by validating
 * hostnames, usernames, and ports before use in spawn() calls.
 */

/**
 * Validate SSH hostname/IP address
 * Allows: alphanumeric, dots, hyphens, colons (IPv6), brackets (IPv6)
 */
export function isValidSSHHost(host: string): boolean {
  if (!host || typeof host !== "string") return false;
  // Allow hostnames, IPv4, and IPv6 addresses
  // Hostname: alphanumeric, dots, hyphens (max 253 chars)
  // IPv4: digits and dots
  // IPv6: hex digits, colons, brackets
  const hostPattern = /^[a-zA-Z0-9.\-:\[\]]+$/;
  return host.length <= 253 && hostPattern.test(host);
}

/**
 * Validate SSH username
 * Allows: alphanumeric, underscores, hyphens (standard Unix usernames)
 */
export function isValidSSHUsername(username: string): boolean {
  if (!username || typeof username !== "string") return false;
  // Unix username: starts with letter or underscore, alphanumeric + underscore + hyphen
  const usernamePattern = /^[a-zA-Z_][a-zA-Z0-9_\-]*$/;
  return username.length <= 32 && usernamePattern.test(username);
}

/**
 * Validate SSH port
 */
export function isValidSSHPort(port: number | string): boolean {
  const portNum = typeof port === "string" ? parseInt(port, 10) : port;
  return Number.isInteger(portNum) && portNum >= 1 && portNum <= 65535;
}

/**
 * Validate all SSH connection parameters at once
 * Throws descriptive error if validation fails
 */
export function validateSSHParams(params: {
  host: string;
  port: number | string;
  username: string;
}): void {
  const { host, port, username } = params;

  if (!isValidSSHHost(host)) {
    throw new Error(`Invalid SSH host: ${host.substring(0, 50)}`);
  }

  if (!isValidSSHPort(port)) {
    throw new Error(`Invalid SSH port: ${port}`);
  }

  if (!isValidSSHUsername(username)) {
    throw new Error(`Invalid SSH username: ${username.substring(0, 50)}`);
  }
}

/**
 * Escape shell special characters in commands
 * Used for remote commands executed via SSH
 */
export function escapeShellArg(arg: string): string {
  // Replace single quotes with escaped version
  return `'${arg.replace(/'/g, "'\\''")}'`;
}
