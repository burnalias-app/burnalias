import pino from "pino";
import { config } from "../config";

export const logger = pino({
  level: config.logLevel,
  hooks: {
    logMethod(args, method) {
      if (typeof args[0] === "object" && args[0] !== null && typeof args[1] === "string") {
        const moduleName = "module" in args[0] && typeof args[0].module === "string" ? args[0].module : null;
        if (moduleName && !args[1].startsWith(`[${moduleName}]`)) {
          args[1] = `[${moduleName}] ${args[1]}`;
        }
      }

      method.apply(this, args);
    }
  },
  transport:
    config.nodeEnv !== "production"
      ? {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:HH:MM:ss.l",
            ignore: "pid,hostname"
          }
        }
      : undefined
});
