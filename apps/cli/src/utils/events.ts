import type { AgentEvent, TeamEvent } from "@cline/core";
import {
	formatCompactionDividerLabel,
	parseCompactionNoticeMetadata,
} from "../tui/utils/compaction-status";
import { formatCliErrorMessage } from "./cline-pass-errors";
import { materializeGeneratedMedia } from "./generated-media";
import { formatToolInput, formatToolOutput, truncate } from "./helpers";
import {
	c,
	emitJsonLine,
	getCurrentOutputMode,
	write,
	writeErr,
} from "./output";
import type { Config } from "./types";

// =============================================================================
// Inline stream state
// =============================================================================

let activeInlineStream: "text" | "reasoning" | undefined;
let inlineStreamHasOutput = false;
let shouldPrefixNextTextWithBlankLine = false;

// Prefix for result rows
const HOOK = "⎿ ";
const TEAM_RUN_ACTIVE_SUFFIX = `${c.dim} ...${c.reset}`;

export function resolveStatusNoticeLabel(
	event: AgentEvent,
): string | undefined {
	if (event.type !== "notice" || event.displayRole !== "status") {
		return undefined;
	}
	const compaction = parseCompactionNoticeMetadata(event.metadata);
	if (compaction) {
		return formatCompactionDividerLabel({ kind: "compaction", ...compaction });
	}
	return resolveNonCompactionStatusLabel(event);
}

/**
 * Label for a status notice already known not to be a compaction notice.
 * Callers that have parsed the compaction metadata themselves use this to
 * avoid re-parsing.
 */
export function resolveNonCompactionStatusLabel(
	event: AgentEvent,
): string | undefined {
	if (event.type !== "notice" || event.displayRole !== "status") {
		return undefined;
	}
	switch (event.reason) {
		case "auto_compaction":
			return "自动压缩中";
		case "manual_compaction":
			return "压缩中";
		case "compaction_budget_emergency":
			return "上下文预算已调整";
	}
	return event.message.trim() || undefined;
}

export function closeInlineStreamIfNeeded(): void {
	if (!inlineStreamHasOutput) {
		return;
	}
	write("\n");
	activeInlineStream = undefined;
	inlineStreamHasOutput = false;
}

// Used by team events that arrive while the lead agent is mid-stream. Ends the
// current visual line so the team event prints cleanly, but keeps
// activeInlineStream set so the next text chunk continues on a new line without
// re-emitting any prefix.
function breakLineIfStreaming(): void {
	if (activeInlineStream === "text" && inlineStreamHasOutput) {
		write("\n");
		inlineStreamHasOutput = false;
	}
}

// =============================================================================
// Agent event handler
// =============================================================================

function formatResultLines(text: string, maxLines = 5): string[] {
	const lines = text.split("\n");
	if (lines.length <= maxLines) return lines;
	return [
		...lines.slice(0, maxLines),
		`... 还有 ${lines.length - maxLines} 行`,
	];
}

export function handleEvent(event: AgentEvent, config: Config): void {
	if (getCurrentOutputMode() === "json") {
		emitJsonLine("stdout", { type: "agent_event", event });
		return;
	}

	switch (event.type) {
		case "iteration_start":
			closeInlineStreamIfNeeded();
			break;

		case "iteration_end":
			closeInlineStreamIfNeeded();
			break;

		case "content_start":
			switch (event.contentType) {
				case "text":
					if (activeInlineStream !== "text") {
						closeInlineStreamIfNeeded();
						if (shouldPrefixNextTextWithBlankLine) {
							write("\n");
							shouldPrefixNextTextWithBlankLine = false;
						}
						activeInlineStream = "text";
					}
					write(event.text ?? "");
					inlineStreamHasOutput = true;
					break;
				case "reasoning":
					if (activeInlineStream !== "reasoning") {
						closeInlineStreamIfNeeded();
						write(`${c.dim}[思考中] ${c.reset}`);
						activeInlineStream = "reasoning";
						inlineStreamHasOutput = true;
					}
					if (event.redacted && !event.reasoning) {
						write(`${c.dim}[已隐藏]${c.reset}`);
						inlineStreamHasOutput = true;
						break;
					}
					write(`${c.dim}${event.reasoning ?? ""}${c.reset}`);
					inlineStreamHasOutput = true;
					break;
				case "tool": {
					closeInlineStreamIfNeeded();
					const toolName = event.toolName ?? "unknown_tool";
					const inputStr = formatToolInput(toolName, event.input);
					if (toolName === "ask_question") {
						break;
					}
					write(
						`${c.cyan}[${toolName}]${c.reset}${inputStr ? ` ${inputStr}` : ""}\n`,
					);
					break;
				}
			}
			break;

		case "content_end":
			switch (event.contentType) {
				case "text":
				case "reasoning":
					closeInlineStreamIfNeeded();
					break;
				case "tool":
					closeInlineStreamIfNeeded();
					if (event.toolName === "ask_question") {
						break;
					}
					if (event.error) {
						write(
							`   ${c.gray}${HOOK}${c.reset}${c.red}错误: ${event.error}${c.reset}\n`,
						);
					} else {
						const outputStr = formatToolOutput(event.output);
						if (outputStr) {
							const lines = formatResultLines(outputStr);
							for (let i = 0; i < lines.length; i++) {
								const prefix = i === 0 ? HOOK : "  ";
								write(
									`   ${c.gray}${prefix}${c.reset}${c.dim}${lines[i]}${c.reset}\n`,
								);
							}
						} else {
							write(`   ${c.gray}${HOOK}${c.reset}${c.green}成功${c.reset}\n`);
						}
					}
					shouldPrefixNextTextWithBlankLine = false;
					break;
				case "media": {
					closeInlineStreamIfNeeded();
					const media = event.media;
					if (!media) break;
					const saved = materializeGeneratedMedia(media);
					if (saved) {
						write(
							`${c.dim}[generated ${media.modality}]${c.reset} ${saved.path}\n`,
						);
					} else if (media.source.type === "url") {
						write(
							`${c.dim}[generated ${media.modality}]${c.reset} ${media.source.url}\n`,
						);
					} else if (media.source.type === "artifact") {
						write(
							`${c.dim}[generated ${media.modality}]${c.reset} artifact:${media.source.artifactId}\n`,
						);
					} else {
						write(
							`${c.dim}[generated ${media.modality}]${c.reset} ${media.mediaType} could not be saved\n`,
						);
					}
					break;
				}
			}
			break;

		case "done": {
			closeInlineStreamIfNeeded();
			if (config.verbose) {
				const iterations = event.iterations;
				const label = event.reason === "aborted" ? "已中止" : "已完成";
				write(
					`\n${c.dim}── ${label} (${iterations} 次迭代) ──${c.reset}\n`,
				);
			}
			activeInlineStream = undefined;
			inlineStreamHasOutput = false;
			shouldPrefixNextTextWithBlankLine = false;
			break;
		}
		case "error":
			closeInlineStreamIfNeeded();
			if (!event.recoverable || config.verbose) {
				writeErr(
					formatCliErrorMessage(event.error, { modelId: config.modelId }),
				);
			}
			break;
		case "notice":
			if (event.displayRole === "status") {
				closeInlineStreamIfNeeded();
				const label = resolveStatusNoticeLabel(event);
				if (label) {
					write(`\n${c.dim}[状态]${c.reset} ${label}\n`);
				}
			}
			break;
	}
}

// =============================================================================
// Team event handler
// =============================================================================

export function handleTeamEvent(event: TeamEvent): void {
	if (getCurrentOutputMode() === "json") {
		emitJsonLine("stdout", { type: "team_event", event });
		return;
	}
	// Skip heartbeat events to avoid cluttering the CLI with too many messages,
	// since they can be emitted frequently during long-running tasks.
	if (event.type === "run_progress" && event.message === "heartbeat") {
		return;
	}

	breakLineIfStreaming();
	if (activeInlineStream !== "text") {
		closeInlineStreamIfNeeded();
	}

	switch (event.type) {
		case "teammate_spawned":
			write(
				`${c.dim}[团队] 团队成员已生成:${c.reset} ${c.cyan}${event.agentId}${c.reset}\n`,
			);
			break;
		case "teammate_shutdown":
			write(
				`${c.dim}[团队] 团队成员已关闭:${c.reset} ${c.cyan}${event.agentId}${c.reset}\n`,
			);
			break;
		case "team_task_updated":
			write(
				`${c.dim}[团队任务]${c.reset} ${c.cyan}${event.task.id}${c.reset} -> ${event.task.status}\n`,
			);
			break;
		case "team_message":
			write(
				`${c.dim}[邮箱]${c.reset} ${event.message.fromAgentId} -> ${event.message.toAgentId}: ${event.message.subject}\n`,
			);
			break;
		case "team_mission_log":
			write(
				`${c.dim}[任务]${c.reset} ${event.entry.agentId}: ${truncate(event.entry.summary, 90)}\n`,
			);
			break;
		case "run_queued":
			write(
				`${c.dim}[团队运行]${c.reset} 已排队 ${c.cyan}${event.run.id}${c.reset} -> ${event.run.agentId}${TEAM_RUN_ACTIVE_SUFFIX}\n`,
			);
			break;
		case "run_started":
			write(
				`${c.dim}[团队运行]${c.reset} 已开始 ${c.cyan}${event.run.id}${c.reset} -> ${event.run.agentId}${TEAM_RUN_ACTIVE_SUFFIX}\n`,
			);
			break;
		case "run_progress":
			write(
				`${c.dim}[团队运行]${c.reset} 进度 ${c.cyan}${event.run.id}${c.reset}: ${event.message}\n`,
			);
			break;
		case "run_completed":
			write(
				`${c.dim}[团队运行]${c.reset} 已完成 ${c.cyan}${event.run.id}${c.reset}\n`,
			);
			break;
		case "run_failed":
			write(
				`${c.dim}[团队运行]${c.reset} 失败 ${c.cyan}${event.run.id}${c.reset}: ${event.run.error ?? "未知错误"}\n`,
			);
			break;
		case "run_cancelled":
			write(
				`${c.dim}[团队运行]${c.reset} 已取消 ${c.cyan}${event.run.id}${c.reset}\n`,
			);
			break;
		case "run_interrupted":
			write(
				`${c.dim}[团队运行]${c.reset} 已中断 ${c.cyan}${event.run.id}${c.reset}\n`,
			);
			break;
		case "outcome_created":
			write(
				`${c.dim}[团队结果]${c.reset} 已创建 ${c.cyan}${event.outcome.id}${c.reset}: ${event.outcome.title}\n`,
			);
			break;
		case "outcome_fragment_attached":
			write(
				`${c.dim}[团队结果]${c.reset} 片段 ${c.cyan}${event.fragment.id}${c.reset} 已附加到 ${event.fragment.section}\n`,
			);
			break;
		case "outcome_fragment_reviewed":
			write(
				`${c.dim}[团队结果]${c.reset} 片段 ${c.cyan}${event.fragment.id}${c.reset} -> ${event.fragment.status}\n`,
			);
			break;
		case "outcome_finalized":
			write(
				`${c.dim}[团队结果]${c.reset} 已完成 ${c.cyan}${event.outcome.id}${c.reset}\n`,
			);
			break;
		case "task_start":
			break;
		case "task_end":
			break;
		case "agent_event":
			break;
	}
}
