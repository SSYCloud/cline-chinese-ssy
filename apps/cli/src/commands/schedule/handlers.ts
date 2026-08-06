import { CLINE_DEFAULT_MODEL_ID } from "@cline/shared";
import type { Command } from "commander";
import { ensureSchedulerHub } from "./client";
import {
	addAutonomousOptions,
	addDeliveryOptions,
	addSharedOptions,
	emitJsonOrText,
	formatResolvedAddressLabel,
	mergeScheduleMetadata,
	parseJsonObjectFlag,
	parseList,
	parseMode,
	resolveAddress,
	toPositiveInt,
} from "./common";
import {
	registerScheduleExportCommand,
	registerScheduleImportCommand,
	registerScheduleUpdateCommand,
} from "./import-export";
import type { CommandIo, ScheduleActionWrapper } from "./types";

export function registerScheduleCommands(
	schedule: Command,
	io: CommandIo,
	fail: () => void,
	action: ScheduleActionWrapper,
): void {
	const activeCmd = schedule
		.command("active")
		.description("显示当前活动中的执行");
	addSharedOptions(activeCmd);
	activeCmd.action(
		action(async () => {
			const opts = activeCmd.opts();
			const address = resolveAddress(opts.address);
			const ensured = await ensureSchedulerHub(address, process.cwd(), io);
			if (!ensured.ok) {
				io.writeErr(
					`无法确保 hub 服务器${formatResolvedAddressLabel(address)}`,
				);
				fail();
				return;
			}
			const client = ensured.client;
			try {
				const active = await client.getActiveScheduledExecutions();
				emitJsonOrText(!!opts.json, io, active);
			} finally {
				client.close();
			}
		}),
	);

	const createCmd = schedule
		.command("create")
		.description("创建新计划")
		.argument("<name>", "计划名称")
		.requiredOption("--cron <pattern>", "Cron 表达式")
		.requiredOption("--prompt <text>", "任务提示")
		.requiredOption("--workspace <path>", "工作区根路径")
		.option("--created-by <name>", "创建者名称")
		.option("--cwd <path>", "工作目录")
		.option("--disabled", "以禁用状态创建")
		.option("--max-parallel <n>", "最大并行执行数", "1")
		.option("--metadata-json <json>", "元数据（JSON 对象）")
		.option("--mode <act|plan|yolo>", "执行模式", "yolo")
		.option("--model <model>", "使用的模型", CLINE_DEFAULT_MODEL_ID)
		.option("--provider <id>", "提供方 ID", "cline")
		.option("--system-prompt <text>", "系统提示覆盖")
		.option("--tags <list>", "逗号分隔的标签")
		.option("--timeout <seconds>", "超时秒数");
	addDeliveryOptions(createCmd);
	addAutonomousOptions(createCmd);
	addSharedOptions(createCmd);
	createCmd.action(
		action(async (name: string) => {
			const opts = createCmd.opts();
			const address = resolveAddress(opts.address);
			const ensured = await ensureSchedulerHub(address, opts.workspace, io);
			if (!ensured.ok) {
				io.writeErr(
					`无法确保 hub 服务器${formatResolvedAddressLabel(address)}`,
				);
				fail();
				return;
			}
			const client = ensured.client;
			try {
				const metadata = mergeScheduleMetadata(
					parseJsonObjectFlag(opts.metadataJson),
					opts,
				);
				const created = await client.createSchedule({
					name,
					cronPattern: opts.cron,
					prompt: opts.prompt,
					provider: opts.provider,
					model: opts.model,
					mode: parseMode(opts.mode) ?? "yolo",
					workspaceRoot: opts.workspace,
					cwd: opts.cwd,
					systemPrompt: opts.systemPrompt,
					timeoutSeconds: opts.timeout
						? toPositiveInt(opts.timeout, 1)
						: undefined,
					maxParallel: toPositiveInt(opts.maxParallel, 1),
					enabled: !opts.disabled,
					createdBy: opts.createdBy,
					tags: parseList(opts.tags),
					metadata,
				});
				if (!created) {
					io.writeErr("创建计划失败");
					fail();
					return;
				}
				emitJsonOrText(!!opts.json, io, created);
			} finally {
				client.close();
			}
		}),
	);

	const deleteCmd = schedule
		.command("delete")
		.description("删除计划")
		.argument("<schedule-id>", "计划 ID");
	addSharedOptions(deleteCmd);
	deleteCmd.action(
		action(async (scheduleId: string) => {
			const opts = deleteCmd.opts();
			const address = resolveAddress(opts.address);
			const ensured = await ensureSchedulerHub(address, process.cwd(), io);
			if (!ensured.ok) {
				io.writeErr(
					`无法确保 hub 服务器${formatResolvedAddressLabel(address)}`,
				);
				fail();
				return;
			}
			const client = ensured.client;
			try {
				const deleted = await client.deleteSchedule(scheduleId);
				emitJsonOrText(!!opts.json, io, { deleted });
				if (!deleted) fail();
			} finally {
				client.close();
			}
		}),
	);

	const getCmd = schedule
		.command("get")
		.description("按 ID 获取计划")
		.argument("<schedule-id>", "计划 ID");
	addSharedOptions(getCmd);
	getCmd.action(
		action(async (scheduleId: string) => {
			const opts = getCmd.opts();
			const address = resolveAddress(opts.address);
			const ensured = await ensureSchedulerHub(address, process.cwd(), io);
			if (!ensured.ok) {
				io.writeErr(
					`无法确保 hub 服务器${formatResolvedAddressLabel(address)}`,
				);
				fail();
				return;
			}
			const client = ensured.client;
			try {
				const result = await client.getSchedule(scheduleId);
				if (!result) {
					io.writeErr(`未找到计划: ${scheduleId}`);
					fail();
					return;
				}
				emitJsonOrText(!!opts.json, io, result);
			} finally {
				client.close();
			}
		}),
	);

	const historyCmd = schedule
		.command("history")
		.description("显示计划的执行历史")
		.argument("<schedule-id>", "计划 ID")
		.option("--limit <n>", "最大结果数", "20")
		.option("--status <status>", "按执行状态筛选");
	addSharedOptions(historyCmd);
	historyCmd.action(
		action(async (scheduleId: string) => {
			const opts = historyCmd.opts();
			const address = resolveAddress(opts.address);
			const ensured = await ensureSchedulerHub(address, process.cwd(), io);
			if (!ensured.ok) {
				io.writeErr(
					`无法确保 hub 服务器${formatResolvedAddressLabel(address)}`,
				);
				fail();
				return;
			}
			const client = ensured.client;
			try {
				const executions = await client.listScheduleExecutions({
					scheduleId,
					status: opts.status,
					limit: toPositiveInt(opts.limit, 20),
				});
				emitJsonOrText(!!opts.json, io, executions);
			} finally {
				client.close();
			}
		}),
	);

	const listCmd = schedule
		.command("list")
		.description("列出计划")
		.option("--disabled", "仅显示禁用的计划")
		.option("--enabled", "仅显示启用的计划")
		.option("--limit <n>", "最大结果数", "100")
		.option("--tags <list>", "按逗号分隔的标签筛选");
	addSharedOptions(listCmd);
	listCmd.action(
		action(async () => {
			const opts = listCmd.opts();
			const address = resolveAddress(opts.address);
			const ensured = await ensureSchedulerHub(address, process.cwd(), io);
			if (!ensured.ok) {
				io.writeErr(
					`无法确保 hub 服务器${formatResolvedAddressLabel(address)}`,
				);
				fail();
				return;
			}
			const client = ensured.client;
			try {
				const enabled = opts.enabled ? true : opts.disabled ? false : undefined;
				const schedules = await client.listSchedules({
					limit: toPositiveInt(opts.limit, 100),
					enabled,
					tags: parseList(opts.tags),
				});
				if (!opts.json && Array.isArray(schedules) && schedules.length === 0) {
					io.writeln("未找到计划。");
					return;
				}
				emitJsonOrText(!!opts.json, io, schedules);
			} finally {
				client.close();
			}
		}),
	);

	const pauseCmd = schedule
		.command("pause")
		.description("暂停计划")
		.argument("<schedule-id>", "计划 ID");
	addSharedOptions(pauseCmd);
	pauseCmd.action(
		action(async (scheduleId: string) => {
			const opts = pauseCmd.opts();
			const address = resolveAddress(opts.address);
			const ensured = await ensureSchedulerHub(address, process.cwd(), io);
			if (!ensured.ok) {
				io.writeErr(
					`无法确保 hub 服务器${formatResolvedAddressLabel(address)}`,
				);
				fail();
				return;
			}
			const client = ensured.client;
			try {
				const result = await client.pauseSchedule(scheduleId);
				if (!result) {
					io.writeErr(`未找到计划: ${scheduleId}`);
					fail();
					return;
				}
				emitJsonOrText(!!opts.json, io, result);
			} finally {
				client.close();
			}
		}),
	);

	const resumeCmd = schedule
		.command("resume")
		.description("恢复计划")
		.argument("<schedule-id>", "计划 ID");
	addSharedOptions(resumeCmd);
	resumeCmd.action(
		action(async (scheduleId: string) => {
			const opts = resumeCmd.opts();
			const address = resolveAddress(opts.address);
			const ensured = await ensureSchedulerHub(address, process.cwd(), io);
			if (!ensured.ok) {
				io.writeErr(
					`无法确保 hub 服务器${formatResolvedAddressLabel(address)}`,
				);
				fail();
				return;
			}
			const client = ensured.client;
			try {
				const result = await client.resumeSchedule(scheduleId);
				if (!result) {
					io.writeErr(`未找到计划: ${scheduleId}`);
					fail();
					return;
				}
				emitJsonOrText(!!opts.json, io, result);
			} finally {
				client.close();
			}
		}),
	);

	const statsCmd = schedule
		.command("stats")
		.description("显示计划的统计信息")
		.argument("<schedule-id>", "计划 ID");
	addSharedOptions(statsCmd);
	statsCmd.action(
		action(async (scheduleId: string) => {
			const opts = statsCmd.opts();
			const address = resolveAddress(opts.address);
			const ensured = await ensureSchedulerHub(address, process.cwd(), io);
			if (!ensured.ok) {
				io.writeErr(
					`无法确保 hub 服务器${formatResolvedAddressLabel(address)}`,
				);
				fail();
				return;
			}
			const client = ensured.client;
			try {
				const stats = await client.getScheduleStats(scheduleId);
				emitJsonOrText(!!opts.json, io, stats);
			} finally {
				client.close();
			}
		}),
	);

	const triggerCmd = schedule
		.command("trigger")
		.description("立即触发计划")
		.argument("<schedule-id>", "计划 ID");
	addSharedOptions(triggerCmd);
	triggerCmd.action(
		action(async (scheduleId: string) => {
			const opts = triggerCmd.opts();
			const address = resolveAddress(opts.address);
			const ensured = await ensureSchedulerHub(address, process.cwd(), io);
			if (!ensured.ok) {
				io.writeErr(
					`无法确保 hub 服务器${formatResolvedAddressLabel(address)}`,
				);
				fail();
				return;
			}
			const client = ensured.client;
			try {
				const execution = await client.triggerScheduleNow(scheduleId);
				if (!execution) {
					io.writeErr(`未找到计划: ${scheduleId}`);
					fail();
					return;
				}
				emitJsonOrText(!!opts.json, io, execution);
			} finally {
				client.close();
			}
		}),
	);

	const upcomingCmd = schedule
		.command("upcoming")
		.description("显示即将进行的计划运行")
		.option("--limit <n>", "最大结果数", "20");
	addSharedOptions(upcomingCmd);
	upcomingCmd.action(
		action(async () => {
			const opts = upcomingCmd.opts();
			const address = resolveAddress(opts.address);
			const ensured = await ensureSchedulerHub(address, process.cwd(), io);
			if (!ensured.ok) {
				io.writeErr(
					`无法确保 hub 服务器${formatResolvedAddressLabel(address)}`,
				);
				fail();
				return;
			}
			const client = ensured.client;
			try {
				const runs = await client.getUpcomingScheduledRuns(
					toPositiveInt(opts.limit, 20),
				);
				emitJsonOrText(!!opts.json, io, runs);
			} finally {
				client.close();
			}
		}),
	);

	registerScheduleExportCommand(schedule, io, fail, action);
	registerScheduleImportCommand(schedule, io, fail, action);
	registerScheduleUpdateCommand(schedule, io, fail, action);
}
