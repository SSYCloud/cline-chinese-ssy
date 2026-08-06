import { CreateHookRequest, CreateSkillRequest, RuleFileRequest } from "@shared/proto/index.cline"
import { PlusIcon } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { useClickAway } from "react-use"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { FileServiceClient } from "@/services/grpc-client"

interface NewRuleRowProps {
	isGlobal: boolean
	ruleType?: string
	existingHooks?: string[]
	workspaceName?: string
}

const HOOK_TYPES = [
	{ name: "TaskStart", description: "在新任务开始时执行" },
	{ name: "TaskResume", description: "在任务恢复时执行" },
	{ name: "TaskCancel", description: "在任务取消时执行" },
	{ name: "TaskComplete", description: "在任务完成时执行" },
	{ name: "PreToolUse", description: "在使用任何工具之前执行" },
	{ name: "PostToolUse", description: "在使用任何工具之后执行" },
	{ name: "UserPromptSubmit", description: "在用户提交提示时执行" },
	{ name: "PreCompact", description: "在对话压缩之前执行" },
]

const NewRuleRow: React.FC<NewRuleRowProps> = ({ isGlobal, ruleType, existingHooks = [], workspaceName }) => {
	const [isExpanded, setIsExpanded] = useState(false)
	const [filename, setFilename] = useState("")
	const inputRef = useRef<HTMLInputElement>(null)
	const [error, setError] = useState<string | null>(null)

	const componentRef = useRef<HTMLDivElement | null>(null)
	// Portal target for the hook-type dropdown. Rendering the dropdown inside
	// this component (instead of document.body) keeps clicks on its options
	// from triggering the rules modal's click-away handler.
	const [dropdownContainer, setDropdownContainer] = useState<HTMLDivElement | null>(null)

	// Calculate available hook types by filtering out existing hooks
	const availableHookTypes = useMemo(() => HOOK_TYPES.filter((type) => !existingHooks.includes(type.name)), [existingHooks])

	// Focus the input when expanded
	useEffect(() => {
		if (isExpanded && inputRef.current) {
			inputRef.current.focus()
		}
	}, [isExpanded])

	useClickAway(componentRef, () => {
		if (isExpanded) {
			setIsExpanded(false)
			setFilename("")
			setError(null)
		}
	})

	const getExtension = (filename: string): string => {
		if (filename.startsWith(".") && !filename.includes(".", 1)) {
			return ""
		}
		const match = filename.match(/\.[^.]+$/)
		return match ? match[0].toLowerCase() : ""
	}

	const isValidExtension = (ext: string): boolean => {
		return ext === "" || ext === ".md" || ext === ".txt"
	}

	const handleCreateHook = async (hookName: string) => {
		if (!hookName) return

		try {
			await FileServiceClient.createHook(
				CreateHookRequest.create({
					hookName,
					isGlobal,
					workspaceName,
				}),
			)
		} catch (err) {
			console.error("Error creating hook:", err)
		}
	}

	const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault()

		if (filename.trim()) {
			const trimmedFilename = filename.trim()

			// Skills use directory names, not file extensions
			if (ruleType === "skill") {
				// Validate skill name - only allow alphanumeric, dashes, underscores
				if (!/^[a-zA-Z0-9_-]+$/.test(trimmedFilename)) {
					setError("技能名称只能包含字母、数字、短横线和下划线")
					return
				}

				try {
					await FileServiceClient.createSkillFile(
						CreateSkillRequest.create({
							skillName: trimmedFilename,
							isGlobal,
						}),
					)
					setFilename("")
					setError(null)
					setIsExpanded(false)
				} catch (err) {
					setError(err instanceof Error ? err.message : "创建技能失败")
				}
				return
			}

			const extension = getExtension(trimmedFilename)

			if (!isValidExtension(extension)) {
				setError("只允许 .md、.txt 或无文件扩展名")
				return
			}

			let finalFilename = trimmedFilename
			if (extension === "") {
				finalFilename = `${trimmedFilename}.md`
			}

			try {
				await FileServiceClient.createRuleFile(
					RuleFileRequest.create({
						isGlobal,
						filename: finalFilename,
						type: ruleType || "cline",
					}),
				)
			} catch (err) {
				console.error("Error creating rule file:", err)
			}

			setFilename("")
			setError(null)
			setIsExpanded(false)
		}
	}

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Escape") {
			setIsExpanded(false)
			setFilename("")
		}
	}

	return (
		<>
			<div
				className={cn("mb-2.5 transition-all duration-300 ease-in-out", {
					"opacity-100": isExpanded,
					"opacity-70 hover:opacity-100": !isExpanded,
				})}
				onClick={() => !isExpanded && ruleType !== "hook" && setIsExpanded(true)}
				ref={(node) => {
					componentRef.current = node
					setDropdownContainer(node)
				}}>
				<div
					className={cn(
						"flex items-center px-2 py-4 rounded bg-input-background transition-all duration-300 ease-in-out h-5",
						{
							"shadow-sm": isExpanded,
						},
					)}>
					{ruleType === "hook" ? (
						<>
							<label className="sr-only" htmlFor="hook-type-select">
								选择要创建的钩子类型
							</label>
							<span className="sr-only" id="hook-select-description">
								选择要创建的钩子类型。钩子在 Cline 生命周期的特定节点执行。可用类型：{" "}
								{availableHookTypes.map((h) => h.name).join(", ")}
							</span>
							{/* Controlled with a constant empty value so the trigger
							    resets to the placeholder after each hook is created. */}
							<Select
								disabled={availableHookTypes.length === 0}
								onValueChange={(hookName) => handleCreateHook(hookName)}
								value="">
								<SelectTrigger
									aria-describedby="hook-select-description"
									aria-label="选择要创建的钩子类型"
									className="flex-1 data-[size=default]:h-5 min-h-0 border-0 bg-transparent px-2 py-0 rounded shadow-none italic text-input-foreground data-[placeholder]:text-input-foreground cursor-pointer focus-visible:ring-0"
									id="hook-type-select">
									<SelectValue
										placeholder={availableHookTypes.length === 0 ? "已创建所有钩子" : "新建钩子..."}
									/>
								</SelectTrigger>
								<SelectContent container={dropdownContainer ?? undefined}>
									{availableHookTypes.map((hook) => (
										<SelectItem key={hook.name} title={hook.description} value={hook.name}>
											{hook.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</>
					) : (
						<form className="flex flex-1 items-center" onSubmit={handleSubmit}>
							<input
								className={cn(
									"flex-1 bg-input-background text-input-foreground border-0 outline-0 rounded focus:outline-none focus:ring-0 focus:border-transparent",
									{
										italic: !isExpanded,
									},
								)}
								onChange={(e) => setFilename(e.target.value)}
								placeholder={
									isExpanded
										? ruleType === "workflow"
											? "工作流名称（.md、.txt 或无扩展名）"
											: ruleType === "skill"
												? "技能名称（字母、数字、短横线和下划线）"
												: "规则名称（.md、.txt 或无扩展名）"
										: ruleType === "workflow"
											? "新建工作流文件..."
											: ruleType === "skill"
												? "新建技能..."
												: "新建规则文件..."
								}
								ref={inputRef}
								type="text"
								value={isExpanded ? filename : ""}
							/>

							<Button
								aria-label={
									isExpanded
										? ruleType === "skill"
											? "创建技能"
											: "创建文件"
										: ruleType === "workflow"
											? "新建工作流文件..."
											: ruleType === "skill"
												? "新建技能..."
												: "新建规则文件..."
								}
								className="mx-0.5"
								onClick={(e) => {
									e.stopPropagation()
									if (!isExpanded) {
										setIsExpanded(true)
									}
								}}
								size="icon"
								title={isExpanded ? (ruleType === "skill" ? "创建技能" : "创建文件") : "新建文件"}
								type={isExpanded ? "submit" : "button"}
								variant="icon">
								<PlusIcon />
							</Button>
						</form>
					)}
				</div>
				{isExpanded && error && <div className="text-error text-xs mt-1 ml-2">{error}</div>}
			</div>
		</>
	)
}

export default NewRuleRow
