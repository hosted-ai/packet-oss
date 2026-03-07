import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { spawn } from "child_process";
import { apiRequest, type ConnectionInfo } from "../api.js";
import { getApiKey } from "../config.js";

/**
 * Parse an SSH command string like "ssh user@host -p 12345" into components
 */
function parseSSHCommand(cmd: string): { user: string; host: string; port: string } | null {
  const match = cmd.match(/ssh\s+(\S+)@(\S+)\s+-p\s+(\d+)/);
  if (!match) return null;
  return { user: match[1], host: match[2], port: match[3] };
}

export const sshCommand = new Command("ssh")
  .description("SSH into a GPU instance")
  .argument("<id>", "Instance ID")
  .option("-c, --command <cmd>", "Run a command instead of interactive shell")
  .option("--copy", "Just print the SSH command (don't connect)")
  .action(async (id, options) => {
    if (!getApiKey()) {
      console.log(chalk.yellow("\n  Not logged in. Run 'packet login' first.\n"));
      process.exit(1);
    }

    const spinner = ora("Getting connection info...").start();

    try {
      const info = await apiRequest<ConnectionInfo>(
        `/instances/${id}/connection`
      );

      const pod = info.pods?.find((p) => p.pod_status === "Running" && p.ssh);

      if (!pod?.ssh) {
        spinner.fail("Instance not ready for SSH");
        console.log(chalk.gray("\n  The instance may still be starting. Try again in a moment.\n"));
        console.log(chalk.gray(`  Check status: packet ps\n`));
        process.exit(1);
      }

      spinner.stop();

      const { command: sshCmd, password } = pod.ssh;
      const parsed = parseSSHCommand(sshCmd);

      if (options.copy) {
        console.log(chalk.cyan("\n  SSH Command:\n"));
        console.log(chalk.white(`  ${sshCmd}`));
        if (password) {
          console.log(chalk.gray(`  Password: ${password}`));
        }
        console.log();
        return;
      }

      console.log(chalk.cyan(`\n  Connecting to instance ${id}...`));
      if (password) {
        console.log(chalk.gray(`  Password: ${password}`));
      }
      console.log();

      if (!parsed) {
        // Can't parse the command, just print it
        console.log(chalk.yellow("  Could not auto-connect. Run manually:"));
        console.log(chalk.white(`  ${sshCmd}`));
        if (password) {
          console.log(chalk.gray(`  Password: ${password}`));
        }
        console.log();
        return;
      }

      const { user, host, port } = parsed;

      // Build SSH args
      const sshArgs = [
        "-o", "StrictHostKeyChecking=no",
        "-o", "UserKnownHostsFile=/dev/null",
        "-o", "LogLevel=ERROR",
        "-p", port,
        `${user}@${host}`,
      ];

      if (options.command) {
        sshArgs.push(options.command);
      }

      // Check if sshpass is available for password auth
      if (password) {
        try {
          const sshpass = spawn("sshpass", ["-p", password, "ssh", ...sshArgs], {
            stdio: "inherit",
          });

          sshpass.on("error", () => {
            console.log(chalk.yellow("  Note: Install 'sshpass' for automatic password entry."));
            console.log(chalk.gray(`  Or manually enter password: ${password}\n`));

            const ssh = spawn("ssh", sshArgs, { stdio: "inherit" });
            ssh.on("close", (code) => process.exit(code || 0));
          });

          sshpass.on("close", (code) => process.exit(code || 0));
        } catch {
          const ssh = spawn("ssh", sshArgs, { stdio: "inherit" });
          ssh.on("close", (code) => process.exit(code || 0));
        }
      } else {
        const ssh = spawn("ssh", sshArgs, { stdio: "inherit" });
        ssh.on("close", (code) => process.exit(code || 0));
      }
    } catch (error) {
      spinner.fail("Failed to get connection info");
      console.log(chalk.red(`\n  ${error instanceof Error ? error.message : "Unknown error"}\n`));
      process.exit(1);
    }
  });
