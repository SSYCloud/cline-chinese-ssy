import {
	getClineOrgIndividualInferenceSubscriptionMessage,
	isClineFreeModelLimitMessage,
	isClineNotSubscribedMessage,
	isClineOrgIndividualInferenceSubscriptionMessage,
	isClinePassLimitMessage,
} from "@cline/llms"
import { serializeError } from "serialize-error"
import { CLINE_ACCOUNT_AUTH_ERROR_MESSAGE } from "../../shared/ClineAccount"

export enum SSYErrorType {
	Auth = "auth",
	Network = "network",
	RateLimit = "rateLimit",
	Balance = "balance",
	SpendLimit = "spendLimit",
	QuotaExceeded = "quotaExceeded",
	TpmLimitExceeded = "tpmLimitExceeded",
	RpmLimitExceeded = "rpmLimitExceeded",
	Entitlement = "entitlement",
	OrgClinePassRestriction = "orgClinePassRestriction",
	ClinePassLimit = "clinePassLimit",
	ClineFreeModelLimit = "clineFreeModelLimit",
}

interface ErrorDetails {
	/**
	 * The HTTP status code of the error, if applicable.
	 */
	status?: number
	/**
	 * The request ID associated with the error, if available.
	 * This can be useful for debugging and support.
	 */
	request_id?: string
	/**
	 * Specific error code provided by the API or service.
	 */
	code?: string
	/**
	 * The model ID associated with the error, if applicable.
	 * This is useful for identifying which model the error relates to.
	 */
	modelId?: string
	/**
	 * The provider ID associated with the error, if applicable.
	 * This is useful for identifying which provider the error relates to.
	 */
	providerId?: string
	/**
	 * The error message associated with the error, if applicable.
	 */
	message?: string
	// Additional details that might be present in the error
	// This can include things like current balance, error messages, etc.
	details?: any
}

const RATE_LIMIT_PATTERNS = [/status code 429/i, /rate limit/i, /too many requests/i, /quota exceeded/i, /resource exhausted/i]

export class SSYError extends Error {
	readonly title = "SSYError"
	readonly _error: ErrorDetails

	// Error details per providers:
	// Cline: error?.error
	// Ollama: error?.cause
	// tbc
	constructor(
		raw: any,
		public modelId?: string,
		public providerId?: string,
	) {
		const error = serializeError(raw)

		const message = error.message || String(error) || error?.cause?.means
		super(message)

		// Extract status from multiple possible locations
		const status = error.status || error.statusCode || error.response?.status
		this.modelId = modelId || error.modelId
		this.providerId = providerId || error.providerId

		// Construct the error details object to includes relevant information
		// And ensure it has a consistent structure
		this._error = {
			message: raw.message || message,
			status,
			request_id: error.request_id || error.response?.request_id,
			code: error.code || error?.cause?.code,
			modelId: this.modelId,
			providerId: this.providerId,
			details: error.details || error.error, // Additional details provided by the server
			...error,
			stack: undefined, // Avoid serializing stack trace to keep the error object clean
		}
	}

	/**
	 *  Serializes the error to a JSON string that allows for easy transmission and storage.
	 *  This is useful for logging or sending error details to a webviews.
	 */
	public serialize(): string {
		return JSON.stringify({
			message: this.message,
			status: this._error.status,
			request_id: this._error.request_id,
			code: this._error.code,
			modelId: this.modelId,
			providerId: this.providerId,
			details: this._error.details,
		})
	}

	public get status(): number | undefined {
		return this._error.status
	}

	public get requestId(): string | undefined {
		return this._error.request_id
	}

	/**
	 * Parses a stringified error into a SSYError instance.
	 */
	static parse(errorStr?: string, modelId?: string): SSYError | undefined {
		if (!errorStr || typeof errorStr !== "string") {
			return undefined
		}
		return SSYError.transform(errorStr, modelId)
	}

	/**
	 * Transforms any object into a SSYError instance.
	 * Always returns a SSYError, even if the input is not a valid error object.
	 */
	static transform(error: any, modelId?: string, providerId?: string): SSYError {
		try {
			// If already a SSYError, return it directly to prevent infinite recursion
			if (error instanceof SSYError) {
				return error
			}
			return new SSYError(JSON.parse(error), modelId, providerId)
		} catch {
			return new SSYError(error, modelId, providerId)
		}
	}

	public isErrorType(type: SSYErrorType): boolean {
		return SSYError.getErrorType(this) === type
	}

	/**
	 * Is known error type based on the error code, status, and details.
	 * This is useful for determining how to handle the error in the UI or logic.
	 */
	static getErrorType(err: SSYError): SSYErrorType | undefined {
		const { code, status, details } = err._error
		const rawMessage = err._error?.message || err.message || JSON.stringify(err._error)
		const detailMessage = typeof details?.message === "string" ? details.message : undefined

		// Check balance error first (most specific)
		if (code === "insufficient_quota" && typeof details?.message.includes("用户余额不足")) {
			err._error.details = {
				balance: 0,
				bill: 0,
				message: "账户余额不足，请充值！",
				buyCreditsUrl: "https://console.shengsuanyun.com/user/recharge",
			}
			return SSYErrorType.Balance
		}

		// Check spend limit exceeded (org-enforced budget cap, 429 SPEND_LIMIT_EXCEEDED)
		// Must be checked before the generic rate-limit check since both use 429
		if (code === "SPEND_LIMIT_EXCEEDED" || details?.code === "SPEND_LIMIT_EXCEEDED") {
			return SSYErrorType.SpendLimit
		}

		if (
			rawMessage === getClineOrgIndividualInferenceSubscriptionMessage() ||
			(detailMessage ? isClineOrgIndividualInferenceSubscriptionMessage(detailMessage) : false) ||
			(rawMessage ? isClineOrgIndividualInferenceSubscriptionMessage(rawMessage) : false)
		) {
			return SSYErrorType.OrgClinePassRestriction
		}

		if (
			(detailMessage ? isClineNotSubscribedMessage(detailMessage) : false) ||
			(rawMessage ? isClineNotSubscribedMessage(rawMessage) : false)
		) {
			return SSYErrorType.Entitlement
		}

		if (
			(detailMessage ? isClineFreeModelLimitMessage(detailMessage) : false) ||
			(rawMessage ? isClineFreeModelLimitMessage(rawMessage) : false)
		) {
			return SSYErrorType.ClineFreeModelLimit
		}

		if (
			(detailMessage ? isClinePassLimitMessage(detailMessage) : false) ||
			(rawMessage ? isClinePassLimitMessage(rawMessage) : false)
		) {
			return SSYErrorType.ClinePassLimit
		}

		// Check auth errors
		if (code === "ERR_BAD_REQUEST" || status === 401 || err instanceof AuthInvalidTokenError) {
			return SSYErrorType.Auth
		}

		// Check quota exceeded errors
		if (code === "quota_exceeded") {
			return SSYErrorType.QuotaExceeded
		}

		if (code === "tpm_limit_exceeded") {
			return SSYErrorType.TpmLimitExceeded
		}

		if (code === "rpm_limit_exceeded") {
			return SSYErrorType.RpmLimitExceeded
		}

		// Check for auth message (only if message exists)
		const message = err.message
		if (message?.includes(CLINE_ACCOUNT_AUTH_ERROR_MESSAGE)) {
			return SSYErrorType.Auth
		}

		// Check rate limit patterns
		if (message) {
			const lowerMessage = message.toLowerCase()
			if (RATE_LIMIT_PATTERNS.some((pattern) => pattern.test(lowerMessage))) {
				return SSYErrorType.RateLimit
			}
		}
		return undefined
	}
}

export class AuthInvalidTokenError extends Error {
	constructor(message: string) {
		super(message)
		this.name = SSYErrorType.Auth
	}
}
