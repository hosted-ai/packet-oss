"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.gpusCommand = void 0;
const commander_1 = require("commander");
const chalk_1 = __importDefault(require("chalk"));
const ora_1 = __importDefault(require("ora"));
const cli_table3_1 = __importDefault(require("cli-table3"));
const api_js_1 = require("../api.js");
const config_js_1 = require("../config.js");
exports.gpusCommand = new commander_1.Command("gpus")
    .description("List available GPU types and pricing")
    .option("-a, --all", "Show all GPUs including unavailable")
    .action(async (options) => {
    if (!(0, config_js_1.getApiKey)()) {
        console.log(chalk_1.default.yellow("\n  Not logged in. Run 'packet login' first.\n"));
        process.exit(1);
    }
    const spinner = (0, ora_1.default)("Fetching available GPUs...").start();
    try {
        const data = await (0, api_js_1.apiRequest)("/launch-options");
        spinner.stop();
        let products = data.products || [];
        if (!options.all) {
            products = products.filter((p) => p.totalAvailableGpus > 0);
        }
        if (products.length === 0) {
            console.log(chalk_1.default.yellow("\n  No GPUs available right now.\n"));
            console.log(chalk_1.default.gray("  Use --all to see all GPU types.\n"));
            return;
        }
        console.log(chalk_1.default.cyan("\n  Available GPUs\n"));
        const table = new cli_table3_1.default({
            head: [
                chalk_1.default.white("Name"),
                chalk_1.default.white("GPU"),
                chalk_1.default.white("VRAM"),
                chalk_1.default.white("Available"),
                chalk_1.default.white("Price/hr"),
                chalk_1.default.white("Status"),
            ],
            style: {
                head: [],
                border: ["gray"],
            },
        });
        for (const product of products) {
            const slug = product.name.toLowerCase().replace(/\s+/g, "-");
            const available = product.totalAvailableGpus;
            const price = `$${(product.pricePerHourCents / 100).toFixed(2)}`;
            const vram = product.vramGb ? `${product.vramGb}GB` : "-";
            const status = available > 0
                ? chalk_1.default.green("available")
                : chalk_1.default.gray("unavailable");
            table.push([
                chalk_1.default.cyan(slug),
                chalk_1.default.white(product.name),
                chalk_1.default.gray(vram),
                chalk_1.default.gray(`${available} GPU${available !== 1 ? "s" : ""}`),
                chalk_1.default.yellow(price),
                status,
            ]);
        }
        console.log(table.toString());
        console.log(chalk_1.default.gray(`\n  Launch with: packet launch --gpu <name>\n`));
    }
    catch (error) {
        spinner.fail("Failed to fetch GPUs");
        console.log(chalk_1.default.red(`\n  ${error instanceof Error ? error.message : "Unknown error"}\n`));
        process.exit(1);
    }
});
