#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const login_js_1 = require("./commands/login.js");
const logout_js_1 = require("./commands/logout.js");
const whoami_js_1 = require("./commands/whoami.js");
const gpus_js_1 = require("./commands/gpus.js");
const launch_js_1 = require("./commands/launch.js");
const ps_js_1 = require("./commands/ps.js");
const ssh_js_1 = require("./commands/ssh.js");
const terminate_js_1 = require("./commands/terminate.js");
const logs_js_1 = require("./commands/logs.js");
const setup_js_1 = require("./commands/setup.js");
const program = new commander_1.Command();
program
    .name("packet")
    .description("CLI for GPU cloud platform")
    .version("1.0.0");
// Authentication
program.addCommand(login_js_1.loginCommand);
program.addCommand(logout_js_1.logoutCommand);
program.addCommand(whoami_js_1.whoamiCommand);
// GPU management
program.addCommand(gpus_js_1.gpusCommand);
program.addCommand(launch_js_1.launchCommand);
program.addCommand(ps_js_1.psCommand);
program.addCommand(ssh_js_1.sshCommand);
program.addCommand(terminate_js_1.terminateCommand);
program.addCommand(logs_js_1.logsCommand);
program.addCommand(setup_js_1.setupCommand);
program.parse();
