
# Cline Chinese · Cline 中文汉化版 

![Installs](https://img.shields.io/visual-studio-marketplace/i/SSYCloud.cline-chinese)
![Rating](https://img.shields.io/visual-studio-marketplace/r/SSYCloud.cline-chinese)
![VS Code](https://img.shields.io/badge/VS%20Code-1.85%2B-007ACC?logo=visualstudiocode)
![License](https://img.shields.io/github/license/SSYCloud/cline-chinese)

[GitHub 仓库](https://github.com/SSYCloud/cline-chinese) · [完整文档](https://hybridtalentcomputing.gitbook.io/cline-chinese-doc/) · [报告问题](https://github.com/SSYCloud/cline-chinese/issues)

> 本项目为[Cline Chinese](https://github.com/SSYCloud/cline-chinese)同源灰度版本，在这里可以提前体验到Cline Chinese的新功能、新特性，Cline Chinese为正式稳定的公开版本。

---

## 🎁 新用户福利

> **首次注册胜算云即送 10 元模力 + 首充 10% 加赠** —— [点这里领取](https://www.shengsuanyun.com/?from=cline-chinese)

10 元模力可跑约 **200-400 万 tokens**（按 DeepSeek-V4-Flash 计价），足够一个完整项目的代码生成与调试。注册后即可在胜算云控制台一键拿到 API Key，免去逐家注册与充值 DeepSeek / Kimi / Qwen / GLM  等账号的麻烦。

---

## 这是什么

Cline Chinese 是 [Cline](https://github.com/cline/cline) 的开源社区汉化版本，由Leo老师作为发起人。即日起（2026.7.30），胜算云开源项目团队（SSYCloud）正式成为 Cline Chinese 开源项目的管理方和核心贡献者，负责项目的代码日常维护及Cline中文编程社区运营工作。感谢各位的信任、陪伴与支持！Leo 老师及依旧会持续关注和参与本项目。

我们做的三件事：

| | |
|---|---|
|**完整中文化** | 界面、提示词、错误信息、文档全部本地化 |
|**国产大模型深度调优** | 解决"中文输入 → 英文 prompt → 输出走样"的链路问题，DeepSeek / Kimi / Qwen / GLM 等最新模型开箱即用 |
|**默认对接胜算云统一 API 网关** | 一份 Key 切换多家模型，全球算力调度 + 自动容灾，无需自配代理 |

**当前下载量**：271k+ VS Code 插件市场（截至 2026-07-30）

## 为什么选 Cline Chinese，而不是原版 Cline

| | Cline Chinese | 原版 Cline |
|---|---|---|
| 中文 UI | ✅ 完整汉化 | ❌ 全英文 |
| DeepSeek / Kimi / Qwen / GLM等最新模型 | ✅ 深度调优 + 默认走胜算云网关 | ⚠️ 通用支持，无优化 |
| 中文 prompt 工程 | ✅ 内置 | ❌ 需要自己调 |
| 插件 / MCP | ✅ Skills / Plugins / MCP 全支持 | ✅ 支持 |
| API 网关 / 多模型切换 | ✅ 胜算云网关，一 Key 切多模型 | ❌ 需自配代理 |


## 🎯 典型使用场景

### 1. 中文需求 → 直接生成代码

在聊天框输入中文需求，Cline Chinese 会自动转写为适配国产模型的最优 prompt 并执行：

```
帮我写一个 Python 函数，读取 CSV 并按列计算平均值
```

```
把这个 React 组件改成 Vue 3 的 Composition API 写法
```

```
给这个 REST API 加 JWT 鉴权中间件
```

### 2. 中文代码注释 / 文档自动生成

```
给当前文件的所有函数加中文 docstring
```

```
根据这个模块生成 README.md
```

```
给这次改动生成符合 Conventional Commits 规范的 commit message
```

### 3. 测试用例生成

```
给 src/utils/format.ts 里所有函数生成 Vitest 测试用例
```

### 4. 代码审查与重构

```
审查当前文件，找出潜在的内存泄漏
```

```
把这段嵌套循环改成更易读的实现
```

### 5. 中文问答与学习

```
解释这段代码在做什么，用中文给一个团队能听懂的版本
```

```
TypeScript 里 interface 和 type 到底有什么区别？
```

## 📖 详细使用指南

### 任务历史与上下文

- **任务历史**：本地存储，不上传云端
- **会话上下文长度**：根据模型自适应，也可手动设置上下文长度
- **多文件操作**：用 `@文件名` 把文件加进上下文

### 文件操作

- `@路径`：添加文件或文件夹到上下文
- `/`：快捷命令（如 `/explain` 解释代码、`/tests` 生成测试）
- 拖拽：直接拖文件进聊天框

### 终端命令

Cline Chinese 可以直接在你的 VS Code 终端里执行命令。涉及安装依赖、跑测试等命令时会先请求你确认。

### 检查点（Checkpoint）

关键改动会自动生成检查点，可以一键回滚。对生产代码操作时建议打开。

### 压缩（Compaction）

当上下文超过模型窗口时，Cline Chinese 会自动压缩历史对话，保持上下文连贯。


## ❓ 常见问题

### 安装与升级

**Q：升级到 v4.0 后老配置还在吗？**
A：在。v4.0 升级会自动迁移；如遇异常可在设置里手动配置一次。

**Q：和原版 Cline 同时安装会冲突吗？**
A：会。建议只装一个，胜算云维护的 Cline Chinese 是从原版 fork 出来的，两者共用相同的扩展 ID 槽位。

**Q：能装在 Cursor / Windsurf 等 VS Code 兼容编辑器里吗？**
A：能。VSIX 直接安装即可。CLI 命令见 [安装文档](https://hybridtalentcomputing.gitbook.io/cline-chinese-doc/install)。

### 模型与配置

**Q：应该选哪个模型？**
A：控制台里可以一键切换 DeepSeek / Kimi / Qwen / GLM / 智谱等模型，无需改配置。性价比选 DeepSeek-V4-Flash，长上下文选 DeepSeek-V4-Pro（64K-1M），代码生成选 Glm5.2r。

**Q：没有 API Key 能试用吗？**
A：[胜算云](https://www.shengsuanyun.com/?from=cline-chinese) 注册即送 10 元模力，可以跑约 200-400 万 tokens，足够体验整个产品。

**Q：API Key 会被上传到云端吗？**
A：不会。API Key 只存在你本地 VS Code 的 settings 里。

**Q：可以用自己的 Key 吗？**
A：可以。已有 DeepSeek / Kimi / Qwen / GLM 官方 Key 的用户，在第 3 步选择对应提供商即可，不强制走胜算云。

**Q：胜算云网关和自己直接接 DeepSeek 官方 API 有什么区别？**
A：网关的优势是① 一份 Key 切多家模型，无需逐家注册；② 全球节点调度，自动选最优；③ 自动容灾，单家 API 故障不影响。劣势是多了 1-2 层网络跳转。如果你只用一个模型、对延迟敏感，直接接官方 API 也完全可以。


### 中文使用

**Q：中文输入偶尔输出英文怎么办？**
A：在对话开头加一句「请始终用中文回答」，或在自定义系统 prompt 里固定。

**Q：代码注释和文档一定要中文吗？**
A：不一定。可以在 prompt 里指定语言，也可以让 Cline 中文输出 + 英文注释混合。

**Q：能识别方言或口语化表达吗？**
A：可以。模型本身能处理自然语言口语化表达，Cline Chinese 会尽量贴近你的输入风格。

### 性能与稳定性

**Q：推理速度怎么样？**
A：用 DeepSeek-V4-Flash 时首 token < 1s，整体响应接近 GPT-4o 水平；用 Flash 版本会更快。走胜算云网关会增加 10-30ms 跳转，可忽略。

**Q：长上下文会卡吗？**
A：DeepSeek-V4-Pro 支持 64K / 128K / 1M 三档，超过 64K 会触发自动压缩，体感不掉速。

**Q：网关稳定性如何？**
A：[胜算云实时监控](https://watch.shengsuanyun.com/status/shengsuanyun) 可查，可用率 > 99.9%。

### 数据与隐私

**Q：任务历史会上传云端吗？**
A：不会。任务历史、API Key、对话内容全部本地存储。

**Q：会收集用户数据吗？**
A：所有API请求一律只转发不做任何云端留存

**Q：能离线用吗？**
A：不能。Cline Chinese 依赖云端大模型推理，本地无法独立运行。

### 计费与充值

**Q：胜算云怎么计费？**
A：按 tokens 计费，不同模型单价不同（在控制台可查）。新用户送 10 元模力 + 首充 10% 加赠。

**Q：充值的余额是永久有效吗？**
A：具体有效期见 [胜算云用户协议](https://lean.shengsuanyun.com/apidocs/account/recharge-agreement)。

**Q：能开发票吗？**
A：企业用户可以，[胜算云控制台](https://console.shengsuanyun.com/user/overview/?from=cline-chinese) → 企业认证后申请。

## 📞 反馈与支持

| 渠道 | 适用场景 | 响应时间 |
|---|---|---|
| 🐛 [GitHub Issues](https://github.com/SSYCloud/cline-chinese/issues) | Bug 报告、功能建议 | 1-3 个工作日 |
| 💬 [GitHub Discussions](https://github.com/SSYCloud/cline-chinese/discussions) | 使用讨论、最佳实践 | 公开问答 |
| 📧 support@shengsuanyun.cn | 企业用户、媒体咨询 | 1 个工作日 |
| 💼 [胜算云工单](https://applink.feishu.cn/client/chat/chatter/add_by_link?link_token=661i3578-030a-4653-99ba-76acf3f28e0b) | 计费、API Key、企业服务 | 1 个工作日 |

> 复杂问题请走 GitHub Issue，便于其他人搜索到相同问题。

## 🏢 关于维护方 · 胜算云开源团队（SSY Cloud）

[胜算云](https://www.shengsuanyun.com/?from=cline-chinese) 是本项目的购买方与日常维护方，长三角国家技术创新中心重大扶持项目，专注打造工业级 AI 任务执行矩阵：

- **全球 API 算力供应链** —— 统一接入多家模型，路由最优节点，自动容灾
- **弹性算力容器** —— 云端快速并发执行 AI 任务
- **持久化工作流编排** —— 把多步 AI 任务串成可复用 pipeline
- **矩阵式执行** —— 多模型对比、多轮验证
- **共享知识库** —— 团队级 context 沉淀
- **[实时稳定性监控](https://watch.shengsuanyun.com/status/shengsuanyun)** —— 所有网关节点可用率透明

**胜算云为 Cline Chinese 用户提供的核心价值**：

- ✅ **API 网关与全球算力调度** —— 一份 Key 切多家模型，无需逐家注册
- ✅ **统一计费与发票** —— 多模型合并账单，企业可开票
- ✅ **新用户 10 元模力 + 首充 10% 加赠**
- ✅ **实时稳定性监控** —— 网关可用率公开透明

Cline Chinese 是社区项目 + 胜算云团队共同维护的开源分支。Leo 老师及原有核心贡献者继续活跃参与。

## 💡 加入Cline 中文版开发者社区
- 第一时间获取版本更新
- 获取使用教程和最佳实践
- 与开发团队直接交流
- 反馈 Bug 和提出功能建议
- 了解胜算云最新 AI 产品
<p align="center">
  <img src="https://github.com/SSYCloud/cline-chinese-ssy/blob/main/assets/docs/Cline%E5%BC%80%E5%8F%91%E8%80%85%E4%BA%A4%E6%B5%81%E7%BE%A4.png?raw=true" width="320" alt="Cline开发者社区">
</p>

## 版本更新说明
### 2026.07.30（ver .4.0.3）

🔥 本次更新带来了架构级重构和强大的插件生态！
- 新增
1. 新增 Cline SDK 运行时支持，所有任务（代理轮次、工具、MCP、检查点、压缩、遥测等）统一通过共享 SDK 会话层管理。

2. 新增 ClinePass 通行证（含引导流程、注册订阅、实时模型列表、额度提示）及 Customize 自定义市场，支持 Skills/MCP/Plugins 的发现、安装与卸载。

3. 新增 Cline Plugins 插件系统，支持通过自定义工具、工作流和 MCP 功能扩展 Cline；同步添加插件 MCP 支持及共享市场安装/卸载管道。

4. 聊天新增排队机制，忙碌时提交的消息自动排队并可取消；支持编辑已发送消息并重新生成。

5. 新增通用 SDK 提供商设置，支持更多提供商共享模型选择器、推理控制和配置持久化；额外新增 Fireworks GLM 5.2、Kimi K2.6 Fast/2.7 Code、Qwen 3.7 Plus、MiniMax M3、SAP AI Core、LiteLLM、Codex OAuth 及 OpenAI 兼容模型。

- 变更

1. VS Code 扩展从旧版任务实现迁移至共享 Cline SDK，构建/打包工作流迁移至 Bun。

2. 重新设计计划/执行模式处理（支持从计划切换至执行时自动继续）及提供商/模型配置（切换提供商时设置保留、会话自动重启）。

3. 简化提供商设置 UI 和终端执行路径；旧版 MCP 文件迁移至共享设置文件，安装后自动刷新无需重启。

4. 命令自动批准默认禁用（提升安全性）；删除旧版"Explain Changes"功能；临时禁用子代理以稳定 SDK 基础体验。

5. 更新任务历史处理（旧版历史可见性、元数据保留、删除行为修正）及压缩/错误限制路由。

- 修复

1. 修复市场边缘情况（安装后 MCP 刷新、标签页禁用、隐藏工作流、插件技能显示及卸载稳定性）。

2. 修复活动轮次聊天提交（排队状态及时显示、消息即时渲染、删除延迟发送）及编辑消息 Escape 取消。

3. 修复终端可靠性（Windows 输出捕获、PowerShell 处理、状态显示、超时、heredoc、重复回显等）。

4. 修复 SDK 消息预算（截断大型输出、限制助手文本/bash 摄入/媒体预算、规范化 JSON 输入）。

5. 修复登录与功能标志解析（启动时使用正确的用户身份，简化登录 UX）。

### 2026.07.21（ver .3.89.2）


1. 升级捆绑的 Anthropic SDK 至与 Node 24 运行时兼容，修复 VS Code 1.123+ 上 Anthropic 提供商问题。
2. 更新 Vertex AI 提供商至兼容的 Anthropic Vertex SDK 版本。

### 2026.07.13（ver .3.89.1）


1. 恢复 VS Code 1.123 及更高版本上的 Anthropic 提供商（Node 24 运行时破坏捆绑 SDK）。
2. 处理 DeepSeek V4 推理格式。


### 2026.06.29 （ver .3.86.5）
1. 修复和原版cline参数配置共享的问题，可能会导致需要重新配置，给您带来的不便，还请见谅。
2. 修复deepseek-v4修改上下文长度为1m不生效的问题。


## 免责声明

1. **使用风险**：本项目是一个开源的VSCode插件，用户在使用过程中可能会遇到的任何问题或风险，项目团队开发者不承担任何直接责任。

2. **数据安全**：本插件不会收集或存储任何用户数据。但在使用过程中，用户应注意保护自己的敏感信息和代码安全。

3. **知识产权**：
   - 本项目是基于Cline的汉化版本，原版权归属于Cline团队。
   - 汉化部分的内容采用与原版Cline相同的Apache-2.0许可证。
   - 用户在使用过程中应遵守相关的开源协议。

4. **免责声明**：
   - 本项目不提供任何明示或暗示的保证，包括但不限于适销性和特定用途适用性的保证。
   - 开发者不对任何直接或间接损失负责，包括但不限于利润损失、数据丢失等。
   - 用户使用本插件即表示同意承担使用过程中的所有风险。

5. **更新和维护**：
   - 开发者将努力维护本项目，但不保证及时更新或修复所有问题。
   - 本项目可能随时变更或终止，会及时同步到本项目中。

6. **合规使用**：
   - 用户在使用本插件时，必须遵守当地法律法规。
   - **严禁将本插件用于任何违法违规行为**（包括但不限于网络攻击、非法侵入、数据窃取、传播非法信息等）。
   - 项目开发者团队对用户利用本插件进行的任何违法行为及其产生的后果不承担任何法律责任。


## 📜 许可证

[Apache-2.0](https://github.com/SSYCloud/cline-chinese/blob/main/LICENSE)

汉化部分与上游 Cline 遵循相同许可证。本插件不收集或上传用户数据。安全披露流程见 [SECURITY.md](https://github.com/SSYCloud/cline-chinese/blob/main/SECURITY.md)。

## 致谢

- 上游 [Cline 团队](https://github.com/cline/cline) —— 本项目的基础
- [@flyfreee](https://github.com/flyfreee) —— 文档翻译
- Leo 老师 —— 项目发起人与初代维护者
- 所有 [贡献者](https://github.com/SSYCloud/cline-chinese/graphs/contributors)

> 如果喜欢这个项目，欢迎给本项目 **和** 上游 [Cline](https://github.com/cline/cline) 一个 ⭐️。
