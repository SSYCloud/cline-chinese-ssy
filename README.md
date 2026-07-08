# 🎯 Cline 中文版

## 目录
- [为什么选择 Cline 中文版](#-为什么选择-cline-中文版)
- [功能展示](#-功能展示)
- [快速开始](#-快速开始)
- [常见问题](#-常见问题)
- [项目说明](#-项目说明)

本项目是基于 Cline 打造的中文增强版本，由[胜算云](https://www.shengsuanyun.com/?from=CH_SBXIG36D)持续维护，致力于为中文开发者提供更友好、低门槛的 VS Code AI 编码辅助体验。

<p align="center">
  <img src="https://media.githubusercontent.com/media/cline/cline/main/assets/docs/demo.gif" width="800" alt="Cline 中文版演示图">
</p>

Cline 中文版 能够逐步处理复杂的软件开发任务，不只是补全代码，而是作为 VS Code 中的 AI 编码助手参与到真实开发流程中。它会先分析项目结构、搜索相关代码、读取必要文件，并结合上下文理解你的目标，再继续执行后续操作。

在获得用户确认后，Cline 中文版可以帮助创建和修改文件、执行终端命令、观察输出结果、辅助定位问题，并在需要时调用浏览器能力处理前端页面调试、截图分析和交互检查等任务。对于已有项目，它能够逐步理解代码结构和上下文信息，在不打乱现有工作流的情况下参与编码、调试、重构和文档整理。

除了基础编码能力外，Cline 中文版还支持通过模型上下文协议（MCP）扩展更多工具能力。你可以根据团队工作流接入内部系统、知识库或自动化工具，让 AI 助手在更多真实业务场景中发挥作用。

相比传统只能回答问题或生成局部代码的助手，Cline 中文版更强调“结合上下文、分步骤执行、人工确认”的协作体验，让开发者在可控前提下更高效地完成任务。

典型使用场景包括：

- 阅读项目上下文并理解代码结构
- 创建、修改和整理代码文件
- 执行终端命令并观察输出结果
- 辅助排查报错、修复问题和更新文档
- 通过 MCP 扩展更多工具能力

## 🌟 为什么选择 Cline 中文版

### 1. 更完整的中文界面与使用体验

- Cline 中文版提供更适合中文用户的界面和说明
- 降低国内开发者上手成本，适配团队协作场景
- 持续维护与功能优化

<p align="center">
  <img src="https://github.com/SSYCloud/cline-chinese-ssy/blob/main/assets/docs/Cline中文版配置.png?raw=true" width="500" alt="Cline中文版配置">
</p>

### 2. 人工确认机制

- 文件修改前可查看变更内容
- 终端命令执行前由用户确认
- 更适合需要人工把关的开发环境

<p align="center">
  <img src="https://github.com/SSYCloud/cline-chinese-ssy/blob/main/assets/docs/人工确认.png?raw=true" width="500" alt="人工确认">
</p>

### 3. 模型接入灵活

Cline 中文版支持接入多种模型服务，包括 OpenRouter、Anthropic、OpenAI、Google Gemini、AWS Bedrock、Azure、GCP Vertex、Cerebras、Groq 等，也支持配置兼容 OpenAI API 的服务，或通过 LM Studio、Ollama 使用本地模型。

在使用过程中，扩展可以帮助展示任务过程中的 Token 消耗与相关调用成本，方便你随时了解整体使用情况。

- 支持多种主流模型服务与兼容 OpenAI API 的接口
- 支持本地模型或团队内部模型服务接入
- 如需更便捷地完成模型接入，也可通过[胜算云](https://www.shengsuanyun.com/?from=CH_SBXIG36D)获取相关服务支持

<p align="center">
  <img src="https://github.com/SSYCloud/cline-chinese-ssy/blob/main/assets/docs/model.png?raw=true" width="500" alt="模型与服务接入示意">
</p>

## 🤖 功能展示

### 1. 终端与任务执行

Cline 中文版可以在用户确认后执行终端命令，并结合输出结果继续完成后续任务。更自然地参与真实开发流程，协助完成依赖安装、构建执行、服务启动、测试运行等常见操作。

<p align="center">
  <img src="https://github.com/SSYCloud/cline-chinese-ssy/blob/main/assets/docs/执行命令.png?raw=true" width="500" alt="终端执行与任务推进">
</p>


对于开发服务器等长时间运行的任务，还可以通过“运行时继续”功能，让命令在后台保持运行的同时，继续推进当前工作流程，从而提升整体使用效率。


### 2. 代码与文件处理

Cline 中文版可以结合项目上下文协助阅读代码，并直接在编辑器中创建、修改和整理文件，适用于日常开发、代码调整和问题排查。

在文件修改过程中，你可以通过差异视图查看变更内容，并根据需要继续编辑、恢复修改，或在聊天中补充反馈，直到结果符合预期。

同时，它还可以结合 linter 或编译器返回的错误信息，辅助处理导入缺失、语法错误等常见问题，并在开发过程中持续优化修改结果。

<p align="center">
  <img src="https://github.com/user-attachments/assets/c5977833-d9b8-491e-90f9-05f9cd38c588" width="500" alt="文件修改与差异查看">
</p>

### 3. 浏览器与页面调试


在合适的工作流中，Cline 中文版还可以辅助进行页面检查、交互验证和多步骤调试任务。它能够结合浏览器操作能力执行点击、输入、滚动等常见操作，并在过程中获取页面截图和相关日志信息，帮助你更高效地定位前端页面中的运行时问题和视觉问题。

对于前端开发场景，你可以让它协助测试本地应用，例如在启动开发服务器后，对页面进行基础检查、流程验证和问题排查，从而减少手动来回切换、复制日志和重复操作的成本。

<p align="center">
  <img src="https://github.com/user-attachments/assets/bc2e85ba-dfeb-4fe6-9942-7cfc4703cbe5" width="500" alt="浏览器辅助调试示意">
</p>

### 4. MCP 与能力扩展

如果团队有特定工作流，Cline 中文版还可以通过 MCP 扩展更多工具能力。它不仅可以使用已有工具，也能够配合团队需求接入自定义工具，从而更好地适配内部系统、业务流程和协作场景。

例如，你可以让它接入工单系统、云资源管理能力或告警平台等外部工具，让 Cline 中文版在编码之外，进一步参与需求理解、信息获取、问题排查和自动化处理等任务。

常见场景包括：

- 获取 Jira 工单信息，帮助理解需求并推进开发任务
- 管理云服务资源，如查看实例状态或辅助执行运维相关操作
- 拉取最新告警或事件信息，结合上下文协助排查和修复问题


### 5. 上下文补充

为了更准确地理解任务目标，Cline 中文版支持补充多种上下文信息，例如文件、文件夹、问题列表或外部参考资料。通过提供更完整的上下文，它可以更快进入任务状态，并在现有项目中给出更贴合实际的协助。

常见的上下文补充方式包括：

- `@url`：粘贴 URL，让扩展获取并整理页面内容，适合补充最新文档或在线参考资料
- `@problems`：添加当前工作区中的错误和警告信息，帮助更快定位和处理问题
- `@file`：直接补充单个文件内容，减少重复读取文件的操作
- `@folder`：一次性补充整个文件夹中的相关内容，帮助更全面地理解项目上下文

<p align="center">
  <img src="https://github.com/SSYCloud/cline-chinese-ssy/blob/main/assets/docs/上下文.png?raw=true" width="500" alt="上下文补充示意">
</p>

### 6. Checkpoint 与恢复

在多步骤任务中，Cline 中文版支持快照、比较和恢复等能力，让你能够更安心地尝试不同方案。随着任务推进，扩展会记录关键步骤的工作区状态，方便你回看每一步的变化过程。

你可以通过“比较”功能查看快照与当前工作区之间的差异，也可以通过“恢复”功能回退到之前的状态，用于重新验证方案或继续后续开发。

例如，在本地 Web 服务调试场景中，你可以先恢复工作区来快速测试不同版本的效果；当找到更合适的实现方式后，再从对应状态继续推进任务，从而更安全地探索不同思路，而不必担心丢失当前进展。

<p align="center">
  <img src="https://github.com/user-attachments/assets/140c8606-d3bf-41b9-9a1f-4dbf0d4c90cb" width="500" alt="Checkpoint 与恢复示意">
</p>


## 🚀 快速开始
- 如果你还没有可用的模型服务或 API Key，可先前往 [胜算云](https://www.shengsuanyun.com/?from=CH_SBXIG36D) 注册获取相关服务，再回到扩展中完成配置。

<p align="center">
  <img src="https://github.com/SSYCloud/cline-chinese-ssy/blob/main/assets/docs/授权.png?raw=true" width="800" alt="胜算云授权">
</p>

1. 在 VS Code 中搜索并安装 `Cline 中文版`
2. 打开扩展完成模型或 API 配置
3. 用自然语言描述你的任务目标
4. 在执行文件修改或终端操作时进行确认
5. 根据结果继续补充上下文或迭代需求

## 💡 加入Cline 中文版开发者社区
- 第一时间获取版本更新
- 获取使用教程和最佳实践
- 与开发团队直接交流
- 反馈 Bug 和提出功能建议
- 了解胜算云最新 AI 产品
<p align="center">
  <img src="https://github.com/SSYCloud/cline-chinese-ssy/blob/main/assets/docs/Cline%E5%BC%80%E5%8F%91%E8%80%85%E4%BA%A4%E6%B5%81%E7%BE%A4.png?raw=true" width="320" alt="Cline开发者社区">
</p>


## 📖 常见问题

### 1. 安装后无法开始使用

通常是因为还没有完成模型服务配置或者 API Key 填写不完整。可先前往 [胜算云](https://www.shengsuanyun.com/?from=CH_SBXIG36D) 获取相关服务，再回到扩展中完成配置。

### 2. 已经配置了但没有返回结果

可以优先检查：

- API Key 是否有效
- 服务地址是否可访问
- 模型名称是否填写正确
- 当前网络环境是否允许访问对应服务

## 📝 项目说明

- 胜算云是面向技术开发者的 AI 基础设施服务商，聚焦大模型调用、开发工具适配等场景。聚合全球优质算力资源，通过秒级弹性调度技术，打破传统算力成本高、效率低的瓶颈。本项目由胜算云团队维护，持续进行中文本地化与使用体验优化
- 本扩展为基于开源项目的维护版本，不代表原始项目官方发行版
- 如需查看源码或反馈问题，可访问项目仓库


项目仓库：[SSYCloud/cline-chinese-ssy](https://github.com/SSYCloud/cline-chinese-ssy)

问题反馈：[GitHub Issues](https://github.com/SSYCloud/cline-chinese-ssy/issues)

## 📄 License

许可证信息以仓库中的 `LICENSE` 文件为准。
