import { Command } from "commander";
export interface SetupPreset {
    id: string;
    name: string;
    description: string;
    icon: string;
    script: string;
    estimatedMinutes: number;
    defaultPort?: number;
    portsToExpose?: Array<{
        port: number;
        name: string;
    }>;
}
export declare const SETUP_PRESETS: SetupPreset[];
export declare const setupCommand: Command;
