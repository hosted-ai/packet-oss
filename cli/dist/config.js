"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
exports.getApiKey = getApiKey;
exports.setApiKey = setApiKey;
exports.clearApiKey = clearApiKey;
exports.getApiUrl = getApiUrl;
exports.setApiUrl = setApiUrl;
const conf_1 = __importDefault(require("conf"));
exports.config = new conf_1.default({
    projectName: "packet-cli",
    defaults: {
        apiUrl: process.env.PACKET_API_URL || "http://localhost:3000",
    },
});
function getApiKey() {
    return exports.config.get("apiKey");
}
function setApiKey(key) {
    exports.config.set("apiKey", key);
}
function clearApiKey() {
    exports.config.delete("apiKey");
}
function getApiUrl() {
    return exports.config.get("apiUrl");
}
function setApiUrl(url) {
    exports.config.set("apiUrl", url);
}
