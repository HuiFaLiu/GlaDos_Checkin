# AGENTS.md — GLaDOS Auto Check-in

本文件面向 Codex、Claude Code、DSH、WorkBuddy 等能读写文件、执行命令的编码 Agent。

## 项目事实

- Chrome Manifest V3 扩展，**免构建**，无 npm、无后端、无 `.env`。
- 入口：`manifest.json`、`background.js`（Service Worker）、`popup.html` / `popup.css` / `popup.js`。
- 配置存储在 `chrome.storage.local`：
  - `config`：签到时间/随机窗口/通知开关
  - `lastCheckin`、`lastAutoCheckinDate`、`retryState`
  - `userInfo`、`checkinHistory`
- 签到域名：`glados.cloud`、`glados.space`、`railgun.info`、`glados.one`。
- 认证依赖浏览器 Cookie（如 `gld:accts`），请求使用 `credentials: include`。Cookie 不跨域，用户必须在实际登录的域名下使用扩展。

## 安装流程

1. clone 到用户指定目录，默认 `~/GlaDos_Checkin`。
2. 检查清单：

   ```bash
   node --check background.js
   node --check popup.js
   node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8'))"
   ```

3. 在 Chrome 中加载：
   - 手动：`chrome://extensions` → 开发者模式 → 加载已解压的扩展程序 → 选择仓库目录。
   - 自动化：独立临时 profile：
     ```bash
     chrome --user-data-dir=/tmp/glados-agent-profile --load-extension=/path/to/GlaDos_Checkin
     ```
     不要操作用户日常 profile。
4. 让用户在同一个浏览器 profile 登录 `https://glados.cloud`（或 `https://glados.space` / `https://railgun.info`）。
5. 打开扩展 → 手动签到 → 设置 → 网络诊断。

## 验证标准

- `https://glados.cloud/api/user/status` 返回 `code: 0` 表示登录态有效；`code: -2` 表示未登录。
- 网络诊断至少一个域名 `code=0`。
- 手动签到返回成功或“今日已签到”。
- Service Worker Console 无 DNR/Cookie 报错。

## 硬性约束

- 不读取、不输出、不提交 Cookie 值、token、账号密码或浏览器 profile。
- 不修改用户已有 Chrome profile；自动化必须使用临时 profile。
- 不关闭浏览器安全策略，不申请 manifest 未声明的权限。
- 需要用户提供诊断信息时，只询问 Cookie 名称、域名、Path、SameSite、是否 Partitioned。
- 修改代码后重新运行语法检查，并在 README 更新日志中记录行为变化。

## 可直接复制的任务 Prompt

```text
请在本机安装并验证 https://github.com/HuiFaLiu/GlaDos_Checkin.git。

要求：
1. clone 到 ~/GlaDos_Checkin，不要覆盖已有目录。
2. 检查 manifest.json 是 Manifest V3，权限包含 alarms/storage/notifications/cookies/declarativeNetRequest，
   host_permissions 包含 glados.cloud、glados.space、railgun.info、glados.one。
3. 在 Chrome 中通过“加载已解压的扩展程序”安装；自动化时使用独立临时 profile，
   不要动用户日常 profile。
4. 让用户在同一个 Chrome profile 登录 https://glados.cloud 或 https://glados.space，
   然后打开扩展点“手动签到”。
5. 用“网络诊断”和 https://glados.cloud/api/user/status 验证登录态（code=0 有效）。
6. 失败时按 README 排查；只询问 Cookie 元数据，不要收集 Cookie 内容。
7. 输出安装路径、Chrome 版本、诊断结果、签到结果和下一步建议。

不要提交任何 Cookie/token/账号密码；不要关闭浏览器安全策略。
```
