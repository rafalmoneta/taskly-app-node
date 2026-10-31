// Stand-ins for prettier, tsc and vitest. Each one reads the files of the app
// it runs in, so a test changes a verdict by editing a file:
//   tests/*.test.ts  one `pass <name>` or `fail <name>` line per test case,
//                    plus the control lines `threshold`, `crash` and `kill`
//   src/*.ts         a `type-error` line fails tsc
//   any file         a `syntax-error` line fails prettier
import {
  appendFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const [tool, ...args] = process.argv.slice(2);
appendFileSync("tool-calls.log", `${[tool, ...args].join(" ")}\n`);

const linesOf = (file: string) => readFileSync(file, "utf8").split("\n");

function filesIn(dir: string): string[] {
  return readdirSync(dir).map((name) => path.join(dir, name));
}

function prettier() {
  for (const file of args.filter((arg) => !arg.startsWith("--"))) {
    const lines = linesOf(file);
    if (lines.includes("syntax-error")) {
      console.error(`${file}: SyntaxError`);
      process.exit(2);
    }
    writeFileSync(file, lines.map((line) => line.trimEnd()).join("\n"));
  }
}

function tsc() {
  const broken = filesIn("src").filter((file) =>
    linesOf(file).includes("type-error"),
  );
  for (const file of broken) console.error(`${file}: error TS2322`);
  process.exit(broken.length > 0 ? 2 : 0);
}

function vitest() {
  const lines = filesIn("tests").flatMap(linesOf);
  if (lines.includes("crash")) process.exit(1);

  const testResults = filesIn("tests").map((file) => {
    const cases = linesOf(file).flatMap((line) => {
      const [status, ...name] = line.split(" ");
      return status === "pass" || status === "fail"
        ? [
            {
              fullName: name.join(" "),
              status: status === "pass" ? "passed" : "failed",
              failureMessages:
                status === "fail" ? ["AssertionError: nope"] : [],
            },
          ]
        : [];
    });
    const failed = cases.some((c) => c.status === "failed");
    return {
      name: path.resolve(file),
      status: failed ? "failed" : "passed",
      assertionResults: cases,
    };
  });
  const cases = testResults.flatMap((file) => file.assertionResults);
  const outputFile = args
    .find((arg) => arg.startsWith("--outputFile="))
    ?.split("=")[1];
  if (outputFile) {
    mkdirSync(path.dirname(outputFile), { recursive: true });
    writeFileSync(
      outputFile,
      JSON.stringify({
        numPassedTests: cases.filter((c) => c.status === "passed").length,
        testResults,
      }),
    );
  }
  if (args.includes("--coverage")) {
    const pct = { pct: 80 };
    mkdirSync("coverage", { recursive: true });
    writeFileSync(
      path.join("coverage", "coverage-summary.json"),
      JSON.stringify({
        total: { lines: pct, branches: pct, functions: pct, statements: pct },
      }),
    );
  }
  if (lines.includes("kill")) process.kill(process.pid, "SIGKILL");
  const failed = cases.some((c) => c.status === "failed");
  process.exit(failed || lines.includes("threshold") ? 1 : 0);
}

({ prettier, tsc, vitest })[tool as "prettier" | "tsc" | "vitest"]();
