import { writeErr } from "../../utils/output";
import type { Config } from "../../utils/types";

export function assertInteractivePreflight(config: Config): void {
	if (config.outputMode === "json") {
		writeErr("交互模式不支持 --json");
		process.exit(1);
	}
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		writeErr(
			"交互模式需要 TTY（stdin/stdout 必须都是终端）",
		);
		process.exit(1);
	}
}
