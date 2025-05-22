import React, { createContext, useCallback, useContext, useEffect, useState } from "react"
import { useExtensionState } from "./ExtensionStateContext"
import axios, { AxiosRequestConfig } from "axios"
import { vscode } from "@/utils/vscode"

interface ShengSuanYunAuthContextType {
	userSSY: any | null
	isInitSSY: boolean
	signInWithTokenSSY: (token: string) => Promise<void>
	handleSignOutSSY: () => Promise<void>
}

const ShengSuanYunAuthContext = createContext<ShengSuanYunAuthContextType | undefined>(undefined)
export const ShengSuanYunAuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	const [userSSY, setUser] = useState<any | null>(null)
	const [isInitSSY, setIsInitialized] = useState(false)
	const { apiConfiguration } = useExtensionState()
	useEffect(() => {
		if (apiConfiguration?.shengsuanyunToken) signInWithTokenSSY(apiConfiguration?.shengsuanyunToken)
	}, [apiConfiguration?.shengsuanyunToken])

	const signInWithTokenSSY = async (token: string) => {
		try {
			const reqConfig: AxiosRequestConfig = {
				headers: {
					"x-token": token,
					"Content-Type": "application/json",
				},
			}
			const uri = "https://api.shengsuanyun.com/user/info"
			const res = await axios.get(uri, reqConfig)
			if (!res.data || !res.data.data || res.data.code != 0) {
				throw new Error(`Invalid response from ${uri} API`)
			}
			const usi = {
				Email: res.data.data.Email,
				Nickname: res.data.data.Nickname,
				HeadImg: res.data.data.HeadImg,
				Username: res.data.data.Username,
				Wallet: res.data.data.Wallet,
				Phone: res.data.data.Phone,
			}
			setUser(usi)
			setIsInitialized(true)
			console.log("ShengSuanYunAuthProvider onAuthStateChanged user", usi)
			vscode.postMessage({
				type: "authStateChanged",
				userSSY: usi,
			})
		} catch (error) {
			console.error("Error signing in with custom token:", error)
			throw error
		}
	}

	// Listen for auth callback from extension
	useEffect(() => {
		const handleMessage = (event: MessageEvent) => {
			const message = event.data
			if (message.type === "authCallback" && message.customToken) {
				signInWithTokenSSY(message.customToken)
			}
		}

		window.addEventListener("message", handleMessage)
		return () => window.removeEventListener("message", handleMessage)
	}, [signInWithTokenSSY])

	const handleSignOutSSY = useCallback(async () => {
		try {
			console.log("Successfully signed out of ssy")
		} catch (error) {
			console.error("Error signing out of ssy:", error)
			throw error
		}
	}, [])

	return (
		<ShengSuanYunAuthContext.Provider value={{ userSSY, isInitSSY, signInWithTokenSSY, handleSignOutSSY }}>
			{children}
		</ShengSuanYunAuthContext.Provider>
	)
}

export const useShengSuanYunAuth = () => {
	const context = useContext(ShengSuanYunAuthContext)
	if (context === undefined) {
		throw new Error("useShengSuanYunAuth must be used within a ShengSuanYunAuthProvider")
	}
	return context
}
