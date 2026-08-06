import type { ChatEntry, InteractiveCompactionResult } from "../types";

export type CompactionDividerEntry = Extract<ChatEntry, { kind: "compaction" }>;

function formatMessageCount(count: number): string {
	return `${count} 条消息`;
}

function asFiniteNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

/**
 * Extracts a compaction divider entry from a status notice's metadata.
 * "started" notices produce a streaming (in-progress) divider; "completed"
 * notices produce the final divider with counters. Returns undefined for
 * non-compaction notices.
 */
export function parseCompactionNoticeMetadata(
	metadata: Record<string, unknown> | undefined,
): Omit<CompactionDividerEntry, "kind"> | undefined {
	if (
		!metadata ||
		(metadata.phase !== "started" &&
			metadata.phase !== "completed" &&
			metadata.phase !== "skipped")
	) {
		return undefined;
	}
	const kind = metadata.kind ?? metadata.reason;
	if (kind !== "auto_compaction" && kind !== "manual_compaction") {
		return undefined;
	}
	const compactionMode = kind === "manual_compaction" ? "manual" : "auto";
	if (metadata.phase === "started") {
		return { compactionMode, status: "started" };
	}
	if (metadata.phase === "skipped") {
		return { compactionMode, status: "skipped" };
	}
	return {
		compactionMode,
		status: "completed",
		tokensBefore: asFiniteNumber(metadata.tokensBefore),
		tokensAfter: asFiniteNumber(metadata.tokensAfter),
		messagesBefore: asFiniteNumber(metadata.messagesBefore),
		messagesAfter: asFiniteNumber(metadata.messagesAfter),
	};
}

export function formatTokenCount(count: number): string {
	if (count < 1_000) {
		return `${count}`;
	}
	if (count < 1_000_000) {
		return `${(count / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
	}
	return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

export function formatCompactionDividerLabel(
	entry: CompactionDividerEntry,
): string {
	if (entry.status === "started") {
		return entry.compactionMode === "manual"
			? "正在压缩消息"
			: "正在自动压缩消息";
	}
	if (entry.status === "failed") {
		return "压缩失败";
	}
	if (entry.status === "cancelled") {
		return "压缩已取消";
	}
	if (entry.status === "skipped") {
		return "压缩已跳过";
	}
	const parts: string[] = [
		entry.compactionMode === "manual"
			? "上下文已压缩（手动）"
			: entry.compactionMode === "inherited"
				? "工作上下文已延续压缩"
				: "上下文已压缩",
	];
	if (
		typeof entry.tokensBefore === "number" &&
		typeof entry.tokensAfter === "number"
	) {
		parts.push(
			`${formatTokenCount(entry.tokensBefore)} → ${formatTokenCount(entry.tokensAfter)} tokens`,
		);
	}
	if (
		typeof entry.messagesBefore === "number" &&
		typeof entry.messagesAfter === "number"
	) {
		parts.push(`${entry.messagesBefore} → ${entry.messagesAfter} messages`);
	}
	return parts.join(" · ");
}

export function formatCompactionStatus(
	result: InteractiveCompactionResult,
): string {
	if (result.messagesBefore === 0) {
		return "没有可压缩的消息。";
	}
	if (!result.compacted) {
		return "无需压缩。";
	}
	if (typeof result.workingContextMessagesAfter === "number") {
		return `工作上下文已压缩到 ${formatMessageCount(result.workingContextMessagesAfter)}；保存的历史记录仍为 ${formatMessageCount(result.messagesAfter)}。`;
	}
	if (result.messagesBefore === result.messagesAfter) {
		return `上下文已压缩；消息数保持在 ${formatMessageCount(result.messagesAfter)}。`;
	}
	return `已从 ${formatMessageCount(result.messagesBefore)} 压缩为 ${formatMessageCount(result.messagesAfter)}。`;
}
