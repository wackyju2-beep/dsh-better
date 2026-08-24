# dsh-better

> **Unofficial community plugin.** Not affiliated with DeepSeek. 非官方社区插件，与 DeepSeek 官方无关。依靠AI生产的代码。

更好的 DSH —— 一个符合 DeepSeek Harness 插件标准的双半部插件（host + browser），为 dsh Web GUI 增加三组能力。

中文 · [English](README.en.md)

## 功能

### 已归档会话

设置 → 更好的 DSH → 已归档会话：

- 列出所有已归档对话（标题、目录、归档时间、存档类型）；
- 每行尾部是和侧边栏一致的「三个点」菜单：**复原** / **删除**；
- **复原**：把会话从全局归档集移除，回到原工作区的原位置（归档从不改动工作区记账，所以复原即还原）；
- **删除**：删除本地的会话存档文件（`.jsonl` 日志），并从工作区记录与归档集中清除该会话。正在直播的会话会被拒绝删除（`session-live`）。

数据通道是插件宿主半部注册在 `/api/dsh-better/*` 的 exact 路由（仅限回环访问），所有变更直接写持久化的 workspace 域——浏览器经由网关现有的 `domain/changed` 转发即时收敛，无需刷新。

### 任务通知

设置 → 更好的 DSH → 任务通知：网页在浏览器中保持打开时，任务停止会弹出**系统原生通知**（Windows Toast / macOS 通知中心 / Linux freedesktop 桌面通知，带 DeepSeek 鲸鱼图标；由标准浏览器 Notification API 实现，跨平台通用）：

| 时机 | 通知内容 |
| --- | --- |
| Agent 发来选项 / 提问 | `选项` + 逐条编号的选项文本 |
| 任务完成停止 | 会话标题 + `已完成`（用户中止显示 `已停止`） |
| 任务因错误停止 | `错误` + 错误信息 |

- 通知引擎通过包装会话运行时的两个帧入口观察事件流（只旁路观察、绝不改动分发）；子代理子会话默认不重复提醒。
- 授权、启用开关与三类时机开关保存在浏览器本地（localStorage）。
- 关闭网页后通知自然停止（浏览器 Notification API 的固有边界）。

### 检查更新

设置 → 更好的 DSH → 检查更新：

- **版本面板**：当前版本、最新版本、安装方式（源码构建 / 发行包安装 / 未知）、源码目录，状态灯区分「已是最新 / 有新版本可用 / 暂时无法比较」；最新版本带「预发布」徽章、发布日期与 Release 链接；
- 版本比较遵循 semver 规则（`0.1.1-rc.2 < 0.1.1`、数字预发布标识符按数值比较等）；
- **更新命令**：`git clone` → `pnpm install` → `pnpm run build` → `pnpm dsh web` 一键复制全部。界面明确注明：**这套命令仅对源码构建的 dsh 生效**；发行包安装请改用对应的包管理器命令升级；
- **在源码目录打开终端**：弹出一个独立的命令行窗口，由你自己粘贴执行上面的命令，插件绝不代输。Windows 经 `cmd /c start` 为内层 cmd 分配全新控制台（绕开 detached spawn 的 `DETACHED_PROCESS` 不分配控制台、窗口不可见的坑）；macOS 打开 Terminal.app；Linux 依次尝试 x-terminal-emulator / gnome-terminal / konsole / xfce4-terminal（全缺失时友好报错，不影响后端）。窗口完全独立于后端生命周期，不受其管理或终止；
- 最新版本信息有三级来源，任一可用即成功：
  1. GitHub API `/releases/latest`（该端点排除预发布——仓库只有预发布时会 404）；
  2. GitHub API `/releases` 列表取第一个非草稿条目（失败自动重试一次）；
  3. `github.com/<repo>/releases.atom` 订阅源（与前两者不同主机，api.github.com 整体故障时的独立通路；失败自动重试一次）。

  成功结果缓存 5 分钟；24 小时内有过成功值的话，全部来源失败时兜底展示旧值并带「缓存数据（可能过期）」徽章；
- **源码目录自动识别**（识别顺序如下，结果在进程内缓存）：
  1. `DSH_BETTER_REPO_ROOT` 环境变量显式指定（需是合法源码树）；
  2. 从启动入口（`argv[1]`）与工作目录向上查找最近的 `@deepseek-ai/dsh` package.json——源码运行与打包安装都能命中；
  3. node 可执行文件旁的 pnpm 全局 store（`<pnpm>/global/*/node_modules/@deepseek-ai/dsh`）；
  4. 约定路径扫描 `<盘符>:\.dsh\deepseek-harness`（C..Z）。
