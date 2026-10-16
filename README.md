# 电商图片制作 · Photoshop 2026 UXP 插件

一键把商品图做成电商主图：**去掉背景 → 换纯色背景 → 按主体自动调色 → 智能构图 → 批量导出多个尺寸**。

针对本机实测环境开发并安装：Photoshop 2026 `27.1 (20251117.r.17 2758080)`（`D:\software\Adobe Photoshop 2026`），本机**没有** Creative Cloud Desktop、**没有** UXP Developer Tool，本插件两者都不需要。

> **一键安装 / 卸载**：双击仓库根目录的 [`一键安装.bat`](一键安装.bat) / [`一键卸载.bat`](一键卸载.bat)。脚本会自己检查 Photoshop 是否已完全退出、自动找 PowerShell、给出中文结果；**不需要管理员权限**。命令行方式、排错、开发者模式说明见 [`安装说明.md`](安装说明.md)。

---

## 当前状态

**已安装到本机**，且已被 PS 的 UXP 运行时发现并注册。安装证据（`%APPDATA%\Adobe\Adobe Photoshop 2026\Logs\UXPLogs_2026-10-13_16-03-37_128109.log`）：

```
upic::Loading plugins from user fallback plugins folder: C:\Users\EDY\AppData\Roaming\Adobe\UXP\Plugins\External
upic::Number of plugins added from user's fallback: 1
upic::Number of plugins added from system's fallback: 0
```

安装前该目录**不存在**；日志中**没有任何报错行**。

### 打开面板

Photoshop 已在运行（本次安装时启动的）。打开：

> **窗口 → 增效工具（Plugins）→ 电商图片制作**

找不到面板时：**窗口 → 工作区 → 复位基本功能**，再重新打开「增效工具」。

---

## 怎么用

面板从上到下三块：

| 区块 | 内容 |
|---|---|
| **一键全流程** | 按「去背景 → 边缘净化 → 应用蒙版（烘焙进像素）→ 背景 → 接地投影 → 调色 → 尺寸构图 → 导出」顺序跑完；失败步骤会给宿主原文错误并停下（烘焙失败只警告，不打断后续步骤）|
| **模块单跑** | 每个模块有独立按钮和开关：去背景 / 边缘净化 / 背景色 / 投影 / 调色 / 构图 / 导出。只处理你在 PS 里打开的那张文档 |
| **预设** | 尺寸、色板、调色默认值都能增删；`导入/导出 JSON` 可把整套预设备份或换机器 |

几个要点：

- **调色每一项都能单独关掉**。默认全部以**调整图层**落地（锐化/降噪用智能对象 + 智能滤镜），原始像素不动，做完还能在 PS 里继续改。
- **去背景结果保留为图层蒙版**，不满意可以直接拿画笔修，不用重跑；「应用蒙版」模块把蒙版**烘焙进像素**（等价 PS 的 图层 → 图层蒙版 → 应用），交付时图层更干净。
- **边缘净化**：蒙版收缩 + 羽化，专治抠完留一圈白边。
- **一键回退**：处理前会打快照，不满意一键回到处理前。
- **导出**：`<原名>_<宽>x<高>.<格式>`，默认输出到**原图同目录**的 `output\` 子文件夹；面板里也能**自选输出目录**（留空＝原图同目录）。
- **尺寸**：内置 800×800 / 1254×1254 / 1600×1600，可多选，可自定义增删。选中的最大尺寸作为**基准画布**，先在大画布上把构图规范化，再等比缩放导出各档 —— 所以各尺寸的留白比例天然一致。

---

## 目录结构

```
ps电商图片制作插件\
├─ plugin\                       插件本体（安装时复制到用户级 UXP 目录）
│  ├─ manifest.json  index.html  index.js  styles.css
│  └─ src\  ps/store/analyze/cutout/backdrop/adjust/compose/export/ui .js
├─ 一键安装.bat                  一键安装（双击即可，内部调用 install.ps1）
├─ 一键卸载.bat                  一键卸载（双击即可，另可一并清理插件数据）
├─ install.ps1                   安装 / 卸载脚本（幂等，覆盖前备份）
├─ 安装说明.md                    安装、排错、卸载详版
├─ docs\
│  ├─ PLAN.md                    分诊、环境事实、访谈结论、验收结果、已知局限
│  ├─ INTERFACE.md               跨模块冻结契约（v2.1）
│  ├─ DEVELOPER.md               开发者指南（为什么这么做、怎么改）
│  ├─ RESEARCH-install.md        插件落点实机调研
│  ├─ RESEARCH-descriptors.md    Action Manager 描述符手册（1419 行）
│  ├─ RESEARCH-host.md           真机探针报告
│  ├─ RESEARCH-plugins.md        同类开源插件调研（可借鉴 / 不可借鉴）
│  └─ PLAN-straighten.md         自动摆正 / 透视矫正方案（未实现，存档）
└─ verify\                       probe.ps1 / probe*.jsx 与探针输出日志
```

---

## 验证到哪一步了

| 已验证 | 证据 |
|---|---|
| 插件落点正确、13 个文件完整 | 实机安装，`5 OK / 0 SKIP / 0 FAIL` |
| 开发者模式已开 | `UIPrefs.psp` offset 2725 = `1` |
| PS 的 UXP 认了这个插件 | 日志 `plugins added from user's fallback: 1`，无报错 |
| 所有 JS 语法通过 | `node --check` × 10 文件，退出码全 0 |
| 描述符正确性 | `docs/RESEARCH-descriptors.md` 26 条本机取证；去背景链逐字对齐 Adobe 自家 `com.adobe.unifiedpanel\js\524.js` |
| 逻辑正确性 | 宿主模拟 132 项 + 契约冒烟 62 项 + 探针 27 项，全 0 失败 |
| 一键安装 / 卸载 bat | 真机干跑（`一键安装.bat dry` / `一键卸载.bat dry`）退出码 0，中文输出与路径全部正确 |

**没有验证到的**：面板内部的运行期行为（UXP 面板的 JS 是**首次打开面板时**才执行的，我无法在 PS 界面里点按钮）。所以**第一次打开面板时请留意**面板日志区 —— 代码里埋了 `[Ecom.probe]` 日志，用于兜底核对 4 个手册未查清的字段名；这 4 项都写成自适应 + 日志，即使字段名猜错也不会中断。

---

## 已知局限

1. **去背景走的是 Adobe 自家 `autoCutout` 的等价描述符链**（逐字照抄官方面板源码），功能与你说的「原版去背景」一致，但实现路径不是那颗按钮本身 —— `removeBackground` 在 Action Manager 里不是可调用事件（手册 13 处命中全是通知事件名 / talent id / CDN URL）。
2. **非正方形尺寸会把主体拉变形**。基准画布是正方形，构图规范化后**拉伸**到目标尺寸。内置的三档都是正方形，不影响；自己加 1000×1500 这类尺寸才会触发。需要的话可以补「居中裁切 / 补边」而不是拉伸。
3. 去背景质量取决于 PS 自身的 AI 模型；本插件不自带分割模型。
4. 锐化/降噪的「自动值」是启发式估算，不保证优于手动。
5. 刻意**没做**：取主体主色自动生成背景（你在访谈里明确排除）。

细节见 `docs/PLAN.md` §13。

---

## 安装 / 卸载

**一键（推荐）**：双击 `一键安装.bat`；要卸载就双击 `一键卸载.bat`（会先等你退出 Photoshop，卸载后还能选择是否一并清掉面板设置与日志）。

**命令行**（想看清每一步时）：

```powershell
# 干跑：只报告要做什么，不写文件
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -DryRun

# 安装
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1

# 卸载
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -Uninstall
```

两个 bat 也支持干跑：`一键安装.bat dry`、`一键卸载.bat dry`。

安装位置：`%APPDATA%\Adobe\UXP\Plugins\External\com.ecom.psimage\`；卸载时该目录被改名为 `com.ecom.psimage.bak-<日期时间>`（**保留备份，不直接删除**）。卸载**不会**关闭开发者模式；要关请在 PS 里：**编辑 → 首选项 → 增效工具** → 取消勾选「启用开发人员模式」。

## 版本 / 下载

打包版本与更新说明见 GitHub Releases：<https://github.com/xiaozhidgg/Adobe-Photoshop-2026-E-comm-Image-Plugin/releases>
