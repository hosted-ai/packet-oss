import { Command, Option } from "commander";
import chalk from "chalk";
import ora from "ora";
import Table from "cli-table3";
import {
  apiRequest,
  type DeleteServiceResult,
  type ExposedService,
  type ExposeServiceRequest,
  type ExposeServiceResult,
} from "../api.js";
import { getApiKey } from "../config.js";

function requireAuth(): void {
  if (!getApiKey()) {
    console.log(chalk.yellow("\n  Not logged in. Run 'packet login' first.\n"));
    process.exit(1);
  }
}

const listCommand = new Command("list")
  .description("List exposed services for an instance")
  .argument("<instance-id>", "Instance ID")
  .option("--json", "Output as JSON")
  .action(async (instanceId, options) => {
    requireAuth();

    const spinner = options.json ? null : ora("Fetching services...").start();

    try {
      const services = await apiRequest<ExposedService[]>(`/services?instanceId=${instanceId}`);
      spinner?.stop();

      if (options.json) {
        console.log(JSON.stringify(services, null, 2));
        return;
      }

      if (services.length === 0) {
        console.log(chalk.gray("\n  No exposed services.\n"));
        console.log(
          chalk.gray(`  Expose one with: packet services expose ${instanceId} --port <port> --service-type https\n`)
        );
        return;
      }

      console.log(chalk.cyan("\n  Exposed Services\n"));

      const table = new Table({
        head: [
          chalk.white("ID"),
          chalk.white("Name"),
          chalk.white("Internal"),
          chalk.white("External"),
          chalk.white("IP"),
          chalk.white("Protocol"),
          chalk.white("Type"),
          chalk.white("Status"),
        ],
        style: { head: [], border: ["gray"] },
      });

      for (const s of services) {
        table.push([
          chalk.white(String(s.id)),
          chalk.white(s.service_name),
          chalk.white(String(s.internal_port)),
          chalk.white(String(s.external_port)),
          chalk.white(s.ip || "-"),
          chalk.white(s.protocol),
          chalk.white(s.type),
          chalk.white(s.status),
        ]);
      }

      console.log(table.toString());
      console.log();
    } catch (err) {
      spinner?.fail("Failed to fetch services");
      console.log(chalk.red(`\n  ${err instanceof Error ? err.message : "Unknown error"}\n`));
      process.exit(1);
    }
  });

const exposeCommand = new Command("expose")
  .description("Expose a port as a public service")
  .argument("<instance-id>", "Instance ID")
  .requiredOption("--port <port>", "Internal port to expose")
  .addOption(
    new Option("--service-type <type>", "Service type").choices(["https", "tcp"]).makeOptionMandatory()
  )
  .option("--name <name>", "Service name (default: port-<port>)")
  .option("--json", "Output as JSON")
  .action(async (instanceId, options) => {
    requireAuth();

    const serviceType = options.serviceType === "tcp" ? "none" : "https";
    const serviceName = options.name || `port-${options.port}`;

    const spinner = options.json ? null : ora(`Exposing port ${options.port}...`).start();

    try {
      const service = await apiRequest<ExposeServiceResult>("/services", {
        method: "POST",
        body: JSON.stringify({
          instanceId,
          port: Number(options.port),
          service_name: serviceName,
          protocol: "TCP",
          service_type: serviceType,
        } satisfies ExposeServiceRequest),
      });

      if (options.json) {
        console.log(JSON.stringify(service, null, 2));
        return;
      }

      spinner?.succeed(`Service '${service.service_name}' exposed`);
      console.log(
        chalk.gray(
          `\n  ${service.pod_port} → ${service.ip}:${service.node_port}  (${service.protocol}/${service.service_type})\n`
        )
      );
    } catch (err) {
      spinner?.fail("Failed to expose service");
      console.log(chalk.red(`\n  ${err instanceof Error ? err.message : "Unknown error"}\n`));
      process.exit(1);
    }
  });

const removeCommand = new Command("remove")
  .description("Remove an exposed service")
  .argument("<instance-id>", "Instance ID")
  .argument("<service-id>", "Service ID")
  .option("--json", "Output as JSON")
  .action(async (_instanceId, serviceId, options) => {
    requireAuth();

    const spinner = options.json ? null : ora(`Removing service ${serviceId}...`).start();

    try {
      const result = await apiRequest<DeleteServiceResult>(`/services?id=${serviceId}`, {
        method: "DELETE",
      });

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      spinner?.succeed(`Service ${serviceId} removed`);
      console.log();
    } catch (err) {
      spinner?.fail("Failed to remove service");
      console.log(chalk.red(`\n  ${err instanceof Error ? err.message : "Unknown error"}\n`));
      process.exit(1);
    }
  });

export const servicesCommand = new Command("services")
  .description("Manage exposed services for an instance")
  .addCommand(listCommand)
  .addCommand(exposeCommand)
  .addCommand(removeCommand);
