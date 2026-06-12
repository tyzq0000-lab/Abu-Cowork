# 上游同步手册（Abu-Cowork → 扶摇）

本仓 fork 自 [PM-Shawn/Abu-Cowork](https://github.com/PM-Shawn/Abu-Cowork)，已做品牌改造（扶摇/Fuyao）、deep-link 安装、员工运行时契约、模型注入等大量改动。**上游更新必然产生冲突，自动合并不可行**——`.github/workflows/upstream-watch.yml` 每日监测上游 release 并开 issue，合入由人工（建议交给 Claude Code 执行）按本手册操作。

## 远程仓布局

```
origin    git@gitee.com:trustwork/fuyao-desktop.git   # 我们的主仓（推送目标）
upstream  https://github.com/PM-Shawn/Abu-Cowork      # 上游（只拉不推）
```

⚠️ **绝不向 upstream push**。首次配置：

```bash
git remote rename origin upstream      # 若 origin 仍指向上游
git remote add origin git@gitee.com:trustwork/fuyao-desktop.git
git fetch --all
```

## 合入流程

1. `git fetch upstream`
2. 在 `dev` 上开同步分支：`git checkout -b sync/upstream-<tag> dev`
3. `git merge upstream/main --no-ff`（或 merge 对应 release tag）
4. 按下表处理冲突
5. 验证（见下）全绿后，PR/merge 回 `dev`

## 冲突处理优先级表

| 冲突区域 | 处理规则 |
|---|---|
| `src/core/branding.ts` 及其引用处 | **一律保留我方**（常量引用替代上游字面量） |
| `~/.abu` 字面量（上游新增代码） | 改为 `DATA_DIR_NAME` 引用；workspace 维度 `{workspace}/.abu` 保留字面量或用 `WORKSPACE_DIR_NAME` |
| `ABU.md` / `.abu.json` 字面量 | 改走 `RULES_FILENAME` / `SHARE_EXT`；**兼容回退层（LEGACY_*）不可删** |
| `src-tauri/capabilities/default.json` | 保留我方 `$HOME/.uprow/**` glob；上游新增的能力条目按 `.uprow` 改写后采纳 |
| i18n 两个 locale | 上游**新增** key：采纳并立即本地化（Abu→扶摇）；上游**修改**的已有 key：对照我方扶摇文案手工融合 |
| `index.html` / 托盘 / AboutSection | 保留我方品牌版本，只采纳上游的功能性修改 |
| FeedbackSection / SponsorSection | 我方已删除——上游对它们的改动直接丢弃 |
| `ChatInput` 模型选择器 | 我方已隐藏——上游对 ModelSelector 调用处的改动评估后丢弃或移植到组件内 |
| deep-link / `src/core/employee/` / `src/core/deeplink/` | 我方独有，上游不会有；若上游新增同名概念需人工评估 |
| store persist `version`/`migrate` | 上游升版与我方升版冲突时：**取两者最大版本号+串联 migrate 分支**，并更新 `storeVersions.test.ts` |

## 合后必跑

```bash
npm run build && npm run lint && npm test
grep -ri "abu" src/ index.html   # 对照下方白名单查穿帮回流
```

**grep 白名单**（允许残留）：`branding.ts` 的 `WORKSPACE_DIR_NAME`/`LEGACY_*` 常量、`com.abu.app`（应用标识，档3）、`ABU_` env 前缀、`--abu-*` CSS 变量、`abu://command-output-` 内部事件名、`.abu-draft-meta.json` 侧车文件、测试 mock 路径、注释中的 workspace `.abu/` 路径。

再跑一轮 `npm run tauri:dev` 真机冒烟：启动品牌、对话、@员工、技能调用、设置页。

## 提交

同步分支合回 `dev` 后，commit message 注明上游 tag：`merge: sync upstream <tag>`；push 到 origin(gitee)。
