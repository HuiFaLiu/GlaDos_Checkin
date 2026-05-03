# GLaDOS Auto Check-in

> GLaDOS 每日自动签到浏览器扩展 — 支持自定义时间段、随机签到、签到通知、历史记录

## ✨ 功能

- ⏰ **自动签到** — 每天定时自动签到，无需手动操作
- 🎲 **随机时间段** — 设置签到时间窗口（如 8:00~22:00），每天随机抽一个时间签到，避免固定时间被检测
- 🔔 **签到通知** — 签到后弹出系统通知，显示成功/失败及获得天数
- 📊 **用户信息** — 显示当前登录邮箱
- 📜 **历史记录** — 最多保存 100 条签到记录
- ✋ **手动签到** — 随时一键签到
- ⚙️ **灵活配置** — 签到时间、随机窗口、通知开关均可自定义

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

1. 确保已登录 [glados.one](https://glados.one)
2. 点击浏览器工具栏的扩展图标
3. 查看状态、手动签到或修改设置
4. 之后每天会自动签到，无需任何操作

### 设置说明

| 设置项 | 说明 |
|--------|------|
| 自动签到 | 开启/关闭每日自动签到 |
| 固定签到时间 | 关闭随机时使用的固定时间 |
| 随机时间段 | 开启后在设定时间窗口内随机抽取签到时间 |
| 签到窗口 | 随机签到的起止时间范围 |
| 签到后通知 | 开启/关闭系统通知 |

## ⚠️ 注意事项

- 首次使用请先手动签到一次确认正常工作
- 浏览器关闭后定时签到会失效，重新打开浏览器后自动恢复
- 插件通过读取浏览器中 `glados.one` 的 cookie 进行认证，保持登录状态即可

## 📁 项目结构

```
glados-checkin/
├── manifest.json        # 扩展清单 (Manifest V3)
│                        #   - 声明权限: alarms, storage, notifications, cookies
│                        #   - 配置 host_permissions (glados.one)
│                        #   - 注册 service worker
│
├── background.js        # 后台服务 (Service Worker)
│                        #   - Cookie 认证: 通过 chrome.cookies API 读取登录态
│                        #   - API 请求: 直接从 service worker 调用 glados.one API
│                        #   - 定时调度: 基于 Chrome Alarms API 的每日签到
│                        #   - 随机时间: 在配置的时间窗口内抽取签到时刻
│                        #   - 历史管理: 记录签到结果到 storage (最多100条)
│                        #   - 系统通知: 签到成功/失败/已签到的桌面通知
│
├── popup.html           # 弹窗界面结构
│                        #   - 头部 Logo + 操作按钮 (设置/刷新)
│                        #   - 用户信息卡片 (邮箱显示)
│                        #   - 签到状态卡片 (成功/失败/已签到)
│                        #   - 手动签到按钮
│                        #   - 信息面板 (上次签到/下次签到/剩余时长)
│                        #   - Tab 切换: 历史记录 / 设置面板
│
├── popup.css            # 样式表 (暗色终端风格)
│                        #   - Aperture Science 主题配色
│                        #   - 网格背景纹理 + 发光动效
│                        #   - 状态卡片颜色变化 (绿/红/橙)
│                        #   - Toggle 开关、时间选择器、分页器样式
│
├── popup.js             # 弹窗逻辑
│                        #   - 状态加载: 从 background 获取签到状态和用户信息
│                        #   - 手动签到: 触发签到流程并刷新界面
│                        #   - 设置管理: 加载/保存配置 (时间、随机窗口、通知)
│                        #   - 历史记录: 分页渲染、清空、导出 CSV
│                        #   - Tab 切换: 历史/设置面板的显示切换
│
├── icons/               # 扩展图标
│   ├── icon16.png       #   - 工具栏图标 (16x16)
│   ├── icon48.png       #   - 扩展管理页图标 (48x48)
│   └── icon128.png      #   - 商店/通知图标 (128x128)
│
└── README.md            # 项目说明文档
```

### 数据流

```
用户点击签到 / 定时闹钟触发
        │
        ▼
  background.js (Service Worker)
        │ chrome.cookies.getAll() 读取 glados.one cookie
        │ fetch API 直接请求 (带 Cookie header)
        ▼
  glados.one/api/user/checkin
        │ 返回结果
        ▼
  background.js
        │ 保存记录 / 发通知 / 更新状态
        ▼
  popup.js 读取并展示结果
```

## 📄 License

MIT
