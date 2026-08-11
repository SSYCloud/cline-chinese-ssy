# 在 FeatureSettingsSection 中加入 Focus Chain 设置（开关 + 滑块）

## Context

用户要求在 `webview-ui/src/components/settings/sections/FeatureSettingsSection.tsx` 的“自动压缩策略”下方，加入 `FocusChainSettings` 的设置项：一个 `enabled` 开关，以及一个 `remindClineInterval`（提醒间隔）滑块。

调查发现 `FocusChainSettings`（`enabled` + `remindClineInterval`）是一个**历史功能**：proto 定义（`proto/cline/state.proto` 的 `FocusChainSettings` message、`UpdateSettingsRequest.focus_chain_settings`）、生成代码（`src/generated/**/cline/state.ts`）、共享类型（`src/shared/FocusChainSettings.ts`）、以及默认值（`src/shared/storage/state-keys.ts` 的 `focusChainSettings: { default: DEFAULT_FOCUS_CHAIN_SETTINGS }`）都还留着，但在某次重构中被从 `ExtensionState`、`getStateToPostToWebview`、`updateSettings` 后端处理、`ExtensionStateContext` 前端默认值、以及 UI（`FeatureSettingsSection.tsx`）中整体拔除了。同时 shadcn 的 `Slider` 基础组件（`webview-ui/src/components/ui/slider.tsx`）和封装组件 `SettingsSlider.tsx` 也被一起删除了（虽然 `@radix-ui/react-slider` 依赖仍在 `package.json` 里）。

历史实现可在 commit `791d23899`（"Move vscode to apps"）中找到，将作为本次恢复/重建的参考蓝本。测试文件 `FeatureSettingsSection.spec.tsx` 里已经预置了 mock 数据 `focusChainSettings: { enabled: false, remindClineInterval: 6 }`，说明这个字段本就该存在于 `useExtensionState()` 返回值中。

本次任务：把这条链路重新打通（proto→后端 state→前端 context→UI 组件），并在“自动压缩策略”下方渲染开关+滑块。

## 实现步骤

### 1. 恢复 UI 基础组件
- **新建** `webview-ui/src/components/ui/slider.tsx`：直接从 `git show 791d23899:apps/vscode/webview-ui/src/components/ui/slider.tsx` 恢复（基于 `@radix-ui/react-slider`，依赖已存在于 `package.json`）。
- **新建** `webview-ui/src/components/settings/SettingsSlider.tsx`：同样从该 commit 恢复（`label/min/max/step/value/onChange/description/valueWidth` props，内部渲染 `Label` + 数值 + `Slider`）。

### 2. 打通共享类型 `ExtensionState`
- 编辑 `src/shared/ExtensionMessage.ts`：
  - 引入 `import { FocusChainSettings } from "./FocusChainSettings"`
  - 在 `ExtensionState` interface 中加入 `focusChainSettings?: FocusChainSettings`（放在 `useAutoCondense`/`compactionStrategy`/`worktreesEnabled` 附近）。

### 3. 后端：读状态并推送到 webview
- 编辑 `src/core/controller/state/getStateToPostToWebview.ts`：
  - 新增 `const focusChainSettings = stateManager.getGlobalSettingsKey("focusChainSettings")`
  - 在返回对象中加入 `focusChainSettings,`

### 4. 后端：处理设置更新请求
- 编辑 `src/core/controller/state/updateSettings.ts`：
  - 参考现有 `useAutoCondense`/`compactionStrategy` 处理块的写法，加入：
    ```ts
    if (request.focusChainSettings !== undefined) {
        controller.stateManager.setGlobalState("focusChainSettings", {
            enabled: request.focusChainSettings.enabled,
            remindClineInterval: request.focusChainSettings.remindClineInterval,
        })
    }
    ```
  - proto 侧 `UpdateSettingsRequest.focusChainSettings?: FocusChainSettings` 和 `FocusChainSettings { enabled, remindClineInterval }` 已经在生成代码中存在（`src/generated/**/cline/state.ts`），无需改 `.proto` 或重新生成代码。

### 5. 前端 Context 默认值
- 编辑 `webview-ui/src/context/ExtensionStateContext.tsx`：
  - 在默认 state 对象（`useAutoCondense: true,` 附近）加入 `focusChainSettings: { enabled: true, remindClineInterval: 6 },`（与 `DEFAULT_FOCUS_CHAIN_SETTINGS` 一致）。
  - 无需改动 reducer/合并逻辑——该 context 使用 `ExtensionState` 整体对象合并（已确认其他类似字段如 `useAutoCondense` 没有特殊合并逻辑，走的是通用状态替换）。

### 6. `updateSetting` 工具函数
- `webview-ui/src/components/settings/utils/settingsHandlers.ts` 的 `updateSetting(field, value)` 是通用的，`field="focusChainSettings"`、`value={ enabled, remindClineInterval }` 可以直接工作，不需要特殊转换（不同于 `mcpDisplayMode` 的枚举转换）。

### 7. UI：`FeatureSettingsSection.tsx`
在“自动压缩策略”的 `<div className="space-y-2 py-3">...</div>` 块后面，同一个 `#agent-features` 容器内，新增一个 Focus Chain 设置块：

```tsx
const { ..., focusChainSettings, ... } = useExtensionState()

const handleFocusChainIntervalChange = useCallback(
    (value: number) => {
        updateSetting("focusChainSettings", { ...focusChainSettings, remindClineInterval: value })
    },
    [focusChainSettings],
)

const handleFocusChainEnabledChange = useCallback(
    (checked: boolean) => {
        updateSetting("focusChainSettings", { ...focusChainSettings, enabled: checked })
    },
    [focusChainSettings],
)
```

渲染部分（自动压缩策略 `Select` 之后）：

```tsx
<div className="space-y-2 py-3">
    <FeatureRow
        checked={focusChainSettings?.enabled}
        description="让 Cline 在长任务中定期回顾待办清单，保持专注。"
        label="任务焦点提醒"
        onChange={handleFocusChainEnabledChange}
    />
    {focusChainSettings?.enabled && (
        <SettingsSlider
            label="提醒间隔（1-10）"
            max={10}
            min={1}
            onChange={handleFocusChainIntervalChange}
            step={1}
            value={focusChainSettings?.remindClineInterval || 6}
            valueWidth="w-6"
        />
    )}
</div>
```

（中文文案沿用本文件里已经存在的翻译风格；label 文案可以按需要微调，比如直接用“Focus Chain”/“焦点链”对应历史英文 label "Focus Chain"/description "Maintain context focus across interactions"的语义，本计划采用与现有翻译语气一致的说法）。

### 8. 测试
- `FeatureSettingsSection.spec.tsx` 已有 mock 数据 `focusChainSettings: { enabled: false, remindClineInterval: 6 }`，无需改动 mock，但建议跑一下现有测试确保不因新增 UI 而破坏既有断言（新增内容不影响 `#Hooks`、`Feature Tips`、`Auto Compact Strategy` 相关的已有测试）。
- 可选：新增 1-2 个测试用例验证开关切换调用 `updateSetting("focusChainSettings", {...})`，以及滑块变化时调用。

## 验证方式
1. `cd apps/vscode/webview-ui && npx vitest run src/components/settings/sections/FeatureSettingsSection.spec.tsx`
2. `cd apps/vscode && npx tsc --noEmit`（或项目里对应的 typecheck 脚本）确认前后端类型打通无误。
3. 如可行，启动 webview（`npm run dev` 或已有的运行方式）在设置面板中手动验证：开关打开后滑块出现，拖动滑块触发 `updateSettings` gRPC 调用，刷新后设置能持久化。
