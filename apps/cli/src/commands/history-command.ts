import type { Command } from "commander";
import type { TuiStartupTarget } from "../tui/types";
import type { CliOutputMode } from "../utils/types";
import {
	runHistoryDelete,
	runHistoryExport,
	runHistoryList,
	runHistoryUpdate,
} from "./history";

type HistoryCommandIo = {
	writeln: (text?: string) => void;
	writeErr: (text: string) => void;
};

type RegisterHistoryCommandOptions = {
	program: Command;
	io: HistoryCommandIo;
	setExitCode: (code: number) => void;
	setStartupTarget: (target: TuiStartupTarget) => void;
	isInteractiveTTY?: () => boolean;
};

function resolveHistoryOutputMode(
	program: Command,
	historyCmd: Command,
): CliOutputMode {
	return program.opts().json || historyCmd.opts().json ? "json" : "text";
}

export function registerHistoryCommand({
	program,
	io,
	setExitCode,
	setStartupTarget,
	isInteractiveTTY = () =>
		process.stdin.isTTY === true && process.stdout.isTTY === true,
}: RegisterHistoryCommandOptions): void {
	const historyCmd = program
		.command("history")
		.alias("h")
		.description("列出会话历史或管理已保存的会话")
		.option("--json", "以 JSON 格式输出")
		.option("--limit <count>", "要显示的最大会话数", "50")
		.option("--page <number>", "分页结果的页码")
		.option("--config <dir>", "配置目录")
		.action(async () => {
			const opts = historyCmd.opts();
			const limit = Number.parseInt(opts.limit, 10);
			const outputMode = resolveHistoryOutputMode(program, historyCmd);
			if (outputMode === "text" && isInteractiveTTY()) {
				setStartupTarget("history");
				return;
			}
			setExitCode(
				await runHistoryList({
					limit,
					outputMode,
					io,
				}),
			);
		});

	const historyDeleteCmd = historyCmd
		.command("delete")
		.description("从历史中删除会话")
		.option("--session-id <id>", "要删除的会话 ID")
		.action(async () => {
			const opts = historyDeleteCmd.opts();
			if (!opts.sessionId) {
				io.writeErr("history delete 需要 --session-id <id>");
				setExitCode(1);
				return;
			}
			const outputMode = resolveHistoryOutputMode(program, historyCmd);
			setExitCode(await runHistoryDelete(opts.sessionId, outputMode, io));
		});

	const historyUpdateCmd = historyCmd
		.command("update")
		.description("更新历史中的会话")
		.option("--metadata <json>", "作为 JSON 字符串的元数据")
		.option("--prompt <text>", "新的提示文本")
		.option("--session-id <id>", "要更新的会话 ID")
		.option("--title <text>", "新标题")
		.action(async () => {
			const opts = historyUpdateCmd.opts();
			if (!opts.sessionId) {
				io.writeErr("history update 需要 --session-id <id>");
				setExitCode(1);
				return;
			}
			const outputMode = resolveHistoryOutputMode(program, historyCmd);
			setExitCode(
				await runHistoryUpdate(
					opts.sessionId,
					opts.prompt,
					opts.title,
					opts.metadata,
					outputMode,
					io,
				),
			);
		});

	const historyExportCmd = historyCmd
		.command("export <sessionId>")
		.description("将会话导出为独立的 HTML 文件")
		.option("-o, --output <path>", "输出的 HTML 文件路径")
		.action(async (sessionId: string) => {
			const opts = historyExportCmd.opts();
			const outputMode = resolveHistoryOutputMode(program, historyCmd);
			setExitCode(
				await runHistoryExport(sessionId, opts.output, outputMode, io),
			);
		});
}
