import { Command } from "commander";
import { registerScheduleCommands } from "./schedule/handlers";
import type { CommandIo } from "./schedule/types";

export function createScheduleCommand(
	io: CommandIo,
	setExitCode: (code: number) => void,
): Command {
	let actionExitCode = 0;
	const fail = () => {
		actionExitCode = 1;
	};

	function action<T extends unknown[]>(
		fn: (...args: T) => Promise<void>,
	): (...args: T) => Promise<void> {
		return async (...args: T) => {
			try {
				await fn(...args);
			} catch (error) {
				io.writeErr(error instanceof Error ? error.message : String(error));
				fail();
			}
		};
	}

	const schedule = new Command("schedule")
		.description("创建和管理定时运行")
		.exitOverride()
		.hook("postAction", () => {
			setExitCode(actionExitCode);
		});

	registerScheduleCommands(schedule, io, fail, action);
	return schedule;
}
