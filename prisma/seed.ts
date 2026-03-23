/**
 * Prisma seed script — populates GpuApp table from code definitions.
 *
 * Run: npx prisma db seed
 *
 * Uses upsert-by-slug to:
 * - Create new app records that don't exist yet
 * - Update existing records with latest code definitions
 * - Preserve existing IDs (InstalledApp FK relationships stay intact)
 * - NOT touch deploy config (serviceId, productId, deployable) — admin manages those
 */

import { PrismaClient } from "@prisma/client";

// Import app definitions from code
import { DEVELOPMENT_APPS } from "../src/lib/gpu-apps/apps/development";
import { INFERENCE_APPS } from "../src/lib/gpu-apps/apps/inference";
import { TRAINING_APPS } from "../src/lib/gpu-apps/apps/training";
import { CREATIVE_APPS } from "../src/lib/gpu-apps/apps/creative";

const prisma = new PrismaClient();

const GPU_APPS = [
  ...DEVELOPMENT_APPS,
  ...INFERENCE_APPS,
  ...TRAINING_APPS,
  ...CREATIVE_APPS,
];

async function main() {
  console.log(`Seeding ${GPU_APPS.length} GPU apps...`);

  let created = 0;
  let updated = 0;

  for (const app of GPU_APPS) {
    const result = await prisma.gpuApp.upsert({
      where: { slug: app.slug },
      create: {
        slug: app.slug,
        name: app.name,
        description: app.description,
        longDescription: app.longDescription || null,
        category: app.category,
        installScript: app.installScript,
        estimatedInstallMin: app.estimatedInstallMin,
        minVramGb: app.minVramGb,
        recommendedVramGb: app.recommendedVramGb,
        typicalVramUsageGb: app.typicalVramUsageGb || null,
        defaultPort: app.defaultPort || null,
        webUiPort: app.webUiPort || null,
        serviceType: app.serviceType || null,
        icon: app.icon,
        badgeText: app.badgeText || null,
        displayOrder: app.displayOrder,
        active: true,
        version: app.version || null,
        docsUrl: app.docsUrl || null,
        tags: JSON.stringify(app.tags),
      },
      update: {
        name: app.name,
        description: app.description,
        longDescription: app.longDescription || null,
        category: app.category,
        installScript: app.installScript,
        estimatedInstallMin: app.estimatedInstallMin,
        minVramGb: app.minVramGb,
        recommendedVramGb: app.recommendedVramGb,
        typicalVramUsageGb: app.typicalVramUsageGb || null,
        defaultPort: app.defaultPort || null,
        webUiPort: app.webUiPort || null,
        serviceType: app.serviceType || null,
        icon: app.icon,
        badgeText: app.badgeText || null,
        displayOrder: app.displayOrder,
        version: app.version || null,
        docsUrl: app.docsUrl || null,
        tags: JSON.stringify(app.tags),
        // NOTE: serviceId, productId, deployable, recipeSlug are NOT updated here.
        // Those are managed by admin. Seed only touches code-defined fields.
      },
    });

    // Check if this was a create or update by comparing timestamps
    const isNew = result.createdAt.getTime() === result.updatedAt.getTime();
    if (isNew) {
      created++;
      console.log(`  + Created: ${app.slug}`);
    } else {
      updated++;
      console.log(`  ~ Updated: ${app.slug}`);
    }
  }

  console.log(`\nDone. ${created} created, ${updated} updated.`);
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
