/**
 * Interactive Garmin login CLI.
 *
 *   pnpm garmin:login
 *
 * Prompts for your Garmin email + password (password is hidden), logs in via
 * garmin-connect-client, and writes the resulting session token bundle to the
 * gitignored .garmin-session.local.json. Your PASSWORD IS NEVER STORED — it is
 * used once to obtain the OAuth token bundle, which is what persists. After
 * login it probes the Garmin endpoints and prints a reachability report.
 *
 * If your account has 2FA, you'll be asked for the one-time code.
 */
import { writeFileSync } from "node:fs";
import * as readline from "node:readline";
import { login } from "garmin-connect-client";
import { probeAndReport, errInfo } from "./garmin-probe";

const SESSION_FILE = ".garmin-session.local.json";

// Single-byte key codes handled during hidden input.
const LF = 10; // Enter
const CR = 13; // Enter
const EOT = 4; // Ctrl-D
const ETX = 3; // Ctrl-C
const DEL = 127; // Backspace
const BS = 8; // Backspace

/** Visible line prompt. */
function ask(query: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(query, (answer) => { rl.close(); resolve(answer); }));
}

/** Hidden prompt — masks input with '*'. Requires a TTY (interactive terminal). */
function askHidden(query: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY || !stdin.setRawMode) {
      reject(new Error("password entry requires an interactive terminal (TTY)"));
      return;
    }
    process.stdout.write(query);
    stdin.resume();
    stdin.setRawMode(true);
    let value = "";
    const finish = () => {
      stdin.setRawMode!(false);
      stdin.pause();
      stdin.removeListener("data", onData);
      process.stdout.write("\n");
    };
    const onData = (buf: Buffer) => {
      // Multi-byte chunk (paste / non-ASCII): treat as printable text.
      if (buf.length > 1) {
        const s = buf.toString("utf8");
        value += s;
        process.stdout.write("*".repeat(s.length));
        return;
      }
      const code = buf[0];
      if (code === LF || code === CR || code === EOT) {
        finish();
        resolve(value);
      } else if (code === ETX) {
        stdin.setRawMode!(false);
        process.stdout.write("\n");
        process.exit(130);
      } else if (code === DEL || code === BS) {
        if (value.length > 0) {
          value = value.slice(0, -1);
          process.stdout.write("\b \b");
        }
      } else if (code >= 32) {
        value += buf.toString("utf8");
        process.stdout.write("*");
      }
      // Other control codes are ignored.
    };
    stdin.on("data", onData);
  });
}

async function main() {
  console.log(
    "\nGarmin login\n" +
      "Your password is used once to fetch a token bundle and is never stored.\n" +
      `The bundle is written to ${SESSION_FILE} (gitignored).\n`,
  );

  const email = (await ask("Garmin email: ")).trim();
  const password = await askHidden("Garmin password: ");
  if (!email || !password) {
    console.error("\nEmail and password are both required.");
    process.exit(1);
  }

  console.log("\nLogging in …");
  let client;
  try {
    const result = await login({ username: email, password });
    if (result.mfaRequired) {
      const code = (await ask("2FA code: ")).trim();
      client = await login(result, code);
    } else {
      client = result.client;
    }
  } catch (e) {
    const { status, note } = errInfo(e);
    console.error(`\n❌ Login failed${status ? ` (status ${status})` : ""}: ${note}`);
    process.exit(2);
  }

  const session = client.getSession();
  writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2));
  console.log(`\n✅ Authenticated. Token bundle written to ${SESSION_FILE} (password not stored).`);

  await probeAndReport(session);
}

main().catch((e) => {
  console.error("garmin-login crashed:", e);
  process.exit(1);
});
