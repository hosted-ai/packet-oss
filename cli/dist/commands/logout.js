"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logoutCommand = void 0;
const commander_1 = require("commander");
const chalk_1 = __importDefault(require("chalk"));
const config_js_1 = require("../config.js");
exports.logoutCommand = new commander_1.Command("logout")
    .description("Log out and remove stored credentials")
    .action(() => {
    if (!(0, config_js_1.getApiKey)()) {
        console.log(chalk_1.default.yellow("\n  Not logged in.\n"));
        return;
    }
    (0, config_js_1.clearApiKey)();
    console.log(chalk_1.default.green("\n  Logged out successfully.\n"));
});
