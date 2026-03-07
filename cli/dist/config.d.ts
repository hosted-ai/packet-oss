import Conf from "conf";
interface ConfigSchema {
    apiKey?: string;
    apiUrl: string;
}
export declare const config: Conf<ConfigSchema>;
export declare function getApiKey(): string | undefined;
export declare function setApiKey(key: string): void;
export declare function clearApiKey(): void;
export declare function getApiUrl(): string;
export declare function setApiUrl(url: string): void;
export {};
