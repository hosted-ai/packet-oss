"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loginCommand = void 0;
const commander_1 = require("commander");
const chalk_1 = __importDefault(require("chalk"));
const ora_1 = __importDefault(require("ora"));
const open_1 = __importDefault(require("open"));
const config_js_1 = require("../config.js");
exports.loginCommand = new commander_1.Command("login")
    .description("Authenticate with the GPU cloud platform")
    .option("-k, --key <apiKey>", "API key (or set PACKET_API_KEY env var)")
    .option("-i, --interactive", "Open browser to get API key")
    .action(async (options) => {
    // Check for API key in options or environment
    let apiKey = options.key || process.env.PACKET_API_KEY;
    if (options.interactive || !apiKey) {
        console.log(chalk_1.default.cyan("\n  Opening dashboard to get your API key...\n"));
        console.log(chalk_1.default.gray("  1. Log in to your account"));
        console.log(chalk_1.default.gray("  2. Go to Settings → API Keys"));
        console.log(chalk_1.default.gray("  3. Create a new API key"));
        console.log(chalk_1.default.gray("  4. Copy the key and paste it below\n"));
        await (0, open_1.default)(`${(0, config_js_1.getApiUrl)()}/account?tab=api-keys`);
        // Prompt for API key
        const readline = await import("readline");
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });
        apiKey = await new Promise((resolve) => {
            rl.question(chalk_1.default.white("  Enter your API key: "), (answer) => {
                rl.close();
                resolve(answer.trim());
            });
        });
    }
    if (!apiKey) {
        console.log(chalk_1.default.red("\n  Error: No API key provided.\n"));
        console.log(chalk_1.default.gray("  Use: packet login --key <your-api-key>"));
        console.log(chalk_1.default.gray("  Or:  packet login --interactive"));
        process.exit(1);
    }
    // Validate API key
    const spinner = (0, ora_1.default)("Validating API key...").start();
    try {
        const response = await fetch(`${(0, config_js_1.getApiUrl)()}/api/v1/account`, {
            headers: {
                Authorization: `Bearer ${apiKey}`,
            },
        });
        if (!response.ok) {
            spinner.fail("Invalid API key");
            process.exit(1);
        }
        const account = await response.json();
        (0, config_js_1.setApiKey)(apiKey);
        spinner.succeed("Logged in successfully");
        console.log(chalk_1.default.gray(`\n  Account: ${account.email}`));
        console.log(chalk_1.default.gray(`  Balance: $${(account.balanceCents / 100).toFixed(2)}\n`));
    }
    catch (error) {
        spinner.fail("Failed to validate API key");
        console.log(chalk_1.default.red(`\n  ${error instanceof Error ? error.message : "Unknown error"}\n`));
        process.exit(1);
    }
});
