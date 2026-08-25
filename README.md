# dsh-better

> **Unofficial community plugin.** Not affiliated with DeepSeek. 非官方社区插件，与 DeepSeek 官方无关。依靠AI生产的代码。

更好的 DSH —— 一个符合 DeepSeek Harness 插件标准的双半部插件（host + browser），为 dsh Web GUI 增加四组能力。

中文 · [English](README.en.md)

## 安装

已发布到 npm，终端里一条命令即可装入你的 DSH：

```bash
dsh plugin --profile web add dsh-better
```

安装后重启 DSH 生效，设置页出现「更好的 DSH」入口。

## 功能

设置 → 更好的 DSH：

- **已归档会话** —— 列出所有已归档对话，可复原回原工作区原位置，也可彻底删除存档；
- **任务通知** —— 网页保持打开时，任务停止弹出系统原生通知（Windows Toast / macOS / Linux 桌面通知）：Agent 提问或给出选项、任务完成、任务出错三种时机；
- **检查更新** —— 对比本地与最新发行版（遵循 semver 规则），一键复制全套更新命令，还能在源码目录直接弹出独立终端窗口供你粘贴执行；
- **模型路由** —— 关键词规则按顺序匹配用户消息，命中即把当前会话切到指定提供方 / 模型 / 推理强度，写入前经 DSH 实时注册表精确校验；可选开启 `model_route` 工具，让智能体在对话中自主切换模型，且只能切到白名单逐条列出的组合（设计移植自 [dsh-model-router](https://github.com/superboy911/dsh-model-router)，按需裁剪）。

所有配置改动实时生效，无需重启。

## 问题反馈

遇到任何问题——安装失败、界面异常、通知不响、路由不生效……或者有任何功能建议——都欢迎到 [Issues](https://github.com/wackyju2-beep/dsh-better/issues) 提出，多多益善。描述越具体（DSH 版本、操作系统、复现步骤），修复越快。
