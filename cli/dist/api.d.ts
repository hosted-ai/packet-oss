export declare class ApiError extends Error {
    status: number;
    constructor(status: number, message: string);
}
export declare function apiRequest<T>(endpoint: string, options?: RequestInit): Promise<T>;
export interface Account {
    id: string;
    email: string;
    name?: string;
    teamId?: string;
    createdAt: string;
}
export interface Pool {
    id: number | string;
    name: string;
    gpu_model?: string;
    available_gpus?: number;
    price_per_hour?: number;
}
export interface GpuProduct {
    id: string;
    name: string;
    description: string | null;
    pricePerHourCents: number;
    poolIds: number[];
    displayOrder: number;
    featured: boolean;
    badgeText: string | null;
    vramGb: number | null;
    totalAvailableGpus: number;
}
export interface LaunchOptions {
    regions: Array<{
        id: string | number;
        name?: string;
    }>;
    pools: Pool[];
    products: GpuProduct[];
    instanceTypes: Array<{
        id: string;
        name: string;
        description?: string;
    }>;
    images: Array<{
        id: string;
        name: string;
        description?: string;
    }>;
    storageBlocks: unknown[];
    ephemeralStorageBlocks: unknown[];
    persistentStorageBlocks: unknown[];
}
export interface InstanceList {
    instances: unknown[];
    poolSubscriptions: Array<{
        id: number | string;
        status: string;
        pool_id?: number | string;
        pool_name?: string;
        gpu_count?: number;
        created_at?: string;
        pods?: Array<{
            pod_name: string;
            pod_status: string;
        }>;
    }>;
    podMetadata: Record<string, {
        displayName: string | null;
        notes: string | null;
    }>;
}
export interface InstanceDetail {
    subscription: {
        id: number | string;
        status: string;
        pool_id?: number | string;
        pool_name?: string;
        gpu_count?: number;
        created_at?: string;
        pods?: Array<{
            pod_name: string;
            pod_status: string;
        }>;
    };
    metadata: {
        displayName: string | null;
        notes: string | null;
    };
    connectionInfo?: unknown;
}
export interface ConnectionInfo {
    subscription_id: string;
    pods: Array<{
        pod_name: string;
        pod_status: string;
        internal_ip?: string | null;
        ssh?: {
            command: string;
            password: string;
        } | null;
        discovered_services?: unknown[];
    }>;
}
export interface CreateInstanceResult {
    subscription_id: number | string;
    name: string;
    pool_id: string;
    vgpus: number;
    startup_script_status?: string;
}
