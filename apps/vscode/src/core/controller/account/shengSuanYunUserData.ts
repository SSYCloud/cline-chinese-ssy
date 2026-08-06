import { UserCreditsData } from "@shared/proto/cline/account"
import type { EmptyRequest } from "@shared/proto/cline/common"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from "../index"
// import { shengSuanYunLoginClicked } from "./shengSuanYunLoginClicked"

export async function shengSuanYunUserData(controller: Controller, _request: EmptyRequest): Promise<UserCreditsData> {
	try {
		if (!controller.accountServiceSSY) {
			throw new Error("Account service not available")
		}
		const userData = await controller.accountServiceSSY.fetchUserDataRPC()
		if (userData.user) {
			controller.stateManager.setGlobalState("userInfo", userData.user)
		}
		return userData
	} catch (error) {
		controller.stateManager.setGlobalState("userInfo", undefined)
		// shengSuanYunLoginClicked(controller, _request)
		Logger.error(`Failed to fetch user credits data: ${error}`)
		throw error
	}
}
