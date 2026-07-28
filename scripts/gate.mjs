// The release gate, as one command that FAILS LOUDLY.
//
// Running `npm run typecheck | tail -2 && npx vitest run` looks like a gate and is
// not one: a pipeline's exit status is the LAST command's, so `tail` returning 0
// hides a failing tsc and the `&&` sails straight past it. That is how a commit
// went out with two type errors in it.
//
// Each step here is checked on its own exit code, and the script exits non-zero on
// the first failure with the real output attached.
import { spawnSync } from "node:child_process";

const steps = [
  { name: "typecheck", cmd: "npm", args: ["run", "typecheck"] },
  { name: "tests", cmd: "npx", args: ["vitest", "run"] },
  { name: "build", cmd: "npm", args: ["run", "build"] },
];

let failed = false;
for (const s of steps) {
  process.stdout.write(`\n=== ${s.name} ===\n`);
  const r = spawnSync(s.cmd, s.args, { stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) {
    process.stdout.write(`\nGATE FAILED at "${s.name}" (exit ${r.status}).\n`);
    failed = true;
    break;
  }
}

if (failed) process.exit(1);
process.stdout.write("\nGATE PASSED — typecheck, tests and build all clean.\n");
