export enum NEW_USER_TYPE {
	CLINE_PASS = "cline-pass",
	FREE = "free",
	POWER = "power",
	BYOK = "byok",
}

type UserTypeSelection = {
	title: string
	description: string
	type: NEW_USER_TYPE
	learnMoreUrl?: string
}

export const STEP_CONFIG = {
	0: {
		title: "你想怎么使用 Cline?",
		description: "选择一个下面的选项来开始.",
		buttons: [
			{ text: "继续", action: "next", variant: "default" },
			{ text: "登录 Cline 账户", action: "signin", variant: "secondary" },
		],
	},
	[NEW_USER_TYPE.CLINE_PASS]: {
		title: "Select a ClinePass model",
		buttons: [
			{ text: "Create my Account", action: "signup", variant: "default" },
			{ text: "Back", action: "back", variant: "secondary" },
		],
	},
	[NEW_USER_TYPE.FREE]: {
		title: "绝对免费",
		buttons: [
			{ text: "使用 Cline 账号登录并使用此模型", action: "signup", variant: "default" },
			{ text: "返回", action: "back", variant: "secondary" },
		],
	},
	[NEW_USER_TYPE.POWER]: {
		title: "选择你的模型",
		buttons: [
			{ text: "使用胜算云登录并使用此模型", action: "signin_ssy", variant: "default" },
			{ text: "返回", action: "back", variant: "secondary" },
		],
	},
	[NEW_USER_TYPE.BYOK]: {
		title: "配置你的提供商 API 密钥",
		buttons: [
			{ text: "继续", action: "done", variant: "default" },
			{ text: "返回", action: "back", variant: "secondary" },
		],
	},
	2: {
		title: "几乎完成了！",
		description: "在浏览器中完成账户创建。然后回到这里完成最后的设置。",
		buttons: [{ text: "返回", action: "back", variant: "secondary" }],
	},
} as const

const CLINE_PASS_USER_TYPE_SELECTION: UserTypeSelection = {
	title: "ClinePass",
	description: "Low cost subscription plan for best open weights model.",
	type: NEW_USER_TYPE.CLINE_PASS,
	learnMoreUrl: "https://docs.cline.bot/getting-started/clinepass",
}

const BASE_USER_TYPE_SELECTIONS: UserTypeSelection[] = [
	{ title: "Absolutely Free", description: "Get started at no cost", type: NEW_USER_TYPE.FREE },
	{ title: "Frontier Model", description: "Claude, GPT Codex, Gemini, etc.", type: NEW_USER_TYPE.POWER },
	{ title: "Bring my own API key", description: "Use Cline with your provider of choice", type: NEW_USER_TYPE.BYOK },
]

/** The initial onboarding keeps the three primary paths in a stable order. */
export function getUserTypeSelections(_hasClinePassModels: boolean): UserTypeSelection[] {
	return BASE_USER_TYPE_SELECTIONS
}
