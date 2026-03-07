"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiError = void 0;
exports.apiRequest = apiRequest;
const config_js_1 = require("./config.js");
class ApiError extends Error {
    status;
    constructor(status, message) {
        super(message);
        this.status = status;
        this.name = "ApiError";
    }
}
exports.ApiError = ApiError;
async function apiRequest(endpoint, options = {}) {
    const apiKey = (0, config_js_1.getApiKey)();
    if (!apiKey) {
        throw new Error("Not authenticated. Run 'packet login' first.");
    }
    const url = `${(0, config_js_1.getApiUrl)()}/api/v1${endpoint}`;
    const response = await fetch(url, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
            ...options.headers,
        },
    });
    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new ApiError(response.status, errorData.error || errorData.message || `HTTP ${response.status}`);
    }
    const json = (await response.json());
    return json.data;
}
