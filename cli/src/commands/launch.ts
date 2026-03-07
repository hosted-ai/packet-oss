import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { apiRequest, type LaunchOptions, type CreateInstanceResult, type ConnectionInfo } from "../api.js";
import { getApiKey } from "../config.js";
import { SETUP_PRESETS } from "./setup.js";

export const launchCommand = new Command("launch")
  .description("Launch a new GPU instance")
  .option("-g, --gpu <type>", "GPU type (e.g., rtx-pro-6000, h100)")
  .option("-n, --name <name>", "Instance name")
  .option("-s, --setup <preset>", "Auto-setup preset (vscode, jupyter, jupyter-torch, workspace, full-dev)")
  .option("--gpus <count>", "Number of GPUs", "1")
  .option("-w, --wait", "Wait for instance to be ready")
  .action(async (options) => {
    if (!getApiKey()) {
      console.log(chalk.yellow("\n  Not logged in. Run 'packet login' first.\n"));
      process.exit(1);
    }

    if (!options.gpu) {
      console.log(chalk.cyan("\n  Usage: packet launch --gpu <type> [--setup <preset>]\n"));
      console.log(chalk.gray("  Run 'packet gpus' to see available GPU types."));
      console.log(chalk.gray("  Run 'packet setup list' to see auto-setup presets.\n"));
      process.exit(1);
    }

    if (options.setup) {
      const preset = SETUP_PRESETS.find((p) => p.id === options.setup);
      if (!preset) {
        console.log(chalk.red(`\n  Unknown setup preset: '${options.setup}'\n`));
        console.log(chalk.gray("  Available presets:"));
        for (const p of SETUP_PRESETS) {
          console.log(chalk.gray(`    ${p.id.padEnd(15)} ${p.icon} ${p.name}`));
        }
        console.log(chalk.gray("\n  Run 'packet setup list' for details.\n"));
        process.exit(1);
      }
    }

    const spinner = ora("Finding available GPU...").start();

    try {
      const launchOptions = await apiRequest<LaunchOptions>("/launch-options");

      // Find matching product (case insensitive, partial match)
      const gpuSearch = options.gpu.toLowerCase().replace(/[-_\s]/g, "");
      const product = (launchOptions.products || []).find((p) => {
        const productName = p.name.toLowerCase().replace(/[-_\s]/g, "");
        return productName.includes(gpuSearch) || gpuSearch.includes(productName);
      });

      if (!product) {
        spinner.fail(`GPU type '${options.gpu}' not found`);
        console.log(chalk.gray("\n  Run 'packet gpus' to see available types.\n"));
        process.exit(1);
      }

      if (product.totalAvailableGpus <= 0) {
        spinner.fail(`${product.name} is currently unavailable`);
        console.log(chalk.gray("\n  Try a different GPU type or check back later.\n"));
        process.exit(1);
      }

      // Pick the first available pool from this product
      const pool = launchOptions.pools.find((p) =>
        product.poolIds.includes(Number(p.id)) && (p.available_gpus ?? 0) > 0
      );

      if (!pool) {
        spinner.fail(`No available pool found for ${product.name}`);
        process.exit(1);
      }

      const setupPreset = options.setup
        ? SETUP_PRESETS.find((p) => p.id === options.setup)
        : undefined;

      spinner.text = `Launching ${product.name}${setupPreset ? ` with ${setupPreset.name}` : ""}...`;

      const gpuCount = Math.max(1, Math.floor(Number(options.gpus)));

      const body: Record<string, unknown> = {
        name: options.name || `cli-${product.name.replace(/\s+/g, "-").toLowerCase()}`,
        pool_id: pool.id,
        vgpus: gpuCount,
      };

      if (setupPreset) {
        body.startup_script = setupPreset.script;
        body.startup_script_preset_id = setupPreset.id;
      }

      const result = await apiRequest<CreateInstanceResult>("/instances", {
        method: "POST",
        body: JSON.stringify(body),
      });

      const subId = result.subscription_id;

      spinner.succeed(`Launched ${product.name}`);

      console.log(chalk.cyan(`\n  Instance ID: ${chalk.white(subId)}`));
      console.log(chalk.gray(`  Status:      starting`));
      console.log(
        chalk.gray(
          `  Price:       $${(product.pricePerHourCents / 100).toFixed(2)}/hr`
        )
      );

      if (setupPreset) {
        console.log(chalk.gray(`  Setup:       ${setupPreset.icon} ${setupPreset.name}`));
        console.log(chalk.gray(`  Est. time:   ~${setupPreset.estimatedMinutes} min after pod starts`));
      }

      if (options.wait || setupPreset) {
        const waitSpinner = ora("Waiting for instance to be ready...").start();

        let ready = false;
        let attempts = 0;
        const maxAttempts = 60;

        while (!ready && attempts < maxAttempts) {
          await new Promise((r) => setTimeout(r, 5000));
          attempts++;

          try {
            const connInfo = await apiRequest<ConnectionInfo>(
              `/instances/${subId}/connection`
            );

            const pod = connInfo.pods?.find((p) => p.pod_status === "Running" && p.ssh);

            if (pod?.ssh) {
              ready = true;
              waitSpinner.succeed("Instance is ready!");

              // Parse SSH command to extract host, port, user
              const sshMatch = pod.ssh.command.match(/ssh\s+(\S+)@(\S+)\s+-p\s+(\d+)/);
              if (sshMatch) {
                console.log(chalk.cyan("\n  SSH Connection:"));
                console.log(chalk.white(`  ${pod.ssh.command}`));
                if (pod.ssh.password) {
                  console.log(chalk.gray(`  Password: ${pod.ssh.password}`));
                }
              } else {
                console.log(chalk.cyan("\n  SSH Connection:"));
                console.log(chalk.white(`  ${pod.ssh.command}`));
                if (pod.ssh.password) {
                  console.log(chalk.gray(`  Password: ${pod.ssh.password}`));
                }
              }

              if (setupPreset) {
                console.log(chalk.cyan(`\n  Auto-setup (${setupPreset.name}) is running in the background.`));
                console.log(chalk.gray(`  Check progress: packet logs ${subId}`));
                if (setupPreset.defaultPort) {
                  console.log(chalk.gray(`  Service will be available on port ${setupPreset.defaultPort} when ready.`));
                }
              }
            } else {
              waitSpinner.text = `Waiting for instance to be ready...`;
            }
          } catch {
            // Continue polling on error
          }
        }

        if (!ready) {
          waitSpinner.warn("Instance is still starting. Check status with 'packet ps'");
        }
      } else {
        console.log(chalk.gray("\n  Use --wait to wait for SSH access"));
        console.log(chalk.gray(`  Or run: packet ssh ${subId}`));
      }

      console.log();
    } catch (error) {
      spinner.fail("Failed to launch instance");
      console.log(chalk.red(`\n  ${error instanceof Error ? error.message : "Unknown error"}\n`));
      process.exit(1);
    }
  });
