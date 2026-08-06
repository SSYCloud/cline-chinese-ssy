import { UserCreditsData } from "@shared/proto/cline/account"
import type { EmptyRequest } from "@shared/proto/cline/common"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from "../index"

export async function getShengSuanYunUserCredits(controller: Controller, _request: EmptyRequest): Promise<UserCreditsData> {
	try {
		if (!controller.accountServiceSSY) {
			throw new Error("Account service not available")
		}
		return await controller.accountServiceSSY.fetchUserDataRPC()
	} catch (error) {
		Logger.error(`Failed to fetch ShengSuanYun user credits data: ${error}`)
		throw error
	}
}
