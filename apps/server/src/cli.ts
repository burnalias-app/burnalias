import readline from "readline";
import { hashPassword } from "./lib/auth";
import { createApp } from "./app";
import { config } from "./config";
import { logger } from "./lib/logger";

function readPassword(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const stdin = process.stdin;
    const onData = (char: Buffer) => {
      const value = char.toString();
      if (value === "\n" || value === "\r" || value === "\u0004") {
        process.stdout.write("\n");
      } else {
        readline.cursorTo(process.stdout, 0);
        process.stdout.write(`${prompt}${"*".repeat(rl.line.length)}`);
      }
    };

    process.stdout.write(prompt);
    stdin.on("data", onData);
    rl.question("", (answer) => {
      stdin.removeListener("data", onData);
      rl.close();
      resolve(answer);
    });
  });
}

async function readConfirmedPassword(): Promise<string | null> {
  process.stdout.write("Enter admin password. Input is hidden.\n");
  const password = await readPassword("Password: ");
  process.stdout.write("Confirm admin password. Input is hidden.\n");
  const confirmation = await readPassword("Confirm: ");

  if (password !== confirmation) {
    process.stderr.write("Passwords did not match.\n");
    return null;
  }

  return password;
}

async function runAuthGenerate(): Promise<void> {
  const password = await readConfirmedPassword();
  if (!password) {
    process.exitCode = 1;
    return;
  }

  if (!password || password.length < 14) {
    process.stderr.write("Password must be at least 14 characters.\n");
    process.exitCode = 1;
    return;
  }

  const hash = await hashPassword(password);
  process.stdout.write(hash + "\n");
}

async function runServer(): Promise<void> {
  const { app, scheduler, authService } = createApp();
  authService.validateConfig();

  app.listen(config.port, () => {
    scheduler.start();
    logger.info({ port: config.port, env: config.nodeEnv }, "BurnAlias API started");
  });
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? "server";

  if (command === "auth-generate") {
    await runAuthGenerate();
    return;
  }

  if (command === "server") {
    await runServer();
    return;
  }

  process.stderr.write(`Unknown command: ${command}\n`);
  process.exitCode = 1;
}

void main();
