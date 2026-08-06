import * as p from "@clack/prompts";
import { runConnectAdapter } from "../../commands/connect";
import {
	PLATFORMS,
	type PlatformDef,
	type SecurityDef,
	shouldIncludeField,
} from "./platforms";

function isCancel(value: unknown): value is symbol {
	return p.isCancel(value);
}

const SENSITIVE_FLAGS = new Set([
	"-k",
	"--access-token",
	"--api-key",
	"--app-token",
	"--app-secret",
	"--bot-token",
	"--credentials-json",
	"--signing-secret",
	"--verify-token",
	"--webhook-secret",
]);

function redactCommandArgs(args: string[]): string {
	const redacted: string[] = [];
	for (let i = 0; i < args.length; i++) {
		const arg = args[i] ?? "";
		redacted.push(arg);
		if (SENSITIVE_FLAGS.has(arg) && i + 1 < args.length) {
			redacted.push("[redacted]");
			i++;
		}
	}
	return redacted.join(" ");
}

async function collectFields(platform: PlatformDef): Promise<string[] | null> {
	const args: string[] = [];
	const values: Record<string, string> = {};

	for (const field of platform.fields) {
		if (!shouldIncludeField(field, values)) {
			continue;
		}
		if (field.help) {
			for (const line of field.help) {
				p.log.info(line);
			}
		}

		const value = field.options
			? await p.select({
					message: field.label,
					options: field.options,
					initialValue: field.initialValue,
				})
			: await p.text({
					message: field.label,
					placeholder: field.placeholder,
					defaultValue: field.initialValue,
					validate: field.required
						? (v) => {
								if (!v?.trim()) return `${field.label} 是必填项`;
								return undefined;
							}
						: undefined,
				});

		if (isCancel(value)) return null;

		const trimmed = (value as string).trim();
		values[field.flag] = trimmed;
		if (trimmed) {
			args.push(field.flag, trimmed);
		}
	}

	return args;
}

async function collectSecurity(
	security: SecurityDef,
): Promise<string[] | null> {
	const restrict = await p.confirm({
		message: security.prompt,
		initialValue: true,
	});

	if (isCancel(restrict)) return null;
	if (!restrict) {
		p.log.warn(
			"任何发现此机器人的人都能在你的机器上运行任务。",
		);
		return [];
	}

	const values: Record<string, string> = {};

	for (const field of security.fields) {
		if (field.help) {
			for (const line of field.help) {
				p.log.info(line);
			}
		}

		const value = await p.text({
			message: field.label,
			placeholder: field.placeholder,
			validate: (v) => {
				const trimmed = v?.trim();
				if (!trimmed) return field.requiredMessage;
				return field.validate?.(trimmed);
			},
		});

		if (isCancel(value)) return null;

		values[field.key] = (value as string).trim();
	}

	const args = security.buildArgs(values);
	p.log.success("已启用访问限制");
	return args;
}

export async function runConnectWizard(): Promise<number> {
	p.intro("连接消息平台");

	const platformId = await p.select({
		message: "选择平台",
		options: PLATFORMS.map((pl) => ({
			value: pl.id,
			label: pl.name,
			hint: pl.hint,
		})),
	});

	if (isCancel(platformId)) {
		p.outro("已取消");
		return 0;
	}

	const platform = PLATFORMS.find((pl) => pl.id === (platformId as string));
	if (!platform) {
		p.log.error("未知平台");
		return 1;
	}

	p.log.step(`正在设置 ${platform.name}`);

	if (platform.type === "webhook") {
		p.log.warn(
			"此连接器需要公开可访问的网址用于 webhook。",
		);
	}

	const args = await collectFields(platform);
	if (!args) {
		p.outro("已取消");
		return 0;
	}

	if (platform.security) {
		const securityArgs = await collectSecurity(platform.security);
		if (!securityArgs) {
			p.outro("已取消");
			return 0;
		}
		args.push(...securityArgs);
	}

	const advanced = await p.group({
		provider: () =>
			p.text({
				message: "提供商覆盖",
				placeholder: "留空使用默认值",
			}),
		model: () =>
			p.text({
				message: "模型覆盖",
				placeholder: "留空使用默认值",
			}),
		systemPrompt: () =>
			p.text({
				message: "系统提示词覆盖",
				placeholder: "留空使用默认值",
			}),
		mode: () =>
			p.select({
				message: "代理模式",
				options: [
					{ value: "act", label: "执行", hint: "执行任务" },
					{ value: "plan", label: "规划", hint: "仅规划" },
				],
				initialValue: "act",
			}),
	});

	if (isCancel(advanced)) {
		p.outro("已取消");
		return 0;
	}

	if (advanced.provider?.trim()) {
		args.push("--provider", advanced.provider.trim());
	}
	if (advanced.model?.trim()) {
		args.push("--model", advanced.model.trim());
	}
	if (advanced.systemPrompt?.trim()) {
		args.push("--system", advanced.systemPrompt.trim());
	}
	if (advanced.mode === "plan") {
		args.push("--mode", "plan");
	}

	args.push("-i");

	p.log.success(
		`正在运行：cline connect ${platform.id} ${redactCommandArgs(args)}`,
	);
	p.outro("正在启动连接器（按 Ctrl+C 停止）");

	return runConnectAdapter(platform.id, args, {
		writeln: (text) => {
			if (text) console.log(text);
		},
		writeErr: (text) => console.error(text),
	});
}
