# Turtle UI Fixed

DeepSeek Harness TUI 插件，源自 DSH 中被删除的 TUI 包。

## 它是什么

这是基于 [Turtle UI](https://github.com/turtle1999/turtle-ui) 开发的 TUI 插件，而 Turtle UI 是 DeepSeek Harness 的“官方” TUI 插件。

本 Fork 的职责很清楚：

1. 使 Turtle UI 适配新版本的 DeepSeek Harness；
2. 同步 DeepSeek Harness 中的部分新功能。

本项目**绝不**新增任何原版 DeepSeek Harness 中没有的功能，也不接受相关的 Issues/PRs。

## 安装

> [!IMPORTANT]
> 
> 请使用通过 NPM 或本地构建安装的 DSH 使用插件。[DeepSeek Harness 桌面端](https://www.deepseek.com/harness/)中的 `dsh` 通过 Electron as Node 实现，此插件无法在此环境中工作。

运行以下命令：

```bash
dsh --profile tui add @shihaoshen/dsh-tui-fixed
dsh tui
```

<!-- 以防你不知道，这个配置就是为 turtle-ui（或者是原来内置的 tui 包）预留的。 -->

## 源码布局

所有源码位于 `src/`：

| 路径 | 职责 |
| --- | --- |
| `index.ts` | 入口 `createTuiChat()`：挂载 pi-tui、按模型顺序渲染 transcript、驱动 `main` agent、键盘与 overlay 管理、运行状态/计时动画 |
| `startup.ts` | `tui-startup` provider：解析 `--resume` / `--session` / `--help`，提供 `tuiStartup` 会话身份 |
| `prompt.ts` / `config.ts` | TUI prompt 模板与配置（`TuiConfigSchema`） |
| `runtime.ts` | 终端与进程退出的边界抽象（类型导出） |
| `chat/` | 自动补全、会话通道、文件补全、模型命令、skill 调用、resume、问答队列、辅助函数、token 统计、计时 |
| `components/` | 对话框、文本、主题、XML 工具输出、内容渲染、transcript 组件 |
| `extension/` | overlay 管理器与类型定义 |
| `invariant.ts` | 运行期不变量校验 |

终端 UI 框架使用经 patch 的 `@earendil-works/pi-tui`（`0.80.7`），作为 devDependency 在构建时一并打进 `lib/`，最终使用者无需单独安装。

## 本地开发

需要相邻目录结构：

```text
deepseek-harness/   ← sibling，先构建
dsh-tui-fixed/      ← 本仓库
```

构建顺序：先构建 Harness，再构建本仓库。

```sh
(cd ../deepseek-harness && pnpm install && pnpm run build)
pnpm install
pnpm run build
```

把本地构建产物作为 `file:` 包装入 `tui` profile（每次重新构建后需再执行一次 `add` 以刷新副本）：

```sh
dsh plugin --profile tui add file:.
dsh --profile tui
```

会话身份由启动参数决定：

- `dsh --profile tui` —— 每次启动新建一个会话；
- `--session <id>` —— 显式指定新会话 id；
- `--resume <session>` —— 继续一个已持久化的会话。

应用从 `tui-startup` provider 读取这些参数，会话绑定的各行据此注入，避免在错误会话上激活。


## 交互速查

- 发送：`Enter`；换行：`Shift`/`Alt+Enter`；历史：`Up`/`Down`
- `Esc` 取消当前 turn；`Ctrl+O` 循环工具卡片（折叠 / 展开 / 隐藏）；`Ctrl+R` 切换推理块显示；`Ctrl+L` 重绘
- `Ctrl+C` 运行时取消、空闲时清空或退出；`Ctrl+D` 退出
- 斜杠命令：`/details`、`/skill:<name> [说明]` 等，完整列表见应用内帮助

## 校验命令

```sh
pnpm run typecheck   # 类型门禁
pnpm test            # 单元与终端快照测试
pnpm run build       # tsc -b && tsdown
```

## 已知限制

- 应用内 `/resume` 交接与退出提示依赖已被移除的 TUI 专用启动器，**当前不可用**；会话恢复请改用命令行 `--resume`。
- 类型检查与运行时均要求相邻已构建的 `deepseek-harness`；单独检出本仓库无法仅凭 `prepare` 完成类型校验。
