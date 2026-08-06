export interface MistakeLimitContext {
	iteration: number;
	consecutiveMistakes: number;
	maxConsecutiveMistakes: number;
	reason: "api_error" | "invalid_tool_call" | "tool_execution_failed";
	details?: string;
}

export function createMistakeLimitDecisionResolver(input: {
	autoApproveAllRef: { current: boolean };
	askQuestionRef: {
		current: ((question: string, options: string[]) => Promise<string>) | null;
	};
}) {
	return async (context: MistakeLimitContext) => {
		if (input.autoApproveAllRef.current) {
			return {
				action: "stop" as const,
				reason: `在 yolo 模式下达到最大连续错误次数（${context.maxConsecutiveMistakes}）`,
			};
		}
		const detail = context.details?.trim();
		const summary = detail
			? `${context.reason}: ${detail}`
			: `${context.reason} at iteration ${context.iteration}`;
		const questionText = `已达到连续错误上限 (${context.consecutiveMistakes}/${context.maxConsecutiveMistakes})\n最新：${summary}\nCline 应如何继续？`;
		const questionOptions = ["尝试不同的方法", "停止本次运行"];
		const answer = input.askQuestionRef.current
			? await input.askQuestionRef.current(questionText, questionOptions)
			: (questionOptions[0] ?? "");
		const normalized = answer.trim().toLowerCase();
		if (
			normalized === "2" ||
			normalized === "停止本次运行" ||
			normalized === "stop this run" ||
			normalized === "停止" ||
			normalized === "stop" ||
			normalized === "n" ||
			normalized === "no"
		) {
			return {
				action: "stop" as const,
				reason: "在达到连续错误上限提示后已停止",
			};
		}
		if (
			normalized === "1" ||
			normalized === "尝试不同的方法" ||
			normalized === "try a different approach" ||
			normalized.length === 0
		) {
			return {
				action: "continue" as const,
				guidance:
					"mistake_limit_reached：以不同的方法重试，在调用前验证工具参数，并避免重复失败步骤。",
			};
		}
		return {
			action: "continue" as const,
			guidance: `mistake_limit_reached: ${answer.trim()}`,
		};
	};
}
