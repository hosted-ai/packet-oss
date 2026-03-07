"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.terminateCommand = void 0;
const commander_1 = require("commander");
const chalk_1 = __importDefault(require("chalk"));
const ora_1 = __importDefault(require("ora"));
const api_js_1 = require("../api.js");
const config_js_1 = require("../config.js");
exports.terminateCommand = new commander_1.Command("terminate")
    .description("Terminate a GPU instance")
    .argument("<id>", "Instance ID")
    .option("-f, --force", "Skip confirmation")
    .action(async (id, options) => {
    if (!(0, config_js_1.getApiKey)()) {
        console.log(chalk_1.default.yellow("\n  Not logged in. Run 'packet login' first.\n"));
        process.exit(1);
    }
    // Confirm unless --force
    if (!options.force) {
        const readline = await import("readline");
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });
        const confirmed = await new Promise((resolve) => {
            rl.question(chalk_1.default.yellow(`\n  Terminate instance ${id}? This cannot be undone. [y/N] `), (answer) => {
                rl.close();
                resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
            });
        });
        if (!confirmed) {
            console.log(chalk_1.default.gray("\n  Cancelled.\n"));
            return;
        }
    }
    const spinner = (0, ora_1.default)(`Terminating instance ${id}...`).start();
    try {
        await (0, api_js_1.apiRequest)(`/instances/${id}`, {
            method: "DELETE",
        });
        spinner.succeed(`Instance ${id} terminated`);
        console.log();
    }
    catch (error) {
        spinner.fail("Failed to terminate instance");
        console.log(chalk_1.default.red(`\n  ${error instanceof Error ? error.message : "Unknown error"}\n`));
        process.exit(1);
    }
});
