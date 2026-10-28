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
import { existsSync, statSync, readFileSync } from "fs";
import path from "path";
import { getAdminCredentials } from "@/lib/gpuaas-admin/client";
import { hostedaiRequest } from "./client";

// --- HAI Admin Panel Auth ---
// Uses the shared gpuaas-admin client for credential resolution (DB → env → legacy env).
// Login is done per-call with Bearer token (TUS protocol needs Authorization header,
// not the session cookie used by gpuaasAdminRequest).

interface AdminLoginResponse {
  token: string;
}

async function loginToAdmin(): Promise<{ token: string; url: string }> {
  const creds = await getAdminCredentials();
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
  return { token: data.token, url: creds.url };
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
export function compressRecipe(slug: string): { archivePath: string; fileSize: number; tmpDir: string } {
  const repoRoot = process.cwd();
  const recipePath = path.join(repoRoot, "recipes", "packet_recipes", slug);

  if (!existsSync(recipePath)) {
    throw new Error(`Recipe directory not found: recipes/packet_recipes/${slug}`);
  }

  // Use /tmp for builds — process.cwd() may be read-only in production (.deb installs to /usr/share)
  const tmpDir = execSync("mktemp -d").toString().trim();
  const archivePath = path.join(tmpDir, `${slug}.tar.gz`);

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
  } catch (e) {
    execSync(`rm -rf "${tmpDir}"`);
    throw e;
  }

  const fileSize = statSync(archivePath).size;
  console.log(`[Recipes] Compressed ${slug}: ${archivePath} (${fileSize} bytes)`);
  return { archivePath, fileSize, tmpDir };
}

// --- TUS Upload to HAI Admin Panel ---

/**
 * Look up a recipe-template ID by name (and optionally version) in the HAI
 * admin templates list. Returns null if the list can't be read or nothing
 * matches. NOTE: this list is permission-filtered server-side, so a recipe that
 * exists (and blocks upload via HAI's global 409 uniqueness check) can still be
 * absent here — see uploadRecipe / PA-132.
 */
async function findTemplateId(adminUrl: string, token: string, slug: string, version?: string): Promise<number | null> {
  const resp = await fetch(`${adminUrl}/api/recipes/templates`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) return null;
  const all = (await resp.json()) as Array<{ id: number; name: string; version?: string }>;
  const match = all.find((t) => t.name === slug && (version === undefined || t.version === version));
  return match ? match.id : null;
}

/**
 * Best-effort delete of a visible existing template with this name so a
 * re-upload is clean. Throws on a real delete failure (surfacing e.g. the
 * pod-association "FAILURE" so the admin sees why); a no-op if nothing visible
 * matches.
 */
async function deleteExistingTemplate(adminUrl: string, token: string, slug: string): Promise<void> {
  const templatesResp = await fetch(`${adminUrl}/api/recipes/templates`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!templatesResp.ok) return;
  const templates = (await templatesResp.json()) as Array<{ id: number; name: string }>;
  const existing = templates.find((t) => t.name === slug);
  if (!existing) return;
  console.log(`[Recipes] Found existing template ${slug} (ID: ${existing.id}), deleting...`);
  const delResp = await fetch(`${adminUrl}/api/recipes/templates/${existing.id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  if (!delResp.ok) {
    const errBody = await delResp.text();
    if (errBody.includes("FAILURE")) {
      throw new Error(`Cannot delete existing recipe "${slug}" — it may have associated pods. Remove them first.`);
    }
    throw new Error(`Failed to delete existing recipe "${slug}" (${delResp.status}): ${errBody}`);
  }
  console.log(`[Recipes] Deleted existing template ${slug}`);
}

/**
 * TUS init + data upload for one (slug, version). Returns the admin template ID
 * on success, or null when TUS init returns 409 (that name+version already
 * exists) so the caller can decide how to recover.
 */
async function tusInitAndUpload(adminUrl: string, token: string, slug: string, version: string, archivePath: string, fileSize: number): Promise<number | null> {
  const b64 = (s: string) => Buffer.from(s).toString("base64");
  const uploadMetadata = [
    `recipe_name ${b64(slug)}`,
    `version ${b64(version)}`,
    `description ${b64(slug)}`,
    `category ${b64("gpuaas")}`,
    `hide ${b64("false")}`,
    `name ${b64(`${slug}.tar.gz`)}`,
    `filename ${b64(`${slug}.tar.gz`)}`,
    `filetype ${b64("application/x-gzip")}`,
    `type ${b64("application/x-gzip")}`,
  ].join(",");

  console.log(`[Recipes] TUS init: uploading ${fileSize} bytes (${slug} v${version})...`);
  const initResp = await fetch(`${adminUrl}/api/recipes/templates/upload/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Tus-Resumable": "1.0.0",
      "Upload-Length": String(fileSize),
      "Upload-Metadata": uploadMetadata,
    },
  });

  if (initResp.status === 409) return null;
  if (!initResp.ok && initResp.status !== 201) {
    throw new Error(`TUS init failed (${initResp.status}): ${await initResp.text()}`);
  }

  let location = initResp.headers.get("Location");
  if (!location) {
    throw new Error("TUS init did not return a Location header");
  }
  if (!location.startsWith("http")) {
    location = `${adminUrl}${location}`;
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
  console.log(`[Recipes] Upload complete for ${slug} v${version}`);

  // Find the just-uploaded template ID from the admin list (match name+version
  // so we get exactly the row we uploaded, even if other versions are visible).
  const id = await findTemplateId(adminUrl, token, slug, version);
  if (id === null) {
    throw new Error(`Recipe "${slug}" (v${version}) was uploaded but not found in admin templates list.`);
  }
  return id;
}

/**
 * Upload a recipe archive to HAI admin panel via TUS protocol.
 * Returns the recipe_id.
 *
 * Flow:
 * 1. Login to admin panel
 * 2. Delete an existing (visible) template if found
 * 3. TUS upload as version "latest"
 * 4. On 409, reuse the recipe if it's visible; otherwise (PA-132) re-upload
 *    under a unique version to recover from a stale, role-invisible recipe
 * 5. Poll the user panel until the recipe syncs there
 */
export async function uploadRecipe(slug: string): Promise<number> {
  const { token, url: adminUrl } = await loginToAdmin();

  // Compress recipe (archive is written to a temp dir)
  const { archivePath, fileSize, tmpDir } = compressRecipe(slug);

  try {
  // Best-effort delete of an existing (visible) template so the re-upload is clean.
  await deleteExistingTemplate(adminUrl, token, slug);

  // Upload as version "latest". Returns null when TUS init 409s (a
  // "<slug>/latest" template already exists in HAI).
  let recipeId = await tusInitAndUpload(adminUrl, token, slug, "latest", archivePath, fileSize);

  if (recipeId === null) {
    // First, try to reuse the conflicting recipe from the admin list — works
    // when it's visible to this admin role (e.g. a benign upload race).
    recipeId = await findTemplateId(adminUrl, token, slug, "latest");

    if (recipeId === null) {
      // PA-132: the conflicting recipe is INVISIBLE to this admin role. HAI's
      // TUS 409 duplicate check is global (name+version), but
      // GET /api/recipes/templates is permission-filtered — a local recipe only
      // grants read to AdminRole and its original uploader, so historical/seeded
      // recipes created without that AdminRole read grant block re-upload yet
      // can't be seen, deleted, or ID'd from here. Re-upload under a unique
      // version to mint a fresh, role-visible template so setup proceeds.
      // (Server-side root cause tracked in HAI-8960.)
      const recoveryVersion = `latest-${Date.now()}`;
      console.warn(`[Recipes] "${slug}" already exists but is invisible to this admin role (PA-132) — re-uploading as version "${recoveryVersion}".`);
      recipeId = await tusInitAndUpload(adminUrl, token, slug, recoveryVersion, archivePath, fileSize);
      if (recipeId === null) {
        throw new Error(
          `TUS init failed (409): recipe "${slug}" already exists in HAI but is not visible to this admin role, ` +
          `and a unique-version re-upload also conflicted. A stale recipe template likely needs removing server-side.`,
        );
      }
    }
  }

  console.log(`[Recipes] Recipe ${slug} ready, admin ID: ${recipeId}. Waiting for user panel sync...`);

  // Poll user panel until recipe is visible there (required for service creation)
  const MAX_POLL_ATTEMPTS = 30;
  const POLL_INTERVAL_MS = 3000;
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
  console.warn(`[Recipes] Recipe ${slug} not yet visible on user panel after ${MAX_POLL_ATTEMPTS} attempts (~${(MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS / 1000)}s). Proceeding with admin ID.`);
  return recipeId;
  } finally {
    execSync(`rm -rf "${tmpDir}"`);
  }
}

// --- Service Creation for Apps ---

interface CreateAppServiceOpts {
  slug: string;
  name: string;
  recipeId: number;
  ports: Array<{ service_name: string; port: number; protocol: string; service_type: string }>;
  scenarioId: string;
  execTiming: "on_every_boot" | "on_first_boot" | "manual";
}

/**
 * Find an existing HAI service by name.
 * Returns the service id and name if found, null otherwise.
 */
async function findServiceByName(name: string): Promise<{ id: string; name: string } | null> {
  try {
    // HAI filter format: field[operation_type]=value (e.g. name[eq_str]=packet-app-comfyui)
    const result = await hostedaiRequest<
      Array<{ id: string; name: string }> | { items?: Array<{ id: string; name: string }> }
    >("GET", `/service?name[eqstr]=${encodeURIComponent(name)}&itemsPerPage=1&page=0`);

    const items = Array.isArray(result) ? result : result?.items;
    if (items?.length && items[0].name === name) {
      return items[0];
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Create a HAI service for an app with recipe, ports, and scenario.
 * If a service with the same name already exists (orphaned from a previous
 * setup), it is deleted first to avoid name conflicts.
 * Returns the created service.
 */
export async function createAppService(opts: CreateAppServiceOpts): Promise<{ id: string; name: string }> {
  const serviceName = `packet-app-${opts.slug}`;

  // Clean up orphaned service with the same name (e.g. from failed teardown)
  const existing = await findServiceByName(serviceName);
  if (existing) {
    console.log(`[Recipes] Found orphaned service "${serviceName}" (${existing.id}), deleting before recreate...`);
    try {
      await hostedaiRequest("DELETE", `/service/${existing.id}`);
      console.log(`[Recipes] Deleted orphaned service ${existing.id}`);
    } catch (err) {
      console.warn(`[Recipes] Failed to delete orphaned service ${existing.id}:`, err);
      // If delete fails (e.g. has active instances), throw so admin sees the real error
      throw new Error(
        `Service "${serviceName}" already exists (${existing.id}) and could not be removed. ` +
        `It may have active instances — remove them first, then retry.`
      );
    }
  }

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
 * Add a service to the default service policy so all teams can deploy it.
 * Calls POST /policy/service/add-object with the default service policy ID.
 */
export async function addServiceToDefaultPolicy(serviceId: string): Promise<void> {
  const { getDefaultPolicies } = await import("./default-policies");
  const policies = await getDefaultPolicies();
  const servicePolicyId = policies.service;

  console.log(`[Recipes] Adding service ${serviceId} to default service policy ${servicePolicyId}`);
  await hostedaiRequest("POST", "/policy/service/add-object", {
    policy_id: servicePolicyId,
    object_id: serviceId,
  });
  console.log(`[Recipes] Service ${serviceId} added to default service policy`);
}

/**
 * Remove a service from the default service policy.
 * Called during teardown before deleting the service.
 */
export async function removeServiceFromDefaultPolicy(serviceId: string): Promise<void> {
  const { getDefaultPolicies } = await import("./default-policies");
  const policies = await getDefaultPolicies();
  const servicePolicyId = policies.service;

  console.log(`[Recipes] Removing service ${serviceId} from default service policy ${servicePolicyId}`);
  try {
    await hostedaiRequest("POST", "/policy/service/remove-object", {
      policy_id: servicePolicyId,
      object_id: serviceId,
    });
    console.log(`[Recipes] Service ${serviceId} removed from default service policy`);
  } catch (err) {
    // Non-fatal: service may not have been in the policy
    console.warn(`[Recipes] Failed to remove service ${serviceId} from policy (may not exist):`, err);
  }
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
