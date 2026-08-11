import * as p from "@clack/prompts";
import {
	ensureSchedulerHub,
	type HubScheduleClient,
} from "../../commands/schedule/client";
import { resolveAddress } from "../../commands/schedule/common";
import { resolveScheduleModelSelection } from "../../commands/schedule/model-selection";
import { CRON_PRESETS } from "./cron-presets";

function isCancel(value: unknown): value is symbol {
	return p.isCancel(value);
}

interface ScheduleRecord {
	scheduleId: string;
	name: string;
	cronPattern: string;
	prompt: string;
	enabled: boolean;
	nextRunAt?: number;
}

interface ExecutionRecord {
	executionId: string;
	scheduleId: string;
	status: string;
	triggeredAt?: number;
	startedAt?: number;
	endedAt?: number;
	tokensUsed?: number;
	costUsd?: number;
}

interface ScheduleStats {
	totalRuns: number;
	successRate: number;
	avgDurationSeconds: number;
	lastFailure?: { errorMessage?: string };
}

interface UpcomingRun {
	name: string;
	nextRunAt: number;
}

function formatSchedule(s: ScheduleRecord): string {
	const status = s.enabled ? "已启用" : "已暂停";
	const next = s.nextRunAt
		? `下次：${new Date(s.nextRunAt).toLocaleString()}`
		: "";
	return `${s.name} (${s.cronPattern}) [${status}]${next ? ` ${next}` : ""}`;
}

async function pickSchedule(
	client: HubScheduleClient,
	message: string,
): Promise<string | null> {
	const schedules = (await client.listSchedules({})) as ScheduleRecord[];
	if (!schedules || schedules.length === 0) {
		p.log.warn("未找到任何计划");
		return null;
	}

	const choice = await p.select({
		message,
		options: schedules.map((s) => ({
			value: s.scheduleId,
			label: s.name,
			hint: `${s.cronPattern} [${s.enabled ? "已启用" : "已暂停"}]`,
		})),
	});

	if (isCancel(choice)) return null;
	return choice as string;
}

async function actionCreate(client: HubScheduleClient): Promise<void> {
	const name = await p.text({
		message: "计划名称",
		placeholder: "nightly-cleanup",
		validate: (v) => {
			if (!v?.trim()) return "名称是必填项";
			return undefined;
		},
	});
	if (isCancel(name)) return;

	const cronChoice = await p.select({
		message: "它应该多久运行一次？",
		options: CRON_PRESETS.map((preset) => ({
			value: preset.value,
			label: preset.label,
			hint: preset.hint,
		})),
	});
	if (isCancel(cronChoice)) return;

	let cronPattern = cronChoice as string;
	if (cronPattern === "__custom__") {
		const custom = await p.text({
			message: "Cron 表达式（分 时 日 月 星期）",
			placeholder: "0 */6 * * *",
			validate: (v) => {
				if (!v?.trim()) return "Cron 表达式是必填项";
				const parts = v.trim().split(/\s+/);
				if (parts.length !== 5)
					return "必须为 5 个字段：分 时 日 月 星期";
				return undefined;
			},
		});
		if (isCancel(custom)) return;
		cronPattern = (custom as string).trim();
	}

	const prompt = await p.text({
		message: "Cline 应该做什么？",
		placeholder: "审查打开的 PR 并发布摘要",
		validate: (v) => {
			if (!v?.trim()) return "提示词是必填项";
			return undefined;
		},
	});
	if (isCancel(prompt)) return;

	const workspace = await p.text({
		message: "工作区路径",
		placeholder: process.cwd(),
		initialValue: process.cwd(),
		validate: (v) => {
			if (!v?.trim()) return "工作区路径是必填项";
			return undefined;
		},
	});
	if (isCancel(workspace)) return;

	const mode = await p.select({
		message: "代理模式",
		options: [
			{ value: "yolo", label: "Yolo", hint: "无需批准直接执行" },
			{ value: "act", label: "执行", hint: "执行任务" },
			{ value: "plan", label: "规划", hint: "仅规划" },
		],
		initialValue: "yolo",
	});
	if (isCancel(mode)) return;

	const wantAdvanced = await p.confirm({
		message: "是否配置高级选项？",
		initialValue: false,
	});
	if (isCancel(wantAdvanced)) return;

	let provider: string | undefined;
	let model: string | undefined;
	let systemPrompt: string | undefined;
	let timeout: number | undefined;
	let maxIterations: number | undefined;
	let tags: string[] | undefined;

	if (wantAdvanced) {
		const advanced = await p.group({
			provider: () =>
				p.text({
					message: "提供商",
					placeholder: "留空使用默认值",
				}),
			model: () =>
				p.text({
					message: "模型",
					placeholder: "留空使用默认值",
				}),
			systemPrompt: () =>
				p.text({
					message: "系统提示词覆盖",
					placeholder: "留空使用默认值",
				}),
			timeout: () =>
				p.text({
					message: "超时（秒）",
					placeholder: "留空表示无超时",
				}),
			maxIterations: () =>
				p.text({
					message: "最大迭代次数",
					placeholder: "留空表示无限制",
				}),
			tags: () =>
				p.text({
					message: "标签（逗号分隔）",
					placeholder: "cleanup, nightly",
				}),
		});
		if (isCancel(advanced)) return;

		provider = advanced.provider?.trim() || undefined;
		model = advanced.model?.trim() || undefined;
		systemPrompt = advanced.systemPrompt?.trim() || undefined;
		if (advanced.timeout?.trim()) {
			const n = Number.parseInt(advanced.timeout.trim(), 10);
			if (n > 0) timeout = n;
		}
		if (advanced.maxIterations?.trim()) {
			const n = Number.parseInt(advanced.maxIterations.trim(), 10);
			if (n > 0) maxIterations = n;
		}
		if (advanced.tags?.trim()) {
			tags = advanced.tags
				.split(",")
				.map((t) => t.trim())
				.filter(Boolean);
		}
	}

	const modelSelection = resolveScheduleModelSelection({ provider, model });
	const created = (await client.createSchedule({
		name: (name as string).trim(),
		cronPattern,
		prompt: (prompt as string).trim(),
		provider: modelSelection.provider,
		model: modelSelection.model,
		mode: mode as "act" | "plan" | "yolo",
		workspaceRoot: (workspace as string).trim(),
		systemPrompt,
		maxIterations,
		timeoutSeconds: timeout,
		maxParallel: 1,
		enabled: true,
		tags,
	})) as ScheduleRecord | undefined;

	if (!created) {
		p.log.error("创建计划失败");
		return;
	}

	p.log.success(`已创建：${created.name} (${created.scheduleId})`);
	if (created.nextRunAt) {
		p.log.info(`下次运行：${new Date(created.nextRunAt).toLocaleString()}`);
	}
}

async function actionList(client: HubScheduleClient): Promise<void> {
	const schedules = (await client.listSchedules({})) as ScheduleRecord[];
	if (!schedules || schedules.length === 0) {
		p.log.info("未配置任何计划");
		return;
	}
	for (const s of schedules) {
		p.log.info(formatSchedule(s));
		p.log.message(`  ID：${s.scheduleId}`);
		p.log.message(
			`  提示词：${s.prompt.slice(0, 80)}${s.prompt.length > 80 ? "..." : ""}`,
		);
	}
}

async function actionPause(client: HubScheduleClient): Promise<void> {
	const id = await pickSchedule(client, "选择要暂停的计划");
	if (!id) return;
	const result = (await client.pauseSchedule(id)) as ScheduleRecord | undefined;
	if (result) {
		p.log.success(`已暂停：${result.name}`);
	} else {
		p.log.error("暂停计划失败");
	}
}

async function actionResume(client: HubScheduleClient): Promise<void> {
	const id = await pickSchedule(client, "选择要恢复的计划");
	if (!id) return;
	const result = (await client.resumeSchedule(id)) as
		| ScheduleRecord
		| undefined;
	if (result) {
		p.log.success(`已恢复：${result.name}`);
		if (result.nextRunAt) {
			p.log.info(`下次运行：${new Date(result.nextRunAt).toLocaleString()}`);
		}
	} else {
		p.log.error("恢复计划失败");
	}
}

async function actionTrigger(client: HubScheduleClient): Promise<void> {
	const id = await pickSchedule(client, "选择要立即触发的计划");
	if (!id) return;
	const execution = (await client.triggerScheduleNow(id)) as
		| ExecutionRecord
		| undefined;
	if (execution) {
		p.log.success(`已触发：${execution.executionId}`);
	} else {
		p.log.error("触发计划失败");
	}
}

async function actionDelete(client: HubScheduleClient): Promise<void> {
	const id = await pickSchedule(client, "选择要删除的计划");
	if (!id) return;

	const confirm = await p.confirm({
		message: "确定要删除此计划吗？",
		initialValue: false,
	});
	if (isCancel(confirm) || !confirm) return;

	const deleted = await client.deleteSchedule(id);
	if (deleted) {
		p.log.success("计划已删除");
	} else {
		p.log.error("删除计划失败");
	}
}

async function actionHistory(client: HubScheduleClient): Promise<void> {
	const id = await pickSchedule(client, "选择要查看历史的计划");
	if (!id) return;

	const executions = (await client.listScheduleExecutions({
		scheduleId: id,
		limit: 20,
	})) as ExecutionRecord[];
	if (!executions || executions.length === 0) {
		p.log.info("没有执行历史");
		return;
	}
	for (const exec of executions) {
		const duration =
			exec.startedAt && exec.endedAt
				? `${((new Date(exec.endedAt).getTime() - new Date(exec.startedAt).getTime()) / 1000).toFixed(0)}s`
				: "";
		const tokens = exec.tokensUsed != null ? `${exec.tokensUsed} tokens` : "";
		const cost = exec.costUsd != null ? `$${exec.costUsd.toFixed(4)}` : "";
		const details = [duration, tokens, cost].filter(Boolean).join(" / ");
		const time = exec.triggeredAt
			? new Date(exec.triggeredAt).toLocaleString()
			: "";
		p.log.info(`${time} [${exec.status}]${details ? ` ${details}` : ""}`);
	}
}

async function actionStats(client: HubScheduleClient): Promise<void> {
	const id = await pickSchedule(client, "选择要查看统计信息的计划");
	if (!id) return;

	const stats = (await client.getScheduleStats(id)) as ScheduleStats;
	p.log.info(`总运行次数：${stats.totalRuns}`);
	p.log.info(`成功率：${(stats.successRate * 100).toFixed(1)}%`);
	p.log.info(`平均时长：${stats.avgDurationSeconds.toFixed(0)}s`);
	if (stats.lastFailure) {
		p.log.warn(
			`上次失败：${stats.lastFailure.errorMessage ?? "未知错误"}`,
		);
	}
}

async function actionActive(client: HubScheduleClient): Promise<void> {
	const active = (await client.getActiveScheduledExecutions()) as
		| ExecutionRecord[]
		| undefined;
	if (!active || active.length === 0) {
		p.log.info("没有正在运行的执行");
		return;
	}
	for (const exec of active) {
		const started = exec.startedAt
			? new Date(exec.startedAt).toLocaleString()
			: "";
		p.log.info(
			`${exec.executionId}（计划：${exec.scheduleId}）于 ${started} 开始`,
		);
	}
}

async function actionUpcoming(client: HubScheduleClient): Promise<void> {
	const upcoming = (await client.getUpcomingScheduledRuns(10)) as
		| UpcomingRun[]
		| undefined;
	if (!upcoming || upcoming.length === 0) {
		p.log.info("没有即将运行的计划");
		return;
	}
	for (const run of upcoming) {
		const time = new Date(run.nextRunAt).toLocaleString();
		p.log.info(`${run.name} - ${time}`);
	}
}

export async function runScheduleWizard(): Promise<number> {
	p.intro("计划任务");

	const s = p.spinner();
	s.start("正在连接中心服务器...");

	const address = resolveAddress(process.env.CLINE_HUB_ADDRESS);
	const ensured = await ensureSchedulerHub(address, process.cwd(), {
		writeln: (text?: string) => {
			process.stdout.write(`${text ?? ""}\n`);
		},
		writeErr: (text: string) => {
			process.stderr.write(`${text}\n`);
		},
	});
	if (!ensured.ok) {
		s.stop("无法连接到中心服务器");
		p.log.error(
			"计划需要中心服务器。使用以下命令启动：cline hub start",
		);
		p.outro("失败");
		return 1;
	}
	s.stop("已连接");

	const client = ensured.client;

	try {
		let keepGoing = true;
		while (keepGoing) {
			const action = await p.select({
				message: "你想做什么？",
				options: [
					{
						value: "create",
						label: "创建新计划",
						hint: "设置一个定期任务",
					},
					{
						value: "list",
						label: "列出计划",
						hint: "查看所有已配置的计划",
					},
					{
						value: "upcoming",
						label: "即将运行",
						hint: "查看接下来运行什么",
					},
					{
						value: "active",
						label: "正在执行的运行",
						hint: "查看当前正在运行什么",
					},
					{
						value: "trigger",
						label: "立即触发",
						hint: "立即运行一个计划",
					},
					{
						value: "pause",
						label: "暂停计划",
					},
					{
						value: "resume",
						label: "恢复计划",
					},
					{
						value: "history",
						label: "执行历史",
						hint: "查看过去的运行",
					},
					{
						value: "stats",
						label: "统计信息",
						hint: "成功率、时长等。",
					},
					{
						value: "delete",
						label: "删除计划",
					},
					{
						value: "exit",
						label: "退出",
					},
				],
			});

			if (isCancel(action) || action === "exit") {
				keepGoing = false;
				continue;
			}

			try {
				switch (action) {
					case "create":
						await actionCreate(client);
						break;
					case "list":
						await actionList(client);
						break;
					case "pause":
						await actionPause(client);
						break;
					case "resume":
						await actionResume(client);
						break;
					case "trigger":
						await actionTrigger(client);
						break;
					case "delete":
						await actionDelete(client);
						break;
					case "history":
						await actionHistory(client);
						break;
					case "stats":
						await actionStats(client);
						break;
					case "active":
						await actionActive(client);
						break;
					case "upcoming":
						await actionUpcoming(client);
						break;
				}
			} catch (err) {
				p.log.error(err instanceof Error ? err.message : String(err));
			}
		}

		p.outro("完成");
		return 0;
	} finally {
		client.close();
	}
}
