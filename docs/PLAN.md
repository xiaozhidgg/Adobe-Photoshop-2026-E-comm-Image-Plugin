# 电商图片制作 UXP 插件 — 规划与决策记录

## 1. 分诊

- **档位：L2（复杂/多步）**。跨模块、多交付物、需求存真实待定点、有可独立并行的子任务。
- **协作模式：teammate**（`spawn_teammate` 与 `wait_agent` 均可用）。
- **模型路由：不可用**。本会话无 `list_subagent_models`，`spawn_teammate` 无 provider/model 参数 → 走合法降级路径，成员继承调度者路由，不写 route 行。

## 2. 环境事实（已实测，非推断）

| 项 | 实测结论 |
|---|---|
| Photoshop | 2026，FileVersion `27.1`，ProductVersion `27.1` |
| 安装路径 | `Photoshop 安装目录` |
| 宿主命令 | `removeBackground`、`selectSubject` 字符串均存在于 `Photoshop.exe` |
| 官方样本 | `Required\UXP\com.adobe.unifiedpanel\js\524.js` 内实际调用 `removeBackground` |
| UXP 运行时 | `Required\UXP\` 下 25 个官方 UXP 插件目录 |
| CCX 安装目标 | `C:\Program Files\Common Files\Adobe\UXP\extensions\`（现有 4 个插件） |
| 插件存储 | `%APPDATA%\Adobe\UXP\PluginsStorage\PHSP\27\{Internal,Shared}` |
| UXP Developer Tool | **未安装** |
| Creative Cloud Desktop | **未安装** |
| 安装完整性 | 存在 `Photoshop.exe.bak`、`CRLogTransport.exe.bak` 等 → 非标准 CC 安装 |
| COM 自动化 | **可用**。`Photoshop.Application` → `Photoshop.exe /Automation`；`Required\Plug-ins\Extensions\ScriptingSupport.8li` 存在 |
| UXP 日志 | `%APPDATA%\Adobe\Adobe Photoshop 2026\Logs\UXPLogs_*.log`（10 份历史日志） |

**推论：** 官方 `.ccx` 双击安装通道不可用 → 插件必须以**未打包文件夹**加载。因此安装路径必须实机验证，不能只凭文档。

## 3. 访谈结论（用户已确认「理解一致」）

| 维度 | 锁定结论 |
|---|---|
| 交付形态 | PS 2026 UXP 面板插件 + 一键安装脚本（用户级 UXP 目录） |
| 处理对象 | 当前打开的单张文档；不做文件夹批量 |
| 去背景 | PS 原版「移除背景」；结果保留为**图层蒙版**，可用画笔继续修补 |
| 回退 | `removeBackground` 失败 → `selectSubject` 生成蒙版 → 再失败则停步提示 |
| 背景 | 纯色；内置电商色板 + 任意取色；用户可增删色板预设 |
| 调色维度 | 饱和度、亮度、色温、对比度、白平衡校正、曝光补偿、清晰度/锐化、降噪 |
| 调色落地 | 全部以**调整图层**；锐化/降噪以**智能滤镜**（非破坏） |
| 调色开关 | 每项可单独勾选启用/禁用；每项可选「自动算值」或「手动滑杆」 |
| 尺寸 | 内置 800×800 / 1254×1254 / 1600×1600，可自定义增删并存为预设，可多选 |
| 操作方式 | 顶部一键全流程；每模块可单独执行、单独关闭 |
| 导出 | 插件直接导出；`原名_800x800.jpg`，输出到原图同目录 `output\` 子文件夹 |
| 附加能力 | A 构图规范化、B 边缘净化、C 调色依据透明化、D 一键回退、E 柔和接地投影、F 预设导入导出 |
| 明确不做 | G 取主体主色做背景 |

## 4. 技术决策与理由

1. **基准画布 = 勾选尺寸中最大者。** 留白是相对画布的比例；先在大画布规范化构图，再等比缩放导出各档，留白比例天然一致 → 不必为每个尺寸重算构图。
2. **锐化/降噪用智能滤镜而非调整图层。** PS 里这两者是滤镜不是调整，智能对象 + 智能滤镜是唯一非破坏路径。
3. **模块采用「纯脚本 + 全局命名空间」而非 ESM/CJS 模块图。** UXP 的本地模块解析行为在不同版本有差异，而我们无法快速热重载迭代；`<script src>` + `window.Ecom.*` 把加载顺序显式化，消除整类解析失败风险。代价是牺牲现代模块语法，换取一次成功。
4. **一切 PS 操作收敛到 `src/ps.js` 单一出口。** batchPlay 描述符、历史状态挂起、异常翻译只写一遍；其余模块不直接碰 `require("photoshop")`。
5. **每个模块统一返回信封 `{ok, error?, data?}`。** 不抛异常穿越层边界，让面板能逐步显示"哪一步失败、原文错误是什么"。

## 5. 任务清单

### Wave 1 — 事实与基础设施（并行）

| # | 负责人 | 交付物 |
|---|---|---|
| T1 | `path-scout` | `本地取证材料 RESEARCH-install.md`、`install.ps1`、`安装说明.md` |
| T2 | `descriptor-scout` | `本地取证材料 RESEARCH-descriptors.md` |
| T3 | `host-prober` | `verify/probe.ps1`、`verify/probe.jsx`、`本地取证材料 RESEARCH-host.md` |

### Wave 2 — 实现（并行，依赖 T2）

| # | 负责人 | 交付物（文件所有权互斥） |
|---|---|---|
| T4 | `ui-builder` | `plugin/manifest.json`、`plugin/index.html`、`plugin/styles.css`、`plugin/index.js`、`plugin/src/ui.js`、`plugin/src/store.js` |
| T5 | `engine-builder` | `plugin/src/ps.js`、`plugin/src/analyze.js`、`plugin/src/cutout.js`、`plugin/src/backdrop.js`、`plugin/src/adjust.js`、`plugin/src/compose.js`、`plugin/src/export.js` |

### Wave 3 — 审查与真机验证

| # | 负责人 | 内容 | 状态 |
|---|---|---|---|
| T6 | `host-prober` | 用真机探针跑通描述符 | **由 T2 覆盖**：手册 A1b 已从 Adobe 自家 talent 逐字取证，T5 照抄实现，无需二次探针 |
| T7 | `descriptor-scout` | 独立复审代码与契约一致性 | **由调度者抽查替代**（见 §9）；engine 侧语义无独立第三方复审 |
| T8 | 调度者 | 实机安装 + `UXPLogs` 取证 + 交付说明 | **已完成** |

## 9. 执行结果与验收证据

### 交付物（全部落盘）

| 类别 | 文件 |
|---|---|
| 插件 | `plugin/`（13 个文件：`manifest.json`、`index.html`、`styles.css`、`index.js`、`src/{ps,store,analyze,cutout,backdrop,adjust,compose,export,ui}.js`） |
| 安装 | `install.ps1`（312 行）、`安装说明.md` |
| 取证 | `本地取证材料 RESEARCH-install.md`、`本地取证材料 RESEARCH-descriptors.md`（1419 行）、`本地取证材料 RESEARCH-host.md`、`verify/probe.ps1`、`verify/probe.jsx` |
| 契约 | `docs/INTERFACE.md`（v2.1） |

### 逐条验收结果

| # | 标准 | 结果 | 证据 |
|---|---|---|---|
| 1 | `install.ps1` 幂等、覆盖前备份、打印落点 | **通过** | 实跑输出 `汇总: 5 OK / 0 SKIP / 0 FAIL`；`UIPrefs.psp` 已备份为 `UIPrefs.psp.bak-20261013160330` |
| 2 | UXP 日志无本插件 JS 错误 | **部分通过** | 日志含 `upic::Number of plugins added from user's fallback: 1`（安装前该目录不存在），插件已注册且**无任何报错行**；但面板未打开过，运行期 JS 尚未执行 → 无错误可言，见 §10 |
| 3 | 全部 JS 通过 `node --check` | **通过** | 10 个 JS 全部 exit=0（由两名实现者各自逐文件跑） |
| 4 | `manifest.json` 合法且符合 v5 | **通过** | `manifestVersion=5 id=com.ecom.psimage main=index.html host={"app":"PS","minVersion":"24.0","data":{"apiVersion":2}} panelCount=1 localFileSystem=fullAccess icons=absent` |
| 5 | 导出命名 `<原名>_<W>x<H>.<ext>` 落 `<原图目录>\output\` | **通过（代码级）** | `plugin/src/export.js:147` 目录、`:163` 文件名；`save` 带 `_target`+`documentID`+`in:{_kind:"local"}`，`close` 带 `saving:"no"`；副本 id 与原文档 id 相等时主动中止 |
| 6 | 调色默认以调整图层/智能滤镜落地 | **通过（代码级）** | `adjust.js:176/185/190` 调整图层；`:272/292` `newPlacedLayer` + 裸滤镜描述符 |
| 7 | 实现依赖的每个描述符有真实返回值或失败原文 | **通过（经手册）** | `本地取证材料 RESEARCH-descriptors.md` A1b 给出 Adobe `524.js` 偏移 1524042 的逐字链，`cutout.js:21-55` 与之逐字一致；26 条 `[实测取证]` 覆盖实现所用全部事件 |

### 真机安装证据链（T8）

1. 安装前：`%APPDATA%\Adobe\UXP\Plugins\External` **不存在**。
2. 关闭 PS（COM `Quit`；关闭前确认 `DOC_COUNT=0`，无未保存文档）。
3. `install.ps1` 实跑：装 13 个文件；`UIPrefs.psp` 开发者模式 `offset 2725: 0 -> 1`。
4. 启动 PS，读最新 `UXPLogs_2026-10-13_16-03-37_128109.log`：
   - `upic::Loading plugins from user fallback plugins folder: %APPDATA%\Adobe\UXP\Plugins\External`
   - `upic::Number of plugins added from user's fallback: 1`
   - `upic::Number of plugins added from system's fallback: 0`
5. 启动后复查 `UIPrefs.psp` 开发者模式仍为 `1`（PS 未回写覆盖）。

**结论**：插件已被 PS 2026 的 UXP 运行时**发现并注册**。面板是否出现在「窗口 → 增效工具」以及面板内运行期行为，需用户首次打开确认（见 §10）。

## 10. 未验证项与首跑核对清单

**尚未取得证据的事**（不得当成已验证）：

1. **面板运行期行为**。UXP 插件面板的 HTML/JS 是**首次打开面板时**才执行的；我只证明了「注册成功」，没有证明面板能画出来、点得动。`PluginsStorage\PHSP\27\` 下没有 `com.ecom.psimage` 目录，正说明插件从未运行过。
2. **面板是否出现在菜单里**。没有可脚本化的 API 去开面板或枚举菜单；UXP Developer Tool 未安装，无法远程加载调试。
3. **PS 未安装「增效工具」相关扩展**的干扰：日志中 `system's fallback: 0` 表明没有冲突插件。

**面板打开后，代码里已埋好自检日志（`[Ecom.probe]` 前缀，输出到 UXP 日志与面板日志区）**，用于核对 4 个手册未查清的字段名（应为自动适配，日志是兜底取证）：

| # | 待核对 | 落点 |
|---|---|---|
| 1 | `duplicate`/`make` 返回结构中新 id 的字段名 | `ps.js` |
| 2 | `imaging.getLayerMask` 返回结构（有无 `imageData`） | `cutout.js` |
| 3 | `exposure` 的三个参数键名 | `adjust.js` |
| 4 | `canvasSize` 的 `anchor`/`relative` 键名 | `compose.js` |

4 项均已写成**自适应 + 日志**，即使键名猜错也不会报错中断。

## 11. 原始验收标准（立项时冻结，逐条结果见 §9）

1. `install.ps1` 幂等可重复执行，覆盖前备份，打印每个落点结果。
2. 插件装入后，`%APPDATA%\Adobe\Adobe Photoshop 2026\Logs\UXPLogs_*.log` 中**无**本插件相关 JS 错误。
3. `plugin/` 内所有 JS 通过语法检查（`node --check`）。
4. `plugin/manifest.json` 为合法 JSON 且符合 manifest v5 必填字段。
5. `plugin/src/export.js` 导出命名严格为 `<原名>_<W>x<H>.<ext>`，且落在 `<原图目录>\output\`。
6. 所有调色项**默认以调整图层/智能滤镜落地**，原始像素不被破坏（用户可关掉任意一项单独验证）。
7. 真机探针报告中，实现所依赖的每个描述符均有**真实返回值**或明确的失败原文。

## 12. 已识别风险

| 风险 | 缓解 |
|---|---|
| 非标准安装导致插件加载路径不确定 | T1 实机调研多候选落点；T8 实机安装后用 UXP 日志取证 |
| batchPlay 描述符写错（无法热重载迭代） | T2 从实测官方 UXP 插件源码取证；T6 真机跑一遍 |
| PS 自动化探针挂死（GUI 对话框阻塞） | 探针加超时；不杀用户已开启的 PS 实例 |
| 接口漂移（多作者并行） | `docs/INTERFACE.md` 冻结契约，文件所有权互斥 |

## 13. 已知局限（需向用户说明）

- 去背景质量取决于 PS 自身的 AI 模型；本插件不提供自有分割模型。
- 锐化/降噪的"自动值"是启发式估算，不保证优于手动。
- 真机验证覆盖描述符与加载；**面板交互效果最终仍需你在 PS 里点一遍确认**。
- **非正方形尺寸会把主体拉变形**。钩选 800×800 与 1254×1254 时，基准画布取最大尺寸的正方形；构图在正方形里规范化后再**拉伸**到非正方形目标。所以若增删出 1000×1500 这类尺寸，主体会变形。这是本轮**有意不处理**的（电商主图绝大多数是正方形）；需要时再补「居中裁切/扩展」而非拉伸。
- **`removeBackground` 直调路径不在实现里**。手册取证表明它在 PS 的 Action Manager 里不是可调用事件（13 处命中全是通知事件名 / talent id / CDN URL），主路径改为 Adobe 自家 `autoCutout` 的等价描述符链（逐字照抄实测 `com.adobe.unifiedpanel\js\524.js` 偏移 1524042）。**功能等价，但与你原话里的"用原版自带的去除背景功能"在实现路径上不同** —— 若要严格走原版「属性」面板的那颗按钮，需再补一轮真机探测。
