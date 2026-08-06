import { createCliLoggerAdapter } from "./adapter";

interface LogSpawnedProcessInput {
	component: string;
	command: string[];
	childPid?: number;
	cwd?: string;
	detached?: boolean;
	metadata?: Record<string, unknown>;
}

export function logSpawnedProcess(input: LogSpawnedProcessInput): void {
	try {
		const logger = createCliLoggerAdapter({
			runtime: "cli",
			component: input.component,
		});
		logger.core.log("进程已生成", {
			command: input.command.join(" "),
			commandArgs: input.command.slice(1),
			executable: input.command[0],
			childPid: input.childPid,
			cwd: input.cwd,
			detached: input.detached,
			...input.metadata,
		});
	} catch {
		// Best-effort logging only.
	}
}
