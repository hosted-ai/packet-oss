#!/usr/bin/env node

import { Command } from "commander";
import { loginCommand } from "./commands/login.js";
import { logoutCommand } from "./commands/logout.js";
import { whoamiCommand } from "./commands/whoami.js";
import { gpusCommand } from "./commands/gpus.js";
import { launchCommand } from "./commands/launch.js";
import { psCommand } from "./commands/ps.js";
import { sshCommand } from "./commands/ssh.js";
import { terminateCommand } from "./commands/terminate.js";
import { logsCommand } from "./commands/logs.js";
import { setupCommand } from "./commands/setup.js";

const program = new Command();

program
  .name("packet")
  .description("CLI for GPU cloud platform")
  .version("1.0.0");

// Authentication
program.addCommand(loginCommand);
program.addCommand(logoutCommand);
program.addCommand(whoamiCommand);

// GPU management
program.addCommand(gpusCommand);
program.addCommand(launchCommand);
program.addCommand(psCommand);
program.addCommand(sshCommand);
program.addCommand(terminateCommand);
program.addCommand(logsCommand);
program.addCommand(setupCommand);

program.parse();
