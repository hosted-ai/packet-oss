"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.whoamiCommand = void 0;
const commander_1 = require("commander");
const chalk_1 = __importDefault(require("chalk"));
const ora_1 = __importDefault(require("ora"));
const api_js_1 = require("../api.js");
const config_js_1 = require("../config.js");
exports.whoamiCommand = new commander_1.Command("whoami")
    .description("Show current logged-in account")
    .action(async () => {
    if (!(0, config_js_1.getApiKey)()) {
        console.log(chalk_1.default.yellow("\n  Not logged in. Run 'packet login' first.\n"));
        process.exit(1);
    }
    const spinner = (0, ora_1.default)("Fetching account info...").start();
    try {
        const account = await (0, api_js_1.apiRequest)("/account");
        spinner.stop();
        console.log(chalk_1.default.cyan("\n  Account\n"));
        console.log(chalk_1.default.white(`  Email:   ${account.email}`));
        if (account.name) {
            console.log(chalk_1.default.white(`  Name:    ${account.name}`));
        }
        console.log();
    }
    catch (error) {
        spinner.fail("Failed to fetch account info");
        console.log(chalk_1.default.red(`\n  ${error instanceof Error ? error.message : "Unknown error"}\n`));
        process.exit(1);
    }
});
