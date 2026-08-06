// Independent SDK-backed account service for ShengSuanYun (胜算云).
// Handles fetching account credit/usage/payment data by making authenticated
// requests to the ShengSuanYun API using the "x-token" credential stored in
// StateManager secrets.

import {
	EnterpriseBillRequest,
	EnterpriseBillResponse,
	EPAPIKey,
	EProjectList,
	PaymentTransaction,
	UsageTransaction,
	UserCreditsBalance,
	UserCreditsData,
	UserInfo,
} from "@shared/proto/cline/account"
import axios, { type AxiosRequestConfig } from "axios"
import { StateManager } from "@/core/storage/StateManager"
import { getAxiosSettings } from "@/shared/net"
import { Logger } from "@/shared/services/Logger"

export class ShengSuanYunAccountService {
	private static instance: ShengSuanYunAccountService
	private readonly baseUrl = "https://api.shengsuanyun.com"

	/**
	 * Returns the singleton instance of ShengSuanYunAccountService
	 */
	public static getInstance(): ShengSuanYunAccountService {
		if (!ShengSuanYunAccountService.instance) {
			ShengSuanYunAccountService.instance = new ShengSuanYunAccountService()
		}
		return ShengSuanYunAccountService.instance
	}

	/**
	 * Helper function to make authenticated requests to the ShengSuanYun API.
	 * Uses the "x-token" credential stored in StateManager secrets.
	 */
	private async authenticatedRequest<T>(endpoint: string, config: AxiosRequestConfig = {}): Promise<T> {
		const token = StateManager.get().getSecretKey("shengSuanYunToken")
		if (!token) {
			throw new Error("未找到胜算云 Auth Token")
		}
		const url = `${this.baseUrl}${endpoint}`
		const requestConfig: AxiosRequestConfig = {
			timeout: 50000,
			...config,
			url,
			method: config.method || "GET",
			headers: {
				"Content-Type": "application/json",
				...config.headers,
				"x-token": token,
			},
			...getAxiosSettings(),
		}
		const response = await axios.request<{ data?: T; code?: number }>(requestConfig)
		if (!response.data || !response.data.data || response.data.code === 103) {
			throw new Error(`Invalid response from ${endpoint} API`)
		}
		return response.data.data
	}

	private dateQueryString(): string {
		const endDate = new Date()
		const startDate = new Date(endDate)
		startDate.setDate(endDate.getDate() - 3)
		const formatDate = (date: Date): string => {
			const year = date.getFullYear()
			const month = String(date.getMonth() + 1).padStart(2, "0")
			const day = String(date.getDate()).padStart(2, "0")
			return `${year}-${month}-${day}`
		}
		return `startDate=${formatDate(startDate)}&endDate=${formatDate(endDate)}`
	}

	/**
	 * Fetches the ShengSuanYun user's profile (identity + wallet balance).
	 */
	async getUserInfo(): Promise<UserInfo> {
		try {
			const res = await this.authenticatedRequest<any>("/user/info")
			if (!res) {
				throw new Error("Invalid response from API: /user/info")
			}
			return UserInfo.create({
				uid: res.ID || "",
				displayName: res.Nickname || res.Username || undefined,
				email: res.Email ?? undefined,
				photoUrl: res.HeadImg ?? undefined,
				balance: res.Wallet?.Assets != null ? res.Wallet.Assets / 10000 : undefined,
			})
		} catch (error) {
			Logger.error("getUserInfo() (ShengSuanYun):", error)
			throw error
		}
	}

	/**
	 * RPC variant that fetches the user's credit balance, usage transactions,
	 * and payment transactions in a single UserCreditsData payload.
	 */
	async fetchUserDataRPC(): Promise<UserCreditsData> {
		try {
			const dqs = this.dateQueryString()
			const [rate, usage, payment, user] = await Promise.all([
				this.authenticatedRequest<number>("/base/rate"),
				this.authenticatedRequest<any>(`/modelrouter/userlog?page=1&pageSize=1000&${dqs}`),
				this.authenticatedRequest<any>("/modelrouter/listrecharge?page=1&pageSize=10000"),
				this.getUserInfo(),
			])
			if (!rate) {
				throw new Error("获取胜算云账户信息失败！")
			}

			const usageTransactions: UsageTransaction[] = Array.isArray(usage?.logs)
				? usage.logs.map((it: any) =>
						UsageTransaction.create({
							createdAt: it.request_time,
							aiModelName: `${it.model?.company}/${it.model?.name}`,
							creditsUsed: (rate * it.total_amount) / 10000000,
							totalTokens: it.total_amount,
							promptTokens: it.input_tokens,
							completionTokens: it.output_tokens,
						}),
					)
				: []

			const paymentTransactions: PaymentTransaction[] = Array.isArray(payment?.records)
				? payment.records.map((it: any) =>
						PaymentTransaction.create({
							paidAt: it.create_at,
							creatorId: "",
							amountCents: Math.round((rate * it.price) / 10000),
							credits: 0,
						}),
					)
				: []

			return UserCreditsData.create({
				balance: UserCreditsBalance.create({ currentBalance: user.balance ?? 0 }),
				usageTransactions,
				paymentTransactions,
				user,
				rate,
			})
		} catch (error) {
			Logger.error("Failed fetchUserDataRPC (ShengSuanYun):", error)
			throw error
		}
	}

	/**
	 * Fetches the list of enterprise projects, including their models, routers,
	 * and API keys.
	 */
	async getEnterpriseProjectList(): Promise<EProjectList> {
		try {
			const prjs = await this.authenticatedRequest<any[]>("/project/list")
			if (!Array.isArray(prjs)) {
				Logger.log("getEnterpriseProjectList response:", prjs)
				throw new Error("Invalid response from API: /project/list")
			}
			const apikeys = prjs.map((it: any) =>
				this.authenticatedRequest<any[]>("/project/apikey/list", { method: "POST", data: { project_id: it.id } }),
			)
			const results = await Promise.all(apikeys)

			return EProjectList.create({
				projects: prjs.map((it: any, idx: number) => ({
					id: it.id,
					name: it.projectName,
					models: (it.selectedModels ?? []).map((m: any) => ({
						id: m.id,
						name: m.name,
						type: m.type,
						inputPrice: m.inputPrice,
						outputPrice: m.outputPrice,
						inputPriceUnit: m.inputPriceUnit,
						outputPriceUnit: m.outputPriceUnit,
						otherPrice: m.otherPrice,
						provider: m.provider,
						supportModelId: m.supportModelId,
						currency: m.currency,
						contextLength: m.contextLength,
						isByok: m.isBYOK ?? m.isByok ?? false,
					})),
					routers: (it.routerConfigs ?? []).map((r: any) => ({
						id: r.id,
						name: r.name,
						mode: r.mode,
						models: (r.models ?? []).map((rm: any) => ({
							id: rm.id,
							model: rm.model,
							modelInfoId: rm.modelInfoId,
							weight: rm.weight,
						})),
						isConfirmed: r.isConfirmed,
						routeId: r.routeId,
						scope: r.scope,
						createdByRamUserId: r.createdByRamUserId,
						creatorName: r.creatorName,
						creatorType: r.creatorType,
						createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : (r.createdAt ?? ""),
						updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : (r.updatedAt ?? ""),
						updatedByRamUserId: r.updatedByRamUserId,
						updaterName: r.updaterName,
						updaterType: r.updaterType,
						canEdit: r.canEdit,
						canDelete: r.canDelete,
					})),
					apiKeys: (results[idx] ?? []).map(
						(k: any): EPAPIKey => ({
							id: k.ID ?? k.id,
							createdAt:
								k.CreatedAt instanceof Date ? k.CreatedAt.toISOString() : (k.CreatedAt ?? k.createdAt ?? ""),
							updatedAt:
								k.UpdatedAt instanceof Date ? k.UpdatedAt.toISOString() : (k.UpdatedAt ?? k.updatedAt ?? ""),
							userId: k.UserID ?? k.userId,
							isBanned: k.IsBanned ?? k.isBanned,
							isExpired: k.IsExpired ?? k.isExpired,
							name: k.Name ?? k.name,
							desc: k.Desc ?? k.desc,
							key: k.Key ?? k.key,
							token: k.Token ?? k.token,
							tpm: k.Tpm ?? k.tpm,
							rpm: k.Rpm ?? k.rpm,
							maxQuota: k.MaxQuota ?? k.maxQuota,
							consumedAmount: k.ConsumedAmount ?? k.consumedAmount,
							supportedModels: k.SupportedModels ?? k.supportedModels,
							isDefault: k.IsDefault ?? k.isDefault,
							ramUserId: k.RamUserId ?? k.ramUserId,
							enterpriseGatewayProjectId: k.EnterpriseGatewayProjectID ?? k.enterpriseGatewayProjectId,
						}),
					),
				})),
			})
		} catch (error) {
			Logger.error("getEnterpriseProjectList():", error)
			throw error
		}
	}

	/**
	 * Fetches the enterprise billing records for a given project.
	 */
	async getEnterpriseBill(qs: EnterpriseBillRequest): Promise<EnterpriseBillResponse> {
		if (!qs.projectId) {
			throw new Error("Project ID is missing for fetching bills")
		}
		const endTime = qs.endTime ?? new Date().toISOString()
		const startTime = qs.startTime ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
		const data: Record<string, unknown> = {
			project_id: qs.projectId,
			page: qs.page ?? 1,
			page_size: qs.pageSize ?? 20,
			start_time: startTime,
			end_time: endTime,
		}
		if (qs.modelName) {
			data.model_name = qs.modelName
		}
		if (qs.ramUserId) {
			data.raw_user_id = qs.ramUserId
		}
		try {
			const res = await this.authenticatedRequest<{ bills: any[] }>("/statistics/enterprise/gatewaybill", {
				method: "POST",
				data,
			})
			if (!res || !Array.isArray(res.bills)) {
				throw new Error(`Invalid response from API: /statistics/enterprise/gatewaybill${JSON.stringify(res)}`)
			}
			return EnterpriseBillResponse.create({
				bills: res.bills.map((b: any) => ({
					hourTime: b.hour_time,
					userName: b.user_name,
					modelName: b.model_name,
					userId: b.user_id,
					ramUserId: b.ram_user_id,
					requestCount: b.request_count,
					providerName: b.provider_name,
					totalDeductionAmount: b.total_deduction_amount,
					cachedAmount: b.cached_amount,
					totalPromptTokens: b.total_prompt_tokens,
					totalCompletionTokens: b.total_completion_tokens,
					totalTokens: b.total_tokens,
				})),
			})
		} catch (error) {
			Logger.error("getEnterpriseBill():", error)
			throw error
		}
	}
}
