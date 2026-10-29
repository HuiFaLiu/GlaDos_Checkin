# GLaDOS Auto Check-in

> GLaDOS 每日自动签到浏览器扩展 — 多域名自动切换、Cookie 认证、失败重试、随机签到、签到通知、历史记录

## ✨ 功能

- ⏰ **自动签到** — 每天定时自动签到，无需手动操作
- 🌐 **多域名自动切换** — 依次尝试 `glados.cloud` / `glados.space` / `railgun.info` / `glados.one`，自动使用有登录 Cookie 且可访问的域名
- 🎲 **随机时间段** — 设置签到时间窗口（如 8:00~22:00），每天随机抽一个时间签到
- 🔁 **失败自动重试** — 网络超时、429/5xx 等临时故障按 5/10/20/40/60 分钟退避重试，最多 5 次
- 🩹 **漏签补签** — 浏览器在签到窗口结束后才启动时，会立即补签，而不是直接跳过当天
- 🔔 **签到通知** — 签到后弹出系统通知，显示成功/失败、域名及剩余天数
- 👤 **用户信息** — 显示当前登录邮箱、剩余天数和积分
- 📜 **历史记录** — 最多保存 100 条签到记录，支持分页浏览和导出 CSV
- 🩺 **网络诊断** — 一键检测四个域名的连通性、Cookie 数量和登录态
- ✋ **手动签到** — 随时一键签到

## 📦 安装

### 方式一：加载解压文件夹（推荐）

1. 下载本仓库并解压（或 `git clone`）
2. 打开 Chrome，地址栏输入 `chrome://extensions`
3. 右上角开启 **开发者模式**
4. 点击 **加载已解压的扩展程序**
5. 选择 `glados-checkin` 文件夹

### 方式二：打包 CRX 安装

1. 在 `chrome://extensions` 页面点击 **打包扩展程序**
2. 选择 `glados-checkin` 文件夹
3. 生成 `.crx` 文件后拖入 Chrome 安装

## 🚀 使用

1. 打开 [https://glados.cloud](https://glados.cloud) 并登录
2. 点击浏览器工具栏的扩展图标
3. 查看状态、手动签到或修改设置
4. 之后每天会自动签到，无需任何操作

> **从旧版本升级？** 旧域名 `glados.one` 在部分网络下已无法直连，且 Cookie 不跨域名共享。
> 升级后请在 `https://glados.cloud` 重新登录一次，扩展会自动识别新域名的登录态。

### 设置说明

| 设置项 | 说明 |
|--------|------|
| 自动签到 | 开启/关闭每日自动签到 |
| 固定签到时间 | 关闭随机时使用的固定时间 |
| 随机时间段 | 开启后在设定时间窗口内随机抽取签到时间 |
| 签到窗口 | 随机签到的起止时间范围 |
| 签到后通知 | 开启/关闭系统通知 |
| 网络诊断 | 检测四个域名的连通性、Cookie 和登录态 |

## 🤖 给 AI Agent 的安装 / 配置 / 使用示例

本仓库是**免构建**的 Chrome Manifest V3 扩展，没有 npm、打包或后端服务。Agent 只需要 clone、检查 manifest、在 Chrome 里加载解压目录，然后让用户在同一个浏览器配置文件中登录 GLaDOS。

下面这段 prompt 可以直接复制给 **Codex / Claude Code / DSH / WorkBuddy** 等支持终端和文件操作的 Agent；仓库根目录也提供了精简版 [`AGENTS.md`](AGENTS.md)。

### 通用 Prompt（复制使用）

```text
你是一个浏览器扩展安装与排障 Agent。目标：在本机安装、配置并验证这个 GLaDOS 自动签到扩展。

仓库：https://github.com/HuiFaLiu/GlaDos_Checkin.git

执行步骤：
1. 将仓库 clone 到用户指定目录（默认 ~/GlaDos_Checkin），不要覆盖已有目录。
2. 检查 manifest.json：
   - manifest_version 必须为 3；
   - permissions 包含 alarms、storage、notifications、cookies、declarativeNetRequest；
   - host_permissions 包含 glados.cloud、glados.space、railgun.info、glados.one。
3. 在 Chrome/Chromium 中加载已解压扩展：
   - 交互式：打开 chrome://extensions，开启“开发者模式”，点“加载已解压的扩展程序”，选择仓库目录。
   - 自动化：使用独立临时 profile，例如
     chrome --user-data-dir=/tmp/glados-agent-profile --load-extension=/path/to/GlaDos_Checkin
     不要操作用户日常 Chrome profile。
4. 让用户在扩展所在的同一个 Chrome profile 中登录 https://glados.cloud
   （或 https://glados.space、https://railgun.info），然后打开扩展点“手动签到”。
5. 验证登录态与签到：
   - 扩展 → 设置 → “网络诊断”，至少一个域名显示 code=0；
   - 或访问 https://glados.cloud/api/user/status：code=0 表示登录有效，code=-2 表示未登录；
   - 查看扩展 Service Worker 的 Console，确认没有 DNR/Cookie 报错。
6. 失败时按 README 的“登录了，但扩展仍显示未找到 Cookie”和“设备不一致”章节排查。
   需要用户提供信息时，只询问 Cookie 的名称/域名/Path/Partitioned，不要收集 Cookie 内容。

约束：
- 不要提交或输出 Cookie、token、账号密码、浏览器 profile。
- 不要修改用户已有 Chrome profile；自动化必须使用临时 profile。
- 不要关闭浏览器安全策略，不要申请 manifest 未声明的权限。
- 修改代码前先运行 node --check background.js && node --check popup.js。
- 最后输出：安装路径、Chrome 版本、诊断结果（域名/code/Cookie 数量）、是否签到成功、下一步建议。
```

### Agent 需要知道的项目事实

- **无需构建**：直接加载仓库根目录，入口是 `manifest.json`、`background.js`、`popup.html`。
- **配置存储**：全部在 `chrome.storage.local`，键包括 `config`、`lastCheckin`、`lastAutoCheckinDate`、`retryState`、`userInfo`、`checkinHistory`；没有 `.env` 或配置文件。
- **签到域名**：`glados.cloud`、`glados.space`、`railgun.info`、`glados.one`；Cookie 不跨域，必须在实际登录的域名下。
- **认证方式**：扩展使用浏览器 Cookie（`gld:accts` 等）并带 `credentials: include`；Agent 不要读取或转存 Cookie 值。
- **验证命令**：
  ```bash
  node --check background.js
  node --check popup.js
  node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8'))"
  ```
- **CI/无头环境**：Chrome headless 对扩展支持有限，优先用有界面的临时 profile 验证；不要用用户日常浏览器。

### 给用户看的验收标准

1. `chrome://extensions` 中扩展版本正确、无报错。
2. 弹窗顶部显示已登录邮箱和域名。
3. “网络诊断”至少一个域名 `code=0`。
4. “手动签到”返回成功或“今日已签到”。
5. “下次自动”显示未来的时间。

## 🌐 域名说明

扩展不再只依赖 `glados.one`：

| 域名 | 说明 |
|------|------|
| `glados.cloud` | 当前主域名，优先尝试 |
| `glados.space` | 同一套 GLaDOS 应用的备用入口，也支持签到 API |
| `railgun.info` | 备用域名，主域名失败时自动切换 |
| `glados.one` | 旧域名，仅作为兼容兜底 |

扩展会读取这些域名下浏览器中的 Cookie，按“有登录态优先”的顺序尝试。只有在你实际登录的域名，才能签到成功。

### 登录了，但扩展仍显示“未找到 Cookie”？

先点设置里的 **🩺 网络诊断**，看每一行末尾：

- **无站点权限**：打开 `chrome://extensions` → 本扩展 → 详情 → 站点访问权限，改为“在特定网站上允许”，把 `glados.cloud`、`glados.space`、`railgun.info` 加进去；或者临时设为“在所有网站上”。
- **某个域名有 Cookie，但 code=-2**：Cookie 已过期，在该域名重新登录。
- **code=0，但显示“无 Cookie”/“Cookie API 不可见”**：Cookie 存在，但 `chrome.cookies` 对 Partitioned 或特殊 Path 的 Cookie 不可见（例如 `gld:accts`）。v3.2.2 起会自动用 status 接口探测真实登录态，不影响签到；诊断里会显示“登录态有效”。
- **所有域名“无 Cookie”且 code=-2**：确认登录发生在**安装扩展的同一个 Chrome 配置文件**里；无痕窗口、Edge、手机浏览器登录都不算。
- **诊断显示 `其他相关域名 Cookie：xxx`**：说明你登录在另一个域名，请在那个域名重新登录，或把该域名反馈给扩展维护者。
- 新版网页会把 `user_id` 放在 `localStorage`，但会话仍依赖 Cookie；只看到 `localStorage` 有值、Cookie 列表为空，说明登录没有真正完成。

Chrome 的扩展站点权限、Cookie 和登录态都按**浏览器配置文件**隔离，切换配置文件后扩展也会读不到另一个配置文件的 Cookie。

## ⚠️ 注意事项与排查

### 为什么以前只有开代理才能签到？

旧版本把接口硬编码为 `https://glados.one`。该域名在部分网络下会解析到不可达的地址（或受到干扰），直连表现为超时/`Failed to fetch`；开启代理后请求被代理转发，才恢复成功。

从 v3.1 起默认使用 `glados.cloud` / `glados.space` / `railgun.info`，这些域名在多数网络下可直连。如果仍然只有代理可用，请点击设置里的 **网络诊断**：

- 四个域名都显示“不可访问” → 是本地网络/防火墙/代理规则问题
- 只有 `glados.one` 不可访问 → 正常，使用新域名即可
- 域名可访问但 `code=-2` → Cookie 失效，重新登录
- 出现 `HTTP 403` / Cloudflare 页面 → 被风控或代理节点被拦截，换节点或稍后再试

### 设备平台不一致（code=4, device-mismatch）

GLaDOS 会把登录态绑定到登录设备平台。如果账号是在手机/另一台电脑登录的，而扩展以 Windows Chrome 的 UA 请求，会被拒绝。解决方式：在当前浏览器重新登录一次。

### 浏览器关闭后还会签到吗？

不会。Chrome 扩展的定时任务依赖浏览器运行。浏览器重新打开后：

- 当天未签到且在窗口内 → 随机安排时间
- 当天未签到且已过窗口 → 立即补签
- 当天已签到 → 安排到明天

## 🔐 权限说明

| 权限 | 用途 |
|------|------|
| `alarms` | 定时触发签到 |
| `storage` | 保存配置、签到记录和上次结果 |
| `notifications` | 签到结果系统通知 |
| `cookies` | 读取四个域名下的登录 Cookie |
| `declarativeNetRequest` | 为签到请求设置匹配的 `Origin` / `Referer`（fetch 不允许手动设置） |
| `host_permissions` | 仅访问 `glados.cloud`、`glados.space`、`railgun.info`、`glados.one` |

扩展不会把 Cookie 发送到这四个域名之外的任何服务器。

## 🧠 工作流程

```text
定时闹钟 / 手动点击
        │
        ▼
读取四个域名的 Cookie，筛选有登录态的域名
        │
        ▼
按优先级依次请求 https://<域名>/api/user/checkin
  POST {"token":"<域名>"}，带 Origin/Referer
        │
        ├─ code 0  → 签到成功
        ├─ code 1  → 今日已签到
        ├─ code -2 → Cookie 失效，尝试下一个域名
        ├─ code 4  → 设备不一致，提示重新登录
        └─ 超时/5xx/429 → 记录失败，安排退避重试
        │
        ▼
保存结果 / 通知 / 查询 status 与 points / 调度下一次
```

## 📁 项目结构

```text
glados-checkin/
├── manifest.json        # 扩展清单 (Manifest V3)
├── background.js        # Service Worker：签到、域名切换、重试、调度、通知
├── popup.html           # 弹窗结构
├── popup.css            # 弹窗样式
├── popup.js             # 弹窗逻辑：状态、历史、设置、诊断
├── icons/               # 扩展图标
└── README.md
```

## 🧾 更新日志

- **v3.2.3** — 剩余天数和积分统一格式化，去掉 `461.0000000000000000` / `125.000000000000000` 这类浮点噪音：天数最多保留 1 位小数，积分取整；历史、状态卡、通知、CSV 同步生效。
- **v3.2.2** — 修复 `chrome.cookies` 看不到 Cookie（如 `gld:accts` 为 Partitioned/特殊 Path）时直接误判“未登录”的问题：Cookie API 为空时先用 `/api/user/status` 探测真实登录态，再带 `credentials: include` 直接签到；诊断会显示“Cookie API 不可见，但登录态有效”。
- **v3.2.1** — 增加 `glados.space` 域名支持；Cookie 读取同时按 domain 和 url 查询，避免漏掉特定 Path 的 Cookie；网络诊断显示站点权限和关联域名 Cookie，区分“没权限 / 登录在别的域名 / 真的没有 Cookie”。
- **v3.2** — 弹窗新增积分/域名/重试状态展示；历史记录做 HTML 转义，CSV 做引号与公式注入防护；非法日期与配置容错；弹窗支持滚动和 30 秒倒计时刷新；点击通知打开签到页；DNR 规则每个 Service Worker 只设置一次。
- **v3.1** — 修复旧域名 `glados.one` 无法直连导致必须开代理的问题；新增 `glados.cloud` / `railgun.info` 自动切换；按 code 判断成功/重复；增加 12 秒超时、失败退避重试、漏签补签；修复重试闹钟从未创建、窗口内可能立即重复签到等问题；剩余天数改用 `leftDays`；新增网络诊断。
- **v3.0** — 双保险 Cookie + DNR，随机签到。
- **v2.0** — 弹窗界面与历史记录。

## 📄 License

MIT
