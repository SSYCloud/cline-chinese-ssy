import { createTeamName } from "@cline/core";
import { formatUserCommandBlock } from "@cline/shared";
import type { Config } from "./types";

export const TEAM_COMMAND_USAGE =
	"用法: /team <任务描述>\n为给定任务启动一个代理团队。";

type TeamPromptRewriteResult =
	| { kind: "none" }
	| { kind: "usage" }
	| { kind: "rewritten"; prompt: string };

export function rewriteTeamPrompt(input: string): TeamPromptRewriteResult {
	const match = /^\/team\b([\s\S]*)$/i.exec(input.trim());
	if (!match) {
		return { kind: "none" };
	}
	const taskBody = match[1].trim();
	if (!taskBody) {
		return { kind: "usage" };
	}
	return {
		kind: "rewritten",
		prompt: formatUserCommandBlock(
			`为以下任务启动一个代理团队: ${taskBody}`,
			"team",
		),
	};
}

export async function enableTeamsForPrompt(config: Config): Promise<void> {
	if (config.enableAgentTeams) {
		return;
	}
	config.enableAgentTeams = true;
	config.teamName = config.teamName?.trim() || createTeamName();
}
