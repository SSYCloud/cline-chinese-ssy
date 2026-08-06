export interface CronPreset {
	label: string;
	value: string;
	hint: string;
}

export const CRON_PRESETS: CronPreset[] = [
	{
		label: "每 5 分钟",
		value: "*/5 * * * *",
		hint: "*/5 * * * *",
	},
	{
		label: "每 15 分钟",
		value: "*/15 * * * *",
		hint: "*/15 * * * *",
	},
	{
		label: "每小时",
		value: "0 * * * *",
		hint: "0 * * * *",
	},
	{
		label: "每 6 小时",
		value: "0 */6 * * *",
		hint: "0 */6 * * *",
	},
	{
		label: "每天午夜",
		value: "0 0 * * *",
		hint: "0 0 * * *",
	},
	{
		label: "每天上午 9 点",
		value: "0 9 * * *",
		hint: "0 9 * * *",
	},
	{
		label: "每个工作日上午 9 点",
		value: "0 9 * * 1-5",
		hint: "0 9 * * 1-5",
	},
	{
		label: "每周一上午 9 点",
		value: "0 9 * * 1",
		hint: "0 9 * * 1",
	},
	{
		label: "每月第一天",
		value: "0 0 1 * *",
		hint: "0 0 1 * *",
	},
	{
		label: "自定义",
		value: "__custom__",
		hint: "输入你自己的 cron 表达式",
	},
];
