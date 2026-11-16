# NQE ｜ 原生提问增强

DSH 插件：让 AI 该问的时候问、该确认的时候确认，回答还能直接贴图。

## 功能

**提问行为**

- **该问就问**：还有下一步需要你回应（选方案、确认效果、提供只有你知道的信息）时，它用提问代替结束本轮
- **动手前确认**：先把它的理解讲一遍，你确认或改完再开始（可关）
- **该收尾才收尾**：任务真的做完，直接汇报结果

**提问面板**

- 一屏一题，可翻页、可跳过、可收起
- 选项、文字、图片可以一起提交
- 选完选项，输入框右下角那颗键变成提交键
- 选择答案后自动翻页（可关）

## 设置

设置 → 插件 → **NQE｜原生提问增强**。

| 开关 | 作用 |
| --- | --- |
| **提问模式** | 提问行为的开关 |
| └ 执行操作前向用户确认理解是否正确 | 动手前先确认理解，默认开 |
| **提问窗口优化** | 用插件的提问面板；关掉用系统原生提问卡 |
| └ 选择答案后自动翻页 | 选完自动下一题，换答案不跳 |

## 装

### 压缩包

在 [Releases](https://github.com/xuiyun/nqe/releases) 下载最新的 `dsh-question-mode-*.tgz`，然后：

```
dsh plugin --profile desktop add <tgz 文件的绝对路径>
```

### 从 GitHub 装

```
dsh plugin --profile desktop add github:xuiyun/nqe
```

网页端把 `desktop` 换成 `web`。装完刷新页面；设置页里没出现就重启一次 DSH。

## 常见问题

**关掉「提问模式」会怎样？**

提问行为恢复默认。

**关掉「提问窗口优化」会怎样？**

改用系统自带的提问卡。

**贴的图存哪儿？**

本地 `DSH_HOME/attachments`，跟 DSH 自己的附件放在一起。

**答到一半关掉页面？**

提问会挂十分钟等你，超时后 AI 当作没答继续。

**卸载**

```
dsh plugin --profile desktop remove dsh-question-mode
```

## 技术说明

- **工具**：`ask_user`（JSON Schema），走 `/dsh-question-mode/pending` 与 `/answer`，超时 10 分钟
- **提示词段**：`question-mode:policy`，开关打开时注入
- **兜底**：监听 `agent/turn-stopping`，每轮最多一次
- **座位**：`conversation.input.dock`、`plugins.bundle.config`、`conversation.input.attachments`
- **状态**：`$DSH_HOME/question-mode.json`（`active` / `optimized` / `confirmFirst`）
- **日志**：`$DSH_HOME/question-mode.log`
- **自测**：`node render-check.mjs`

## 许可

MIT
