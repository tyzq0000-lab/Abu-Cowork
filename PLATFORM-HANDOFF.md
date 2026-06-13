# uprow 平台端交接文档 — 聘用·下载·部署链路

> 写给**负责 uprow 平台(console 控制台)调整**的 session。本文件由扶摇桌面端仓库维护,描述桌面端**已实现的契约**与**平台侧待补的服务端能力**,供平台端按此对齐。桌面端与平台是**两个分开的仓库**(勿合并、脱敏约定见各自 `CLAUDE.md`)。
>
> **铁律(三端独立性)**:扶摇桌面端 / uprow 平台 / 数字员工包各自保持通用性,平台侧实现不得为单一员工包定制、不得削减桌面端已有的通用接收能力。

---

## 1. 现状结论(codex 已逐条代码核验)

平台侧"数字员工铸造 + 聘用"目前是**前端态**,缺服务端闭环:

- 平台铸造**只存解压后的文件**,无原始 ZIP 留存、无包版本绑定记录。
- **无聘用服务端记录**:聘用成功仅前端 `setHired`,运行记录里 `package_key` / `owner_id` 均为 `null`。
- **无下载接口**:平台不提供员工包 ZIP 的下载 URL。
- **无 `fuyao://install` 调起**:平台没有"部署到桌面端"的按钮 / deep-link 生成。

→ 结论:桌面端已具备完整"链接触发 → 下载 → 安装"接收能力(见 §3),**链路断点在平台侧**:缺"留存原始包 + 签发下载 URL + 生成 deep-link"。

---

## 2. 目标链路(端到端)

```
用户在平台聘用员工
  → 平台服务端写聘用记录(owner_id + package_id + version 绑定)
  → 平台签发短时效签名 ZIP 下载 URL(如 OSS 签名 URL)
  → 平台"部署到桌面端"按钮生成 fuyao://install?...(见 §3 契约)
  → 用户点击 → 扶摇桌面端接收 → 确认弹窗 → 下载校验落盘
  →(可选)桌面端回传安装回执 → 平台标记"已部署"
```

平台侧需新增:**聘用记录表 / 原始包留存(OSS)/ 签名下载 URL 签发 / deep-link 生成**。桌面端无需平台改动即可接收(契约 v1 已上线)。

---

## 3. deep-link 契约 v1(桌面端已实现,平台按此生成)

**协议格式**:

```
fuyao://install?type=employee|skill&url=<URL编码的ZIP直链>&name=<显示名>
```

- `type`:`employee`(员工包)或 `skill`(技能包)。
- `url`:ZIP 直链,**必须 URL 编码**;域名受白名单约束(见下)。
- `name`:确认弹窗展示的显示名。

**域名白名单**(桌面端 `src/core/deeplink/parser.ts` 的 `ALLOWED_DOWNLOAD_HOSTS`):

- 当前仅 `abu-agent.oss-cn-beijing.aliyuncs.com`(OSS 域);
- `http://` 仅放行 `localhost` / `127.0.0.1`(本地调试);
- ⚠️ **uprow 平台正式下载域名上线后,务必通知桌面端把域名追加进该白名单**,否则桌面端会拒绝下载(`INVALID_URL` / 域名不在白名单)。

桌面端落盘路径:`~/.uprow/employees/` 或 `~/.uprow/skills/`(覆盖式部署)。

---

## 4. 契约 v2 增强(平台侧可设计,桌面端向前兼容)

桌面端 parser **忽略未知参数**,故平台可提前在 URL 上携带以下可选参数,桌面端的校验逻辑随平台实现分期接入:

- `employeeId` — 平台侧员工/包标识。
- `version` — 包版本号(用于桌面端去重/升级提示)。
- `sha256` — ZIP 内容哈希(桌面端可校验完整性)。
- `token` — 聘用授权令牌(用于服务端鉴权下载,见 §5 中期方案)。

平台先加无妨;桌面端按上线节奏逐步启用校验。

---

## 5. key 保密策略(分期,平台主导)

员工包内 `modelConfig` 携带模型 provider 配置(含 `apiKey`)。**桌面端无法根治 key 可被从 ZIP 提取的问题**(`VITE_*` / 包内明文均可被扒),根治在平台侧:

- **MVP(现状,接受可截获)**:key 随包下发,桌面端安装后**落盘 plugin.json 时把 key 置空**、key 进加密 secret store。仍可在传输/ZIP 中被截获——仅适合内测。
- **中期**:平台**按企业签发独立 key**(带配额、可吊销);下载用 §4 的 `token` 鉴权,避免 key 长期裸奔。
- **长期**:**服务端中转**,key 不下发客户端(桌面端调用走平台代理端点)。这是面向终端用户的唯一安全形态。

**铸造界面**应让铸造者配置 `modelConfig`,字段 schema 见桌面端:
- 文档:`EMPLOYEE_PACKAGE_RUNTIME_CONTRACT.md`
- 类型:`src/core/employee/contract.ts` 的 `EmployeeModelConfig`:
  ```ts
  interface EmployeeModelConfig {
    provider: {
      apiFormat: 'anthropic' | 'openai-compatible';
      baseUrl: string;
      model: string;
      apiKey?: string;
    };
    imageGen?: { baseUrl?: string; model?: string; apiKey?: string };
  }
  ```

---

## 6. license 治理(codex 发现的风险,平台铸造流程须处理)

员工包整合的上游技能存在授权风险:

- `dbskill` — **CC BY-NC**(禁商用)。
- `guizang-social-card` — 实为 **AGPL** 却标成 MIT。

平台铸造流程需:
- **license 申报 / 账本**:桌面端 contract 已有 `sources` 字段(`EmployeeSourceCapability`)可承载来源与授权声明。
- **商用包须剔除或更换授权**:CC BY-NC / AGPL 等不可直接进商用员工包。

---

## 7. 包规范提醒

- 现网测试包(如"运小运")**无 `runtime` / `modelConfig`**(成熟度仅 L1)。
- 平台铸造应按桌面端 runtime 契约生成**完整包**:含 `runtime`(workflow 模板)、`modelConfig`、`avatars` 的**实际文件**(不只引用),达到 L2/L3 成熟度。
- 成熟度分级 L0–L3 定义见 `EMPLOYEE_PACKAGE_RUNTIME_CONTRACT.md`。

---

## 8. 桌面端已就绪、平台可直接依赖的能力清单

| 能力 | 状态 | 入口 |
|---|---|---|
| `fuyao://` URL scheme 注册 | ✅ 已注册 | Tauri deep-link 插件 |
| deep-link 接收 + 去重 + 唤窗 | ✅ | `src/core/deeplink/index.ts` |
| URL/域名白名单校验 | ✅ | `src/core/deeplink/parser.ts` |
| 下载 → 解压校验 → 落盘 | ✅ | `src/core/deeplink/installer.ts` |
| 员工专属 provider 注入 + 路由 | ✅ | `resolveAgentExecution`,settingsStore v33 |
| 安装确认弹窗 | ✅ | `DeepLinkInstallDialog.tsx` |
| 安装回执回传 | ❌ 待设计 | (契约 v2 可加) |

平台侧只要补齐 §2 的"留存 + 签发 URL + 生成 deep-link",即可打通端到端。
