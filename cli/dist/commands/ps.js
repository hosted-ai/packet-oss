"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.psCommand = void 0;
const commander_1 = require("commander");
const chalk_1 = __importDefault(require("chalk"));
const ora_1 = __importDefault(require("ora"));
const cli_table3_1 = __importDefault(require("cli-table3"));
const api_js_1 = require("../api.js");
const config_js_1 = require("../config.js");
exports.psCommand = new commander_1.Command("ps")
    .description("List running GPU instances")
    .option("-a, --all", "Include terminated instances")
    .action(async (options) => {
    if (!(0, config_js_1.getApiKey)()) {
        console.log(chalk_1.default.yellow("\n  Not logged in. Run 'packet login' first.\n"));
        process.exit(1);
    }
    const spinner = (0, ora_1.default)("Fetching instances...").start();
    try {
        const data = await (0, api_js_1.apiRequest)("/instances");
        spinner.stop();
        let subs = data.poolSubscriptions || [];
        // Filter out terminated unless --all
        if (!options.all) {
            subs = subs.filter((s) => !["terminated", "deleted", "cancelled", "un_subscribed"].includes((s.status || "").toLowerCase()));
        }
        if (subs.length === 0) {
            console.log(chalk_1.default.gray("\n  No running instances.\n"));
            console.log(chalk_1.default.gray("  Launch one with: packet launch --gpu <type>\n"));
            return;
        }
        console.log(chalk_1.default.cyan("\n  GPU Instances\n"));
        const table = new cli_table3_1.default({
            head: [
                chalk_1.default.white("ID"),
                chalk_1.default.white("Name"),
                chalk_1.default.white("GPU"),
                chalk_1.default.white("Status"),
                chalk_1.default.white("Uptime"),
            ],
            style: {
                head: [],
                border: ["gray"],
            },
        });
        for (const sub of subs) {
            const gpuType = sub.pool_name || "Unknown";
            const meta = data.podMetadata?.[String(sub.id)];
            const displayName = meta?.displayName || "-";
            // Calculate uptime
            const created = sub.created_at ? new Date(sub.created_at) : null;
            let uptime = "-";
            if (created) {
                const diffMs = Date.now() - created.getTime();
                const hours = Math.floor(diffMs / (1000 * 60 * 60));
                const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
                uptime = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
            }
            // Status with color
            const podStatus = sub.pods?.[0]?.pod_status;
            let statusDisplay;
            const status = (sub.status || "").toLowerCase();
            if (status === "running" || status === "active" || status === "subscribed") {
                if (podStatus === "Running") {
                    statusDisplay = chalk_1.default.green("running");
                }
                else if (podStatus === "Pending") {
                    statusDisplay = chalk_1.default.yellow("starting");
                }
                else {
                    statusDisplay = chalk_1.default.yellow(sub.status);
                }
            }
            else if (status === "subscribing" || status === "pending") {
                statusDisplay = chalk_1.default.yellow("starting");
            }
            else if (status === "un_subscribing" || status === "terminating") {
                statusDisplay = chalk_1.default.yellow("terminating");
            }
            else if (status === "terminated" || status === "deleted" || status === "un_subscribed") {
                statusDisplay = chalk_1.default.gray("terminated");
            }
            else {
                statusDisplay = chalk_1.default.gray(sub.status);
            }
            table.push([
                chalk_1.default.white(String(sub.id)),
                chalk_1.default.white(displayName),
                chalk_1.default.white(gpuType),
                statusDisplay,
                chalk_1.default.gray(uptime),
            ]);
        }
        console.log(table.toString());
        console.log(chalk_1.default.gray("\n  SSH: packet ssh <id>  |  Terminate: packet terminate <id>\n"));
    }
    catch (error) {
        spinner.fail("Failed to fetch instances");
        console.log(chalk_1.default.red(`\n  ${error instanceof Error ? error.message : "Unknown error"}\n`));
        process.exit(1);
    }
});
