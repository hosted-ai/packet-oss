import Conf from "conf";

interface ConfigSchema {
  apiKey?: string;
  apiUrl: string;
}

export const config = new Conf<ConfigSchema>({
  projectName: "gpu-cloud-cli",
  defaults: {
    apiUrl: process.env.GPU_CLOUD_API_URL || process.env.PACKET_API_URL || "http://localhost:3000",
  },
});

export function getApiKey(): string | undefined {
  return config.get("apiKey");
}

export function setApiKey(key: string): void {
  config.set("apiKey", key);
}

export function clearApiKey(): void {
  config.delete("apiKey");
}

export function getApiUrl(): string {
  return config.get("apiUrl");
}

export function setApiUrl(url: string): void {
  config.set("apiUrl", url);
}
