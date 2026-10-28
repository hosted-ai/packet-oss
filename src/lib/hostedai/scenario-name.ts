// HAI only accepts scenario names matching ^[A-Za-z0-9 _-]+$ with no leading
// space (hostedai-user ScenarioNameRegex); anything else fails the create.
// Idempotent, so a caller can build the same string for a lookup-by-name.
export function scenarioName(name: string): string {
  return name.replace(/[^A-Za-z0-9 _-]/g, "-").trim();
}
