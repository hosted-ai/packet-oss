"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logsCommand = void 0;
const commander_1 = require("commander");
const chalk_1 = __importDefault(require("chalk"));
const ora_1 = __importDefault(require("ora"));
const api_js_1 = require("../api.js");
const config_js_1 = require("../config.js");
exports.logsCommand = new commander_1.Command("logs")
    .description("View instance information and status")
    .argument("<id>", "Instance ID")
    .option("-f, --follow", "Follow status updates")
    .action(async (id, options) => {
    if (!(0, config_js_1.getApiKey)()) {
        console.log(chalk_1.default.yellow("\n  Not logged in. Run 'packet login' first.\n"));
        process.exit(1);
    }
    const fetchAndDisplay = async () => {
        try {
            const data = await (0, api_js_1.apiRequest)(`/instances/${id}`);
            const sub = data.subscription;
            // Clear screen if following
            if (options.follow) {
                process.stdout.write("\x1B[2J\x1B[0f");
            }
            const displayName = data.metadata?.displayName || `Instance ${id}`;
            console.log(chalk_1.default.cyan(`\n  ${displayName}\n`));
            // Basic info
            const podStatus = sub.pods?.[0]?.pod_status;
            console.log(chalk_1.default.white("  Status:     ") + formatStatus(sub.status, podStatus));
            console.log(chalk_1.default.white("  GPU:        ") + chalk_1.default.gray(sub.pool_name || "Unknown"));
            if (sub.created_at) {
                console.log(chalk_1.default.white("  Created:    ") + chalk_1.default.gray(new Date(sub.created_at).toLocaleString()));
            }
            // Pod info
            if (sub.pods && sub.pods.length > 0) {
                console.log(chalk_1.default.white("\n  Pods:"));
                for (const pod of sub.pods) {
                    const status = pod.pod_status === "Running"
                        ? chalk_1.default.green(pod.pod_status)
                        : pod.pod_status === "Pending"
                            ? chalk_1.default.yellow(pod.pod_status)
                            : chalk_1.default.gray(pod.pod_status);
                    console.log(chalk_1.default.gray(`    - ${pod.pod_name}: `) + status);
                }
            }
            console.log();
            // Return true if still running (for --follow)
            return !["terminated", "deleted", "cancelled", "un_subscribed"].includes((sub.status || "").toLowerCase());
        }
        catch (error) {
            console.log(chalk_1.default.red(`\n  Error: ${error instanceof Error ? error.message : "Unknown error"}\n`));
            return false;
        }
    };
    if (options.follow) {
        console.log(chalk_1.default.gray("  Following instance status (Ctrl+C to exit)...\n"));
        let running = true;
        while (running) {
            running = await fetchAndDisplay();
            if (running) {
                await new Promise((r) => setTimeout(r, 3000));
            }
        }
        console.log(chalk_1.default.gray("  Instance terminated.\n"));
    }
    else {
        const spinner = (0, ora_1.default)("Fetching instance info...").start();
        spinner.stop();
        await fetchAndDisplay();
    }
});
function formatStatus(status, podStatus) {
    const s = (status || "").toLowerCase();
    if (s === "running" || s === "active" || s === "subscribed") {
        if (podStatus === "Running") {
            return chalk_1.default.green("running");
        }
        else if (podStatus === "Pending") {
            return chalk_1.default.yellow("starting");
        }
        return chalk_1.default.yellow(status);
    }
    else if (s === "subscribing" || s === "pending") {
        return chalk_1.default.yellow("starting");
    }
    else if (s === "un_subscribing" || s === "terminating") {
        return chalk_1.default.yellow("terminating");
    }
    else if (s === "terminated" || s === "deleted" || s === "un_subscribed") {
        return chalk_1.default.gray("terminated");
    }
    return chalk_1.default.gray(status);
}
