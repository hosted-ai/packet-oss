"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sshCommand = void 0;
const commander_1 = require("commander");
const chalk_1 = __importDefault(require("chalk"));
const ora_1 = __importDefault(require("ora"));
const child_process_1 = require("child_process");
const api_js_1 = require("../api.js");
const config_js_1 = require("../config.js");
/**
 * Parse an SSH command string like "ssh user@host -p 12345" into components
 */
function parseSSHCommand(cmd) {
    const match = cmd.match(/ssh\s+(\S+)@(\S+)\s+-p\s+(\d+)/);
    if (!match)
        return null;
    return { user: match[1], host: match[2], port: match[3] };
}
exports.sshCommand = new commander_1.Command("ssh")
    .description("SSH into a GPU instance")
    .argument("<id>", "Instance ID")
    .option("-c, --command <cmd>", "Run a command instead of interactive shell")
    .option("--copy", "Just print the SSH command (don't connect)")
    .action(async (id, options) => {
    if (!(0, config_js_1.getApiKey)()) {
        console.log(chalk_1.default.yellow("\n  Not logged in. Run 'packet login' first.\n"));
        process.exit(1);
    }
    const spinner = (0, ora_1.default)("Getting connection info...").start();
    try {
        const info = await (0, api_js_1.apiRequest)(`/instances/${id}/connection`);
        const pod = info.pods?.find((p) => p.pod_status === "Running" && p.ssh);
        if (!pod?.ssh) {
            spinner.fail("Instance not ready for SSH");
            console.log(chalk_1.default.gray("\n  The instance may still be starting. Try again in a moment.\n"));
            console.log(chalk_1.default.gray(`  Check status: packet ps\n`));
            process.exit(1);
        }
        spinner.stop();
        const { command: sshCmd, password } = pod.ssh;
        const parsed = parseSSHCommand(sshCmd);
        if (options.copy) {
            console.log(chalk_1.default.cyan("\n  SSH Command:\n"));
            console.log(chalk_1.default.white(`  ${sshCmd}`));
            if (password) {
                console.log(chalk_1.default.gray(`  Password: ${password}`));
            }
            console.log();
            return;
        }
        console.log(chalk_1.default.cyan(`\n  Connecting to instance ${id}...`));
        if (password) {
            console.log(chalk_1.default.gray(`  Password: ${password}`));
        }
        console.log();
        if (!parsed) {
            // Can't parse the command, just print it
            console.log(chalk_1.default.yellow("  Could not auto-connect. Run manually:"));
            console.log(chalk_1.default.white(`  ${sshCmd}`));
            if (password) {
                console.log(chalk_1.default.gray(`  Password: ${password}`));
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
                const sshpass = (0, child_process_1.spawn)("sshpass", ["-p", password, "ssh", ...sshArgs], {
                    stdio: "inherit",
                });
                sshpass.on("error", () => {
                    console.log(chalk_1.default.yellow("  Note: Install 'sshpass' for automatic password entry."));
                    console.log(chalk_1.default.gray(`  Or manually enter password: ${password}\n`));
                    const ssh = (0, child_process_1.spawn)("ssh", sshArgs, { stdio: "inherit" });
                    ssh.on("close", (code) => process.exit(code || 0));
                });
                sshpass.on("close", (code) => process.exit(code || 0));
            }
            catch {
                const ssh = (0, child_process_1.spawn)("ssh", sshArgs, { stdio: "inherit" });
                ssh.on("close", (code) => process.exit(code || 0));
            }
        }
        else {
            const ssh = (0, child_process_1.spawn)("ssh", sshArgs, { stdio: "inherit" });
            ssh.on("close", (code) => process.exit(code || 0));
        }
    }
    catch (error) {
        spinner.fail("Failed to get connection info");
        console.log(chalk_1.default.red(`\n  ${error instanceof Error ? error.message : "Unknown error"}\n`));
        process.exit(1);
    }
});
