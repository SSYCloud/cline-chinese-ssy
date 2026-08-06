import { VSCodeLink, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { ReactNode, useEffect, useRef, useState } from "react"
import { useDebounceEffect } from "@/utils/useDebounceEffect"

/**
 * Props for the ApiKeyField component
 */
interface ApiKeyFieldProps {
	initialValue: string
	onChange: (value: string) => void
	providerName: string
	signupUrl?: string
	placeholder?: string
	helpText?: string
	label?: string
	loginBtn?: ReactNode
}

/**
 * A reusable component for API key input fields with standard styling and help text for signing up for key
 */
export const ApiKeyField = ({
	initialValue,
	onChange,
	providerName,
	signupUrl,
	placeholder = "输入 API 密钥...",
	helpText,
	label = `${providerName} API 密钥`,
}: ApiKeyFieldProps) => {
	const [localValue, setLocalValue] = useState(initialValue)
	const isFocusedRef = useRef(false)
	const hasPendingUserEditRef = useRef(false)
	const prevInitialValueRef = useRef(initialValue)

	useEffect(() => {
		if (prevInitialValueRef.current === initialValue) {
			return
		}

		prevInitialValueRef.current = initialValue

		// API key saves can update the masked initial value while the user is still typing.
		// Do not replace their in-progress input with the new mask, or subsequent saves only
		// persist the suffix typed after that rerender.
		if (!isFocusedRef.current) {
			hasPendingUserEditRef.current = false
			setLocalValue(initialValue)
		}
	}, [initialValue])

	useDebounceEffect(
		() => {
			if (!hasPendingUserEditRef.current) {
				return
			}

			hasPendingUserEditRef.current = false
			onChange(localValue)
		},
		100,
		[localValue],
	)

	return (
		<div>
			<VSCodeTextField
				onBlur={() => {
					isFocusedRef.current = false
				}}
				onFocus={() => {
					isFocusedRef.current = true
				}}
				onInput={(e) => {
					hasPendingUserEditRef.current = true
					setLocalValue((e.target as HTMLInputElement | null)?.value ?? "")
				}}
				placeholder={placeholder}
				required={true}
				style={{ width: "100%" }}
				type="password"
				value={localValue}>
				<span style={{ fontWeight: 500 }}>{label}</span>
			</VSCodeTextField>
			<p
				style={{
					fontSize: "12px",
					marginTop: 3,
					color: "var(--vscode-descriptionForeground)",
				}}>
				{helpText || "此密钥仅存储在本地，仅用于从此扩展发起 API 请求。"}
				{!localValue && signupUrl && (
					<VSCodeLink
						href={signupUrl}
						style={{
							display: "inline",
							fontSize: "inherit",
						}}>
						你可以在此注册获取 {providerName} API 密钥。
					</VSCodeLink>
				)}
			</p>
		</div>
	)
}
