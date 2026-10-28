import { readdirSync, readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { parse as parseYAML } from "yaml";
import { GPU_APPS } from "@/lib/gpu-apps";

// An unpinned wheel resolves to whatever the index serves that day, and
// `--pre … /nightly/` asks for a nightly by construction.
const NIGHTLY = /nightly\/cu\d+|--pre\b/;

// A pip install naming torch or vLLM without `==` after the package.
const UNPINNED_PIP = /pip install\b[^\n]*\b(?:torch|torchvision|torchaudio|vllm)\b(?!==)/;

const PINNABLE = /^(?:torch|torchvision|torchaudio|vllm)$/;

const REPO_ROOT = path.resolve(__dirname, "../..");
const RECIPES = path.join(REPO_ROOT, "recipes/packet_recipes");

function offendingLines(text: string, rx: RegExp): string[] {
  return text.split("\n").filter((line) => rx.test(line));
}

// prisma/seed.ts upserts installScript from these definitions on every run, so
// a pin that lives only in a downstream migration is overwritten by the seed.
describe("GPU app install scripts are pinned at source", () => {
  const apps = GPU_APPS.map((app) => [app.slug, app.installScript] as const);

  it.each(apps)("%s takes no nightly or pre-release wheel", (_slug, script) => {
    expect(offendingLines(script, NIGHTLY)).toEqual([]);
  });

  it.each(apps)("%s pins every torch and vLLM install", (_slug, script) => {
    expect(offendingLines(script, UNPINNED_PIP)).toEqual([]);
  });

  it.each(apps)("%s names an index for every torch and vLLM install", (_slug, script) => {
    for (const line of offendingLines(script, /pip install\b[^\n]*\b(?:torch|vllm)/)) {
      expect(line).toMatch(/--index-url https:\/\//);
    }
  });
});

type Task = Record<string, unknown>;

function flatten(tasks: unknown): Task[] {
  if (!Array.isArray(tasks)) return [];
  return tasks.flatMap((task: Task) => [task, ...flatten(task?.block)]);
}

function pipPackages(task: Task): string[] {
  const pip = task["ansible.builtin.pip"] as { name?: unknown } | undefined;
  if (!pip) return [];
  return Array.isArray(pip.name) ? pip.name.map(String) : pip.name ? [String(pip.name)] : [];
}

function shellLines(task: Task): string[] {
  const shell = task["ansible.builtin.shell"] ?? task["ansible.builtin.command"];
  return typeof shell === "string" ? shell.split("\n") : [];
}

// The recipe roles install the same wheels down a different delivery path, so
// they carry the same defect and need the same guard.
describe("Recipe roles are pinned at source", () => {
  const roles = readdirSync(RECIPES, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  it("finds the recipe roles to check", () => {
    expect(roles.length).toBeGreaterThan(0);
  });

  it.each(roles)("%s takes no nightly or pre-release wheel", (role) => {
    const file = path.join(RECIPES, role, "ansible/roles", role, "tasks/main.yml");
    expect(offendingLines(readFileSync(file, "utf8"), NIGHTLY)).toEqual([]);
  });

  it.each(roles)("%s pins every torch and vLLM install", (role) => {
    const file = path.join(RECIPES, role, "ansible/roles", role, "tasks/main.yml");
    const tasks = flatten(parseYAML(readFileSync(file, "utf8")));
    for (const task of tasks) {
      expect(pipPackages(task).filter((pkg) => PINNABLE.test(pkg))).toEqual([]);
      expect(shellLines(task).filter((line) => UNPINNED_PIP.test(line))).toEqual([]);
    }
  });
});
