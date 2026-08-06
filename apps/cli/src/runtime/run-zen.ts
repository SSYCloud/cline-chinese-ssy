import type { UserInstructionConfigService } from "@cline/core";
import { HubSessionClient } from "@cline/core";
import type { ChatStartSessionRequest } from "@cline/shared";
import { resolveCliSessionMetadata } from "../utils/enterprise";
import { ensureCliHubServer } from "../utils/hub-runtime";
import { c, emitJsonLine, writeErr, writeln } from "../utils/output";
import type { Config } from "../utils/types";
import { buildUserInputMessage } from "./prompt";

const ZEN_DISPATCH_ACK_TIMEOUT_MS = 5_000;

/**
 * Zen mode: fire-and-forget dispatch of a task to the background hub.
 *
 * Unlike a normal CLI run, zen mode does not stay connected to watch the
 * session stream. It submits the turn to the hub and exits immediately. The
 * hub continues to execute the agent loop in the background and, on
 * completion, already publishes a `ui.notify` event which the menubar app
 * (if installed) surfaces as a system notification. If the menubar app is not
 * running, users can still find the result later via `cline history`.
 *
 * Because no human is available to approve tool calls once the CLI exits,
 * zen mode forces full tool auto-approval (same semantics as yolo) and only
 * works with a hub-backed session. Sandbox mode (enabled via --data-dir) is
 * incompatible with zen because sandbox requires a local backend that
 * terminates with the CLI.
 */
export async function runZen(
	prompt: string,
	config: Config,
	userInstructionService?: UserInstructionConfigService,
): Promise<void> {
	if (config.sandbox) {
		writeErr(
			"--zen 不能与 --data-dir 组合使用（沙箱需要本地后端）。",
		);
		process.exitCode = 1;
		return;
	}
	if (
		process.env.CLINE_SESSION_BACKEND_MODE?.trim().toLowerCase() === "local"
	) {
		writeErr(
			"--zen 需要 hub 后端，但已设置 CLINE_SESSION_BACKEND_MODE=local。",
		);
		process.exitCode = 1;
		return;
	}

	const workspaceRoot = config.workspaceRoot ?? config.cwd;
	let hubUrl: string;
	let hubAuthToken: string;
	try {
		const hub = await ensureCliHubServer(workspaceRoot);
		hubUrl = hub.url;
		hubAuthToken = hub.authToken;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		writeErr(`无法启动后台 hub：${message}`);
		process.exitCode = 1;
		return;
	}

	const sessionClient = new HubSessionClient({
		address: hubUrl,
		authToken: hubAuthToken,
		clientType: "cli-zen",
		displayName: "Cline CLI (zen)",
		workspaceRoot,
		cwd: config.cwd,
	});

	let sessionId: string | undefined;
	try {
		await sessionClient.connect();

		const {
			prompt: userInput,
			userImages,
			userFiles,
		} = await buildUserInputMessage(prompt, userInstructionService);

		const startRequest: ChatStartSessionRequest = {
			workspaceRoot,
			cwd: config.cwd,
			provider: config.providerId,
			model: config.modelId,
			apiKey: config.apiKey || undefined,
			systemPrompt: config.systemPrompt,
			// Zen runs unattended: use yolo-style tool behavior so tool calls are
			// auto-approved without a human in the loop.
			mode: "yolo",
			rules: undefined,
			enableTools: true,
			enableSpawn: false,
			enableTeams: false,
			autoApproveTools: true,
			toolExecutors: ["submit"],
			source: "cline-cli-zen",
			interactive: false,
			logger: config.loggerConfig,
		};

		const started = await sessionClient.startRuntimeSession(startRequest);
		sessionId = started.sessionId;
		const remoteConfigMetadata = await resolveCliSessionMetadata(
			sessionId,
		).catch(() => undefined);
		if (remoteConfigMetadata && sessionClient.updateSession) {
			await sessionClient
				.updateSession({
					sessionId,
					metadata: remoteConfigMetadata,
				})
				.catch(() => undefined);
		}

		// Wait for the hub to acknowledge `session.send_input` before closing the
		// socket. That confirms the prompt frame reached the hub and was accepted
		// for execution, avoiding silent drops on slow or loaded systems.
		await Promise.race([
			sessionClient.sendRuntimeSession(started.sessionId, {
				config: startRequest,
				prompt: userInput,
				attachments:
					userImages.length > 0 || userFiles.length > 0
						? {
								userImages: userImages.length > 0 ? userImages : undefined,
								userFiles:
									userFiles.length > 0
										? userFiles.map((content, index) => ({
												name: `attachment-${index + 1}`,
												content,
											}))
										: undefined,
							}
						: undefined,
			}),
			new Promise<never>((_, reject) => {
				setTimeout(() => {
					reject(
						new Error(
							`timed out waiting for hub to acknowledge zen dispatch after ${ZEN_DISPATCH_ACK_TIMEOUT_MS} ms`,
						),
					);
				}, ZEN_DISPATCH_ACK_TIMEOUT_MS);
			}),
		]);

		if (config.outputMode === "json") {
			emitJsonLine("stdout", {
				type: "zen_dispatched",
				sessionId,
				hubUrl,
				workspaceRoot,
			});
		} else {
			writeln(
				`${c.dim}[zen]${c.reset} CLI 正在退出；会话 ${sessionId} 将在后台继续运行。`,
			);
			writeln(
				`${c.dim}[zen]${c.reset} 稍后可运行 ${c.dim}history${c.reset} 查看结果。`,
			);
		}
		process.exitCode = 0;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (config.outputMode === "json") {
			emitJsonLine("stderr", {
				type: "zen_error",
				sessionId,
				message,
			});
		} else {
			writeErr(`zen 派发失败：${message}`);
		}
		process.exitCode = 1;
	} finally {
		sessionClient.close();
	}
}
