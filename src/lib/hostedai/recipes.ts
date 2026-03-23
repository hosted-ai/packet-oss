/**
 * HAI Recipe Management
 *
 * Handles recipe upload (TUS protocol) to HAI admin panel and
 * recipe listing via HAI user panel API.
 *
 * Upload flow:
 *   1. Login to HAI admin panel → get auth token
 *   2. Check for existing recipe by name → reuse if found (idempotent)
 *   3. tar.gz recipe directory → TUS upload → get recipe_id
 *
 * The HAI admin panel is separate from the user panel API.
 * Admin panel: TUS upload, template management
 * User panel: GET /service/recipes (listing), POST /service (creation)
 */

import { execSync } from "child_process";
import { existsSync, statSync, readFileSync, mkdirSync } from "fs";
import path from "path";
import { getSetting } from "@/lib/settings";
import { hostedaiRequest } from "./client";

// --- HAI Admin Panel Auth ---

interface AdminLoginResponse {
  token: string;
}

async function getAdminCredentials(): Promise<{ url: string; username: string; password: string }> {
  const url = await getSetting("HOSTEDAI_ADMIN_URL");
  const username = await getSetting("HOSTEDAI_ADMIN_USERNAME");
  const password = await getSetting("HOSTEDAI_ADMIN_PASSWORD");

  if (!url || !username || !password) {
    throw new Error(
      "HAI admin panel credentials not configured. Set HOSTEDAI_ADMIN_URL, HOSTEDAI_ADMIN_USERNAME, HOSTEDAI_ADMIN_PASSWORD in Platform Settings."
    );
  }

  return { url: url.replace(/\/+$/, ""), username, password };
}

async function loginToAdmin(creds: { url: string; username: string; password: string }): Promise<string> {
  const resp = await fetch(`${creds.url}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ username: creds.username, password: creds.password }),
  });

  if (!resp.ok) {
    throw new Error(`HAI admin login failed (${resp.status}): ${await resp.text()}`);
  }

  const data = (await resp.json()) as AdminLoginResponse;
  if (!data.token) {
    throw new Error("HAI admin login returned no token");
  }
  return data.token;
}

// --- Recipe Listing (User Panel API) ---

interface RecipeTemplate {
  id: number;
  name: string;
  version: string;
  description: string;
  category: string;
}

/**
 * List all recipes from HAI user panel API.
 * Uses the same API key as other hostedai calls.
 */
export async function listRecipes(): Promise<RecipeTemplate[]> {
  return hostedaiRequest<RecipeTemplate[]>("GET", "/service/recipes");
}

/**
 * Find an existing recipe by name (slug).
 * Returns recipe_id if found, null otherwise.
 */
export async function findRecipeByName(name: string): Promise<number | null> {
  try {
    const recipes = await listRecipes();
    const match = recipes.find((r) => r.name === name);
    return match ? match.id : null;
  } catch (error) {
    console.error("[Recipes] Failed to list recipes:", error);
    return null;
  }
}

// --- Recipe Compression ---

/**
 * Compress a recipe directory into a tar.gz archive.
 * Returns the path to the archive file.
 */
export function compressRecipe(slug: string): { archivePath: string; fileSize: number } {
  const repoRoot = process.cwd();
  const recipePath = path.join(repoRoot, "recipes", "packet_recipes", slug);
  const outputDir = path.join(repoRoot, "recipes", "builds");

  if (!existsSync(recipePath)) {
    throw new Error(`Recipe directory not found: recipes/packet_recipes/${slug}`);
  }

  mkdirSync(outputDir, { recursive: true });
  const archivePath = path.join(outputDir, `${slug}.tar.gz`);

  // Create temp dir, copy recipe, ensure infra JSON matches slug name
  const tmpDir = execSync("mktemp -d").toString().trim();
  try {
    execSync(`cp -R "${recipePath}" "${tmpDir}/${slug}"`);

    // Ensure infra JSON matches archive name (HAI requirement)
    const infraDir = path.join(tmpDir, slug, "infra");
    if (existsSync(infraDir)) {
      const jsonFiles = execSync(`find "${infraDir}" -maxdepth 1 -type f -name '*.json'`)
        .toString().trim().split("\n").filter(Boolean);
      const expectedJson = path.join(infraDir, `${slug}.json`);
      if (jsonFiles.length > 0 && jsonFiles[0] !== expectedJson) {
        execSync(`cp "${jsonFiles[0]}" "${expectedJson}"`);
      }
    }

    // Clean up artifacts
    execSync(`find "${tmpDir}/${slug}" -name '.DS_Store' -delete 2>/dev/null || true`);
    execSync(`find "${tmpDir}/${slug}" -name 'ansible.log' -exec truncate -s 0 {} \\; 2>/dev/null || true`);

    // Create archive
    execSync(`tar -czf "${archivePath}" -C "${tmpDir}" "${slug}"`);
  } finally {
    execSync(`rm -rf "${tmpDir}"`);
  }

  const fileSize = statSync(archivePath).size;
  console.log(`[Recipes] Compressed ${slug}: ${archivePath} (${fileSize} bytes)`);
  return { archivePath, fileSize };
}

// --- TUS Upload to HAI Admin Panel ---

/**
 * Upload a recipe archive to HAI admin panel via TUS protocol.
 * Returns the recipe_id.
 *
 * Flow:
 * 1. Login to admin panel
 * 2. Check for existing template → delete if found
 * 3. TUS POST (init) → get upload URL
 * 4. TUS PATCH (upload data)
 * 5. List recipes → find newly uploaded recipe_id
 */
export async function uploadRecipe(slug: string): Promise<number> {
  const creds = await getAdminCredentials();
  const token = await loginToAdmin(creds);

  // Compress recipe
  const { archivePath, fileSize } = compressRecipe(slug);

  // Check for existing template and delete if found
  const templatesResp = await fetch(`${creds.url}/api/recipes/templates`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (templatesResp.ok) {
    const templates = (await templatesResp.json()) as Array<{ id: number; name: string }>;
    const existing = templates.find((t) => t.name === slug);
    if (existing) {
      console.log(`[Recipes] Found existing template ${slug} (ID: ${existing.id}), deleting...`);
      const delResp = await fetch(`${creds.url}/api/recipes/templates/${existing.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      });
      if (!delResp.ok) {
        const errBody = await delResp.text();
        if (errBody.includes("FAILURE")) {
          throw new Error(`Cannot delete existing recipe "${slug}" — it may have associated pods. Remove them first.`);
        }
      }
      console.log(`[Recipes] Deleted existing template ${slug}`);
    }
  }

  // TUS upload: init
  const b64 = (s: string) => Buffer.from(s).toString("base64");
  const uploadMetadata = [
    `recipe_name ${b64(slug)}`,
    `version ${b64("latest")}`,
    `description ${b64(slug)}`,
    `category ${b64("gpuaas")}`,
    `hide ${b64("false")}`,
    `name ${b64(`${slug}.tar.gz`)}`,
    `filename ${b64(`${slug}.tar.gz`)}`,
    `filetype ${b64("application/x-gzip")}`,
    `type ${b64("application/x-gzip")}`,
  ].join(",");

  console.log(`[Recipes] TUS init: uploading ${fileSize} bytes...`);
  const initResp = await fetch(`${creds.url}/api/recipes/templates/upload/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Tus-Resumable": "1.0.0",
      "Upload-Length": String(fileSize),
      "Upload-Metadata": uploadMetadata,
    },
  });

  if (!initResp.ok && initResp.status !== 201) {
    throw new Error(`TUS init failed (${initResp.status}): ${await initResp.text()}`);
  }

  let location = initResp.headers.get("Location");
  if (!location) {
    throw new Error("TUS init did not return a Location header");
  }
  if (!location.startsWith("http")) {
    location = `${creds.url}${location}`;
  }

  // TUS upload: send data
  const fileData = readFileSync(archivePath);
  const patchResp = await fetch(location, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Tus-Resumable": "1.0.0",
      "Content-Type": "application/offset+octet-stream",
      "Upload-Offset": "0",
    },
    body: fileData,
  });

  if (!patchResp.ok && patchResp.status !== 204) {
    throw new Error(`TUS upload failed (${patchResp.status}): ${await patchResp.text()}`);
  }

  console.log(`[Recipes] Upload complete for ${slug}`);

  // Find the newly uploaded recipe ID from admin panel templates list
  // (user panel /service/recipes may lag behind the admin panel)
  const postUploadResp = await fetch(`${creds.url}/api/recipes/templates`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!postUploadResp.ok) {
    throw new Error(`Failed to list templates after upload (${postUploadResp.status})`);
  }
  const allTemplates = (await postUploadResp.json()) as Array<{ id: number; name: string }>;
  const uploaded = allTemplates.find((t) => t.name === slug);
  if (!uploaded) {
    throw new Error(`Recipe "${slug}" was uploaded but not found in admin templates list.`);
  }

  const recipeId = uploaded.id;
  console.log(`[Recipes] Recipe ${slug} uploaded, admin ID: ${recipeId}. Waiting for user panel sync...`);

  // Poll user panel until recipe is visible there (required for service creation)
  const MAX_POLL_ATTEMPTS = 10;
  const POLL_INTERVAL_MS = 2000;
  for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt++) {
    const found = await findRecipeByName(slug);
    if (found) {
      console.log(`[Recipes] Recipe ${slug} synced to user panel (attempt ${attempt})`);
      return recipeId;
    }
    console.log(`[Recipes] Waiting for user panel sync... (attempt ${attempt}/${MAX_POLL_ATTEMPTS})`);
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  // If it never synced, return the admin ID anyway — service creation may still work
  console.warn(`[Recipes] Recipe ${slug} not yet visible on user panel after ${MAX_POLL_ATTEMPTS} attempts. Proceeding with admin ID.`);
  return recipeId;
}

// --- Service Creation for Apps ---

interface CreateAppServiceOpts {
  slug: string;
  name: string;
  recipeId: number;
  ports: Array<{ service_name: string; port: number; protocol: string; service_type: string }>;
  scenarioId: string;
  execTiming: "on_every_boot" | "on_first_boot_only" | "manual";
}

/**
 * Create a HAI service for an app with recipe, ports, and scenario.
 * Returns the created service.
 */
export async function createAppService(opts: CreateAppServiceOpts): Promise<{ id: string; name: string }> {
  const serviceName = `packet-app-${opts.slug}`;

  const payload = {
    name: serviceName,
    description: `${opts.name} — managed by Packet`,
    additional_info: "",
    service_type: "pod_accelerator",
    recipe_id: opts.recipeId,
    recipe_exec_timing_type: opts.execTiming,
    is_chargeable: false,
    is_enabled: true,
    tags: [],
    scenarios: [opts.scenarioId],
    image: null,
    instance_config: {
      default_instance_type_id: null,
      instance_type_locked: false,
      locked_instance_type_invisible: false,
      instance_type_scaling: false,
      default_storage_block_id: null,
      storage_block_locked: false,
      locked_storage_block_invisible: false,
      storage_block_scaling: false,
      default_image_hash_id: null,
      locked_image_invisible: false,
      image_locked: false,
      compatible_distros: [],
      incompatible_images: {},
      auto_assign_network: "public",
      additional_disk: "new",
      root_disk_redundancy: false,
      additional_disk_one_redundancy: false,
      additional_disk_two_redundancy: false,
    },
    gpu_config: {
      default_gpu_model_id: null,
      gpu_model_quantity: 1,
      gpu_model_locked: false,
      max_gpu_model_quantity: 0,
      gpu_model_quantity_lock: false,
      locked_gpu_model_invisible: false,
      compatible_vendors: [],
      incompatible_models: {},
      default_gpu_pools: [],
      gpu_pool_locked: false,
      locked_gpu_pool_invisible: false,
      pool_display_mode: "pool_and_model",
      supports_infiniband: false,
      infiniband_regions_only: false,
    },
    service_exposure: opts.ports,
  };

  console.log(`[Recipes] Creating HAI service: ${serviceName} (recipe_id=${opts.recipeId})`);
  const result = await hostedaiRequest<{ id: string; name: string }>("POST", "/service", payload);
  console.log(`[Recipes] Service created: ${result.id} (${result.name})`);
  return result;
}

/**
 * Delete a HAI service.
 * Used during teardown to remove the app's service.
 */
export async function deleteAppService(serviceId: string): Promise<void> {
  console.log(`[Recipes] Deleting HAI service: ${serviceId}`);
  await hostedaiRequest("DELETE", `/service/${serviceId}`);
  console.log(`[Recipes] Service deleted: ${serviceId}`);
}
