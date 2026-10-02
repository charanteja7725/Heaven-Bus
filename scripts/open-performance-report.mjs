import { access } from "node:fs/promises";
import { spawn } from "node:child_process";

const report = "performance/report/index.html";

try {
  await access(report);
} catch {
  console.error("\n✗ Performance report not found.");
  console.error("Run npm run test:performance first.\n");
  process.exit(1);
}

const command =
  process.platform === "win32"
    ? ["cmd", ["/c", "start", "", report]]
    : process.platform === "darwin"
      ? ["open", [report]]
      : ["xdg-open", [report]];

const child = spawn(command[0], command[1], {
  detached: true,
  stdio: "ignore",
  shell: false,
});
child.unref();

console.log("Opened HEAVEN-BUS JMeter HTML dashboard.");
