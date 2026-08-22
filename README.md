# dsh-better

> **Unofficial community plugin.** Not affiliated with DeepSeek. 非官方社区插件，与 DeepSeek 官方无关。

更好的 DSH —— 一个符合 DeepSeek Harness 插件标准的双半部插件（host + browser），为 dsh Web GUI 增加两组能力：

## 功能

### 已归档会话

设置 → 更好的 DSH → 已归档会话：

- 列出所有已归档对话（标题、目录、归档时间、存档类型）；
- 每行尾部是和侧边栏一致的「三个点」菜单：**复原** / **删除**；
- **复原**：把会话从全局归档集移除，回到原工作区的原位置（归档从不改动工作区记账，所以复原即还原）；
- **删除**：删除本地的会话存档文件（`.jsonl` 日志），并从工作区记录与归档集中清除该会话。正在直播的会话会被拒绝删除（`session-live`）。

数据通道是插件宿主半部注册在 `/api/dsh-better/*` 的三个 exact 路由（仅限回环访问），所有变更直接写持久化的 workspace 域——浏览器会经由网关现有的 `domain/changed` 转发即时收敛，无需刷新。

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

## 安装（web profile）

```sh
# 1. 把包放进 profile 的 node_modules
#    cp -r dsh-better "$DSH_HOME/profiles/web/node_modules/"
#
# 2. 在 profiles/web/package.json 中：
#    dependencies += "dsh-better": "0.1.0"
#    dsh.profile.bundles += "dsh-better"
#
# 3. 重启 dsh web
```

## 卸载

从 profiles/web/package.json 移除上面两行并删除 node_modules/dsh-better，重启即可。

## 结构

```
package.json        dsh.client 声明（platform: web）+ exports["./client"] + bundle patch 声明
cordis.patch.yml    作为 profile bundle 时自动 insert 宿主插件行
lib/index.js        宿主半部：cordis 插件（name/inject/apply），exact 路由 + 域变更 + 注册表重启
lib/client.js       浏览器半部：__ModuleLoader__ 打包体（无构建步骤），settings.section + 通知引擎
```
