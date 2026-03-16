"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
const winston_1 = require("winston");
exports.logger = (0, winston_1.createLogger)({
    level: process.env.LOG_LEVEL ?? "info",
    format: winston_1.format.combine(winston_1.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }), winston_1.format.errors({ stack: true }), winston_1.format.colorize(), winston_1.format.printf(({ level, message, timestamp, ...meta }) => {
        const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
        return `${timestamp} [${level}] ${message}${metaStr}`;
    })),
    transports: [
        new winston_1.transports.Console(),
        new winston_1.transports.File({ filename: "logs/error.log", level: "error" }),
        new winston_1.transports.File({ filename: "logs/combined.log" }),
    ],
});
//# sourceMappingURL=logger.js.map