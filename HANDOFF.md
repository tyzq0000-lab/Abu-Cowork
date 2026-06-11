# 扶摇 (Fuyao) 桌面端 — Session 交接文档

> 给接手"扶摇桌面端功能/UI 调整 + 版本更新"工作的新 session。先读 `CLAUDE.md`(项目规约)与 `../CLAUDE.md`(跨端共享上下文),本文件补充**项目构想、当前实施状态、踩坑记录与下一步抓手**。新 session 请延续相同角色与工作约定。

## 1. 整体构想 (Vision)
- 平台名 = **uprow**;桌面端(及未来云端)产品名 = **扶摇 / Fuyao**。
- 扶摇 = 本地 AI 办公助手桌面应用:**Tauri 2 + React 18 + TypeScript(strict)+ TailwindCSS v4 + Zustand**;灵感来自 Claude Code 的 Cowork 模式;多 agent 架构 + 可扩展 Skills/Subagents。
- 本仓库从 **abu-cowork fork** 而来,正在做品牌改造 + 功能演进。与 console 控制台是**两个分开的仓库**(勿合并、脱敏约定,见父目录 `../CLAUDE.md`)。
- Phase A = 员工面板:复用既有 agent 系统/工具箱,`employeeLoader` 读 `~/.abu/employees/` 的 WorkBuddy 包。

## 2. 当前实施状态 (Current state)
- **品牌改造收尾完成**:`src/i18n/locales/en-US.ts`、`zh-CN.ts` 正文 Abu→扶摇/Fuyao;默认代理显示名 locale-aware;`alt` 文案改 `t.common.appName`;导出默认文件名 `fuyao-conversation-*.abu.json`。已提交(`6aa0373`、`bd1f8bb`)。
- **`fuyao://` URL scheme 已注册**(Tauri v2 deep-link 插件),提交 `1ef5729`。5 处改动:
  - `src-tauri/tauri.conf.json` → `plugins.deep-link.desktop.schemes: ["fuyao"]`
  - `src-tauri/Cargo.toml` → `+ tauri-plugin-deep-link = "2"`;`src-tauri/src/lib.rs` → `+ .plugin(tauri_plugin_deep_link::init())`
  - `src-tauri/capabilities/default.json` → `+ "deep-link:default"`;`gen/schemas/*` 已随之重生成
- **deep-link 接收逻辑已实现**(平台下载+安装模式,用户选定):
  - **协议契约**:`fuyao://install?type=employee|skill&url=<encoded zip URL>&name=<显示名>`。`url` 域名白名单见 `src/core/deeplink/parser.ts` 的 `ALLOWED_DOWNLOAD_HOSTS`(现仅 OSS 域;http 仅放行 localhost/127.0.0.1 供本地调试);uprow 平台域名上线后在该常量追加。
  - 链路:`src/core/deeplink/index.ts`(onOpenUrl 入口,去重+唤窗)→ `parser.ts`(校验)→ `DeepLinkInstallDialog.tsx`(确认弹窗)→ `installer.ts`(plugin-http 下载 → fflate 解压校验 → 落盘 `~/.abu/employees|skills/`,覆盖式部署)→ `discoveryStore.refresh()` + toast。
  - Rust:`tauri-plugin-single-instance`(deep-link feature,二次启动转发 URL);debug 构建 `register_all()` 运行时注册 scheme(会把 HKCU 的 fuyao 协议指到 dev exe,装正式包后会被重新覆盖)。
  - capabilities 给 `$HOME/.abu/employees/*/.codebuddy-plugin(/**)` 补了 fs 白名单(Tauri glob 默认不匹配点前缀目录)。
  - 员工包解压兼容 Windows 反斜杠 zip 条目(PowerShell Compress-Archive 产物)。
  - **已真机 e2e 验证**(2026-06-12,Windows dev):本地 zip 服务 → 链接触发 → 弹窗 → 确认 → 完整落盘(含点目录)。踩坑记录:① App 启动 effect 里注册监听器**不能加模块级 started 守卫**——StrictMode 双挂载会让唯一监听器被 cleanup 注销(已修);② single-instance 的 deep-link 自动触发之外,回调里还手动 emit 了一次 `deep-link://new-url` 兜底,前端 3s 去重窗口吸收双投递。
- **Windows 安装包已产出**:`src-tauri/target/release/bundle/nsis/扶摇_0.23.1_x64-setup.exe`(11.5 MB)。
- **保留不动的技术标识符**(品牌只改展示文案,不动这些):`com.abu.app`(bundle id)、`~/.abu/`(数据目录)、`.abu.json`(分享格式后缀)、`ABU.md`(项目规则文件名)。

## 3. 版本更新功能 (Version-update — 客户端已实现,别重造)
- **客户端已完整实现**于 `src/core/updates/checker.ts`:
  - `checkForUpdate(force?)` — 6h 间隔,用 `@tauri-apps/plugin-updater` 的 `check()`;OSS `latest.json` body 仅含 GitHub URL 时,再从 GitHub API 富化 release notes。
  - `downloadAndInstallUpdate()` — 带进度回调;`restartApp()` — `relaunch()`。
- 状态在 `src/stores/settingsStore.ts`(`lastUpdateCheck`/`updateInfo`/`updateChecking`/`updateDownloadProgress`/`updateInstalling`);UI 在 `src/components/settings/sections/AboutSection.tsx`;通知走 `src/core/notice/bus`(`update_available`,按版本去重);`App.tsx` 已接入定时检查。
- 配置:`tauri.conf.json > plugins.updater` → endpoint `https://abu-agent.oss-cn-beijing.aliyuncs.com/latest.json`,`pubkey` 已内置;`createUpdaterArtifacts: true`;`Cargo` 有 `tauri-plugin-updater`。
- **缺口 = 发布侧管线**(用户说的"加入版本更新功能"大概率指这块,非重写客户端):
  1. 构建签名 updater 产物需 `TAURI_SIGNING_PRIVATE_KEY`(minisign 私钥)——**绝不进仓库/分发包**(同 `CLAUDE.md` 的 Langfuse 红线)。
  2. 生成并发布 `latest.json` 到 OSS endpoint(`.github/workflows/release.yml` 可作起点)。
  3. (可选)endpoint/pubkey 是否随品牌迁到 uprow 域名待定。

## 4. 构建/发版踩坑 (发版前必读)
- 本机 **Clash for Windows 系统代理是 TLS-MITM**;Tauri 的 rustls 下载器只认自带 Mozilla 根、**不读 Windows 信任库** → 下载 NSIS 工具链报 `UnknownIssuer`。把 `HTTP(S)_PROXY` 指到 Clash 也救不了(MITM 本身)。
- **解法 = 手动喂 Tauri NSIS 缓存** `%LOCALAPPDATA%\tauri\NSIS`:
  - `nsis-3.11.zip` 内容铺平(`makensis.exe` 在根目录,别多套一层文件夹);
  - 插件 `nsis_tauri_utils.dll` **必须是 cli 2.11.1 锁定的 `v0.5.3`(SHA1 `75197FEE3C6A814FE035788D1C34EAD39349B860`)**,且放在 **`Plugins\x86-unicode\additional\`**(多一层 `additional`)。版本/路径错 → Tauri 判 missing/mis-hashed 又去下载 → 撞墙。常量见 `tauri-bundler .../bundle/windows/nsis/mod.rs`。
- `createUpdaterArtifacts: true` 在没有 `TAURI_SIGNING_PRIVATE_KEY` 时**构建直接失败**;出安装包时可临时设 `false`,**完成后改回 `true`**。
- **建议正式发版在能直连 GitHub 的环境/CI 构建**(避开 NSIS 下载坑),并在 CI 注入签名私钥。

## 5. Git 状态 & 发版纪律
- 当前 `dev` 分支,领先 `origin/dev` 6 个 commit,**未 push**(等用户确认)。`main` 禁止直接开发,只接受 dev→main merge。
- 发版三处版本号必须同步:`package.json` / `src-tauri/tauri.conf.json` / `src-tauri/Cargo.toml`(当前均 `0.23.1`)。Release notes 模板见 `RELEASING.md`。

## 6. 角色与工作约定 (新 session 必须延续)
- 严守 `CLAUDE.md` 行为准则:**B1** 先暴露歧义再动手;**B2** 把祈使句翻成可验证目标、自循环到验证通过再回报;**B3** surgical(只动该动的,不顺手重构,预存 dead code 先问不删)。
- TS strict、`@/` 别名、用 union 类型而非 `enum`;表单控件**强制**用 `src/components/ui/`(禁手搓 input/select/toggle/switch);i18n 全量(先在 `TranslationDict` 加 key,再补 `zh-CN`+`en-US`);Zustand `persist` 改 schema 必须升 `version` + 加 `migrate` + 更新 `storeVersions.test.ts`;跨平台用 `src/utils/platform.ts`、`pathUtils.ts`。
- 桌面端跑 **`npm run tauri:dev`(带冒号,走 `com.abu.app.dev` 隔离)**;**别用空格版 `npm run tauri dev`**(会污染正式对话数据)。UI/行为类改动需真机 `tauri:dev` 跑一遍才算完(MEMORY `feedback_tauri_e2e_required`)。
- 提交前必过 `npm run build` + `npm run lint`;动核心逻辑(store/core/agent/skill)跑 `npm test`。**不自动 commit/push**,等用户确认;Conventional commits。
- 评审/子代理产出先 **sanity-check**(`CLAUDE.md` §15;本项目实测单轮 17 条曾 14 条误报),代码里复现再行动,不盲信外部权威。
- **成本意识**:谨慎使用子代理与大规模构建(本交接前的会话成本极高)。
- 环境:有 **GateGuard 钩子**会在每个文件首次编辑/首条 Bash 前要求"陈述事实",首次触发后照常重试即过。

## 7. 下一步抓手
1. **版本更新发版管线**:签名私钥经 CI 注入、产 updater 产物、发 `latest.json` 到 endpoint;按需把 endpoint/pubkey 迁到 uprow 品牌域名。(用户决定:等功能/UI 调整完、形成新版本后一并做。)
2. **deep-link 后续**:uprow 平台下载 API 上线后,把正式域名加进 `ALLOWED_DOWNLOAD_HOSTS`;平台侧"部署到桌面端"按钮生成 `fuyao://install?...` 链接即可打通。
3. 用户后续的功能/UI 调整。

## 8. 数字员工"开箱为空"约定
- 安装包**不含**任何员工包(resources 只有 builtin-skills/builtin-agents(空)/python-runtime/browser-extension);全新机器装包后员工列表本来就是空的,由企业用户在平台雇佣后经 deep-link 部署进来。
- 本机曾有两个测试包(content-creator→文爆爆、new-media-ops→运小运)在 `~/.abu/employees/`,2026-06-11 已移到 `~/.abu/employees.bak/`(确认无误可删)。注意安装版与 dev 版共用 `~/.abu/`。
- `registry.ts` 仍内置 5 个示例人格(高级开发工程师/产品经理/数据分析师/公众号编辑/HR 招聘官)——用户选择保留作开箱体验,与"员工包为空"不冲突。
