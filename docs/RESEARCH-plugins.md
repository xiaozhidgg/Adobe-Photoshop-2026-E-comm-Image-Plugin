# RESEARCH-plugins：同类 Photoshop UXP 开源插件调研（可借鉴 / 不可借鉴）

> 调研方式：GitHub Search API（经本地代理 `http://本地代理端口`，未认证公开接口；约 8 次 search + 1 次 tree + 若干 raw 抓取）；克隆产物在 `%TEMP%\uxp-survey\`（9 个 shallow clone），本仓库全程只读。
> 调研时间：本次会话。
> 目的：找「别人怎么解我们踩过的坑」的现成答案 —— `命令"<未知的>"当前不可用`、PS 忙时拒描述符、ExtendScript DOM 句柄失效、图层锁定导致「变换」连续被拒。
> **证据等级**：`[亲测]` = 本次会话由我本人抓取的原文；`[子代理取证]` = 子代理读取并给出路径 + 行号（未二次复核）；`[推断]` = 推理。

---

## 0. 结论（TL;DR）

| 问题 | 结论 |
|---|---|
| 有能整套抄的项目吗 | **没有**。同时具备「抠图→蒙版→背景→投影→调色→多尺寸构图→批量导出」的项目一个都没找到，我们的流程组合度最高 |
| 抠图 / 蒙版事件名有更优解吗 | **没有**。`autoCutout` / `removeBackground` / `selectSubject` 在三个深读仓库（PixelRunner 180KB host、OpenLayer 120KB adapter、ps-banana 155 个 JS）命中数**全为 0**；`make channel/mask + revealSelection` 是社区共识写法（与我们 `plugin/src/cutout.js:52-55` 一致）`[子代理取证]` |
| 有人用裸 `{_obj:"applyLayerMask"}` 吗 | **没有**，全部走 `make channel/mask` —— 与我们的真机结论（被回「命令"<未知的>"当前不可用」）一致 `[子代理取证]` |
| 真正值得抄的 | **3 条**：① `run()` 统一错误断言 ② 本地化菜单标题扫 commandID ③ PS 串行锁（详见 §4） |
| 不能抄的 | ps-banana（**GPL-3.0**，传染）、ps-es-to-uxp / PSUXPScriptExamples / documentBoard（**无许可**）、erasebg（依赖服务端 + 上传用户图片） |
| 摆正 / 透视矫正有先例吗 | **没有**。没有任何项目用 PS 几何接口做矫正；PixelRunner 只在客户端用 WebGL2 对 `rotation + 缩放 + 偏移` 做穷举打分来对齐 AI 结果 `[子代理取证]` |
| 我们独有的优势 | 忙等 + 递增退避 + 回读验证三件套，这批项目里只有我们在做（ps-banana 用"队列串行"替代退避） |

---

## 1. 清单表

| 仓库 | ★ | 最后 push | 许可 | 一句话定位 |
|---|---|---|---|---|
| [AdobeDocs/uxp-photoshop-plugin-samples](https://github.com/AdobeDocs/uxp-photoshop-plugin-samples) | 361 | 2026-08-18 | MIT | 官方样例集（batchPlay / imaging / React-SWC 模板） |
| [jardicc/alchemist](https://github.com/jardicc/alchemist) | 251 | 2026-05-17 | MIT | 描述符录制器 / 调试器（专治"事件名写错"） |
| [AdobeDocs/uxp-photoshop](https://github.com/AdobeDocs/uxp-photoshop) | 146 | 2026-10-01 | Apache-2.0 | 官方 API 文档 + issue 区（踩坑线索） |
| [XIAOTsune/PixelRunner](https://github.com/XIAOTsune/PixelRunner) | 80 | 2026-09-22 | Apache-2.0 | AI 工作流面板：**统一错误断言 + 菜单标题扫描** |
| [MehranMarxian/OpenLayer](https://github.com/MehranMarxian/OpenLayer) | 40 | 2026-10-15 | MIT | AI 修图回贴：**纯函数事务计划器** + bounds 居中 |
| [adobe-uxp/ps-es-to-uxp](https://github.com/adobe-uxp/ps-es-to-uxp) | 22 | 2023-02-23 | **无许可** | ExtendScript→batchPlay 描述符转换（只可看思路） |
| [dunkel-Stern/photoshop-color-unmix](https://github.com/dunkel-Stern/photoshop-color-unmix) | 20 | 2026-03-23 | MIT | **像素级读写标准骨架**（imaging 最佳范例） |
| [peekcat/ps-banana](https://github.com/peekcat/ps-banana) | 7 | 2026-10-07 | **GPL-3.0** | 大而全修图面板：**PS 串行锁 / 并发池** |
| [dashuaigc/Sliceman](https://github.com/dashuaigc/Sliceman) | 5 | 2026-10-15 | MIT | 切图/批量导出：**.ccx 打包 + PS.json 注册** |
| [tokyosheep/PSUXPScriptExamples](https://github.com/tokyosheep/PSUXPScriptExamples) | 5 | 2025-01-13 | **无许可** | `.psjs` 脚本样例 |
| [pixelbin-io/erasebg-photoshop-plugin](https://github.com/pixelbin-io/erasebg-photoshop-plugin) | 2 | 2024-10-09 | MIT | 云端抠图（Erase.bg API，需上传图片） |

---

## 2. 逐个取证

### 2.1 PixelRunner `[亲测]`

- 关键工具层 `PixelRunner/src/host/photoshop/commands.js`（分支 `main`，我抓的原文）：

```js
export function assertBatchPlaySucceeded(result, label) {
  const first = Array.isArray(result) ? result[0] : null;
  if (first && first._obj === "error" && Number(first.result) !== 0) {
    throw new Error(first.message || `${label} failed`);
  }
}

const TOOL_MENU_KEYWORDS = {
  gaussianBlur: ["gaussian blur"],
  smartSharpen: ["smart sharpen"],
  highPass: ["high pass"],
  selectAndMask: ["select and mask", "选择并遮住", "选择并遮罩"],
  contentAwareFill: ["content-aware fill", "content aware fill", "内容识别填充", "内容感知填充"]
};
const TOOL_MENU_SCAN_RANGE = { start: 900, end: 5000 };
```

  另有 `scanMenuIdByKey(core, menuKey, range)` 在 900–5000 扫不到时**深扫 5001–12000**，并用 `core.getMenuCommandState` 判 disabled、`performMenuCommand` 驱动 `[亲测 + 子代理取证]`。
- 蒙版建立（与我们 `plugin/src/cutout.js:52-55` 同款）：`tool-actions.js:956-963` 的 `make / channel / mask / revealSelection` `[子代理取证]`。
- **它没有忙等重试**（`busy` 命中 0 次、`backoff`/`setTimeout` 命中 0 次）—— 这一块我们做得比它多。

### 2.2 OpenLayer `[子代理取证]`

- `src/photoshop/photoshopTransaction.ts` 把"该清理什么"抽成**纯函数计划器**：`planImportFinalization(state, outcome)` / `planImportRecovery(state)` / `runCleanupTasks(tasks)`（收集失败但**不抛**，清理尽力而为），两阶段 finalize → recovery，可单测、不碰 PS。
- 我们没试过的选区写法：
  - 图层透明度 → 选区：`to: { _ref: "channel", _enum: "channel", _value: "transparencyEnum" }`（`photoshopAdapter.ts:1914-1936`）；
  - 复合通道 → 选区：`to: { _ref: "channel", _enum: "channel", _value: "RGB" }`（`:2745-2755`）；
  - 全选 / 取消：`to: { _enum: "ordinal", _value: "allEnum" | "none" }`（`:2757-2784`）。
- 居中：读 `bounds` → 算 delta → `moveActiveLayerBy`；**读不到 bounds 就降级为居中，不报错**（`:2807-2875`）。

### 2.3 Sliceman `[亲测]`（原文全文读过，因抓取脚本的编码错误意外打印出来）

- `.ccx` 打包 `scripts/pack.mjs`：本质是 zip，**`manifest.json` 必须在压缩包根目录**，版本号取自 `src/manifest.json`。
- 本地安装 `scripts/install-local.mjs` 做两件事：

```
1) 插件目录  %APPDATA%\Adobe\UXP\Plugins\External\<id>_<version>\
2) 注册表项  %APPDATA%\Adobe\UXP\PluginsInfo\v1\PS.json 的 plugins 数组
   { hostMinVersion, name, path: '$localPlugins\\External\\<id>_<version>',
     pluginId, status: 'enabled', type: 'uxp', versionString }
```

  安全设计值得学：**先备份** `PS.json.bak`；解析失败**直接中止**（怕抹掉别人插件的注册项）；**必须 PS 完全退出**（PS 退出时会重写 PS.json 把改动冲掉）。
  它的注释还写：「manifest 的 icons 由 CC 安装流程注册，UDT 侧载只拿到占位符」→ 真安装与 UDT 侧载的差别主要在**图标**与共存，不在"能否加载"。
- 导出：`folder.createFile` → `uxpFs.createSessionToken(file)` → `save as WebPFormat`（`compressionLossless` / `compressionLossy`），并把面板 1–100 的 JPG 质量映射到 PS 的 1–12 `[子代理取证]`。

### 2.4 ps-banana `[子代理取证]`（**GPL-3.0，代码不可抄**）

- `plugin/host/ps-lock.js` 的 PS 串行锁，注释里的那句是本轮最有价值的一句：

```
// 超时只通知调用者，不能释放锁；UXP 无法强制取消已经进入 executeAsModal 的操作
await sleep(200);   // finally 里，防 PS 操作冲突
```

- `plugin/GPTdev.md` 踩坑清单（英文段）：PS 属性访问会抛（大量防御性 try/catch 是**故意的**）；**避免周期性 `executeAsModal`**（会闪文档 / 阻塞用户）；用 `_busy` 串行化宿主命令。
- `tile-automation.host.js:593`：`if (!imaging.getLayerMask) throw ...` —— 与我们 `plugin/src/ps.js:1210` 的注释结论一致（无蒙版时它会抛）。
- 权限面远大于我们：`network.domains:"all"` + `webview` + `allowCodeGenerationFromStrings`。

### 2.5 官方样例 `AdobeDocs/uxp-photoshop-plugin-samples` `[子代理取证]`

- 多数样例 `manifestVersion: 4` 且**无 `requiredPermissions`**；只有 SWC/React 模板是 v5 + `featureFlags: { enableSWCSupport: true }` + `minVersion 24.4` —— 即 **React 支持写在 featureFlags 里，不是权限里**。

### 2.6 colorunmix `[子代理取证]`

- 像素级操作的正确骨架（`main.js:312-400`，全文仅 15.7KB）：

```js
await core.executeAsModal(async (executionContext) => {
  const imageObj = await imaging.getPixels({ ... });
  const pixelData = await psImage.getData({ chunky: true });
  outImage = await imaging.createImageDataFromBuffer(out, { ... });
  await imaging.putPixels({ ..., targetBounds: { ... } });
  // finally: psImage?.dispose(); outImage?.dispose();
  executionContext.reportProgress({ value, commandName: "Color Unmix" });
});
```

### 2.7 其余

- `erasebg`：`manifestVersion: 5` + **精确域名白名单**（5 个域）而不是 `domains:"all"`；错误处理上把 `executeAsModal` 内的异常在模态外重新抛出（注释指向 Adobe 论坛帖：*errors thrown inside executeAsModal are converted to strings*）`[子代理取证]`。
- `ps-es-to-uxp`：把 `executeAction` 换成 `executeActionForUXP`，**直接得到 batchPlay JSON 而不是凭空造 ID** —— 这正是我们踩的坑（`stringIDToTypeID` 会造出不存在的 ID）的正解思路；**无许可，只能看不能抄** `[子代理取证]`。
- `alchemist`：同用途的正规产品（描述符录制）；**遇到不确定的事件名/键名，先录真实描述符再写代码**。

---

## 3. 七个问题的答案

### ① manifest 权限写法对比 `[子代理取证]`

| 项目 | localFileSystem | launchProcess | network | 其他 |
|---|---|---|---|---|
| **我们** `plugin/manifest.json` | `fullAccess` | `https` + 扩展名白名单 | **无** | — |
| PixelRunner | fullAccess | `https`/`file` | 多个域 | webview |
| ps-banana | fullAccess | `http`/`https`/`file` + `.bat` | `all` | webview + `allowCodeGenerationFromStrings` |
| OpenLayer | fullAccess | `https` | `all` | **`clipboard: readAndWrite`** |
| Sliceman | fullAccess | `https` | 仅 `api.github.com` | — |
| colorunmix | **无 requiredPermissions** | — | — | — |

结论：**我们是最保守的一档**。真要联网（在线抠图）时，照 erasebg 用**精确域名白名单**，不要 `"all"`。

### ② batchPlay 描述符的组织方式

四种形态：我们的"单入口 `run()` + 忙等退避 + 预算 + 回读验证"；PixelRunner 的"薄工具层 + 业务层"；OpenLayer 的"单文件 adapter + 纯函数事务计划器"；Sliceman 的"按职责分文件 + 可单测的 `*-core.js`"。
**比我们好的两点**：统一错误断言（PixelRunner）、事务 plan/recovery 纯函数化（OpenLayer）。
**没人比我们强的**：忙等 + 递增退避 + 回读验证。

### ③ 抠图 / 蒙版 AM 事件名

见 §0：三个深读仓库命中数为 0；`make channel/mask + revealSelection` 是共识；裸 `applyLayerMask` 无人使用。我们没试过但**有两份以上独立实现**的写法见 §4 第 4 条。

### ④ 面板 UI 选型

原生 DOM/TS 是这批项目的主流（OpenLayer / Sliceman / colorunmix / ps-banana 的 "react" 命中全是假阳性）；WebView 方案（PixelRunner、ps-banana）换来 Web 生态但要开 webview 权限 + 消息桥 + 双份构建；React/SWC 只有官方模板且要 `featureFlags.enableSWCSupport`（PS 24.4+）。
反面教材：**Sliceman `src/ui/panel.js` 237KB 单文件** —— 我们 `ui.js` 要继续分节，别长成这样。

### ⑤ 安装与分发

`.ccx`（zip 改名 + manifest 在根）可双击安装，比"解压→跑 bat"省事；注册 `PluginsInfo/v1/PS.json` 是为了图标与正规安装，**不是加载的必要条件**（见 §5）。

### ⑥ 自动摆正 / 透视矫正

**无先例**。见 `docs/PLAN-straighten.md`（本轮同步落盘的方案）。

### ⑦ 踩坑清单（别人写的 + 我们验证过的）

| 坑 | 出处 | 我们的对应结论 |
|---|---|---|
| `executeAsModal` 内的异常会变成字符串 | erasebg `src/utils.js`（指向 Adobe 论坛帖） | 与我们的日志里"错误只剩一句 message"一致 |
| PS 属性访问会抛；避免周期性 `executeAsModal` | ps-banana `GPTdev.md` | 我们所有 get/set 都包在防御性 try/catch 里 |
| 竞争 `executeAsModal` 要用锁，超时不释放 | ps-banana `host/ps-lock.js` | 我们是退避重试（互补） |
| 对话框命令没有稳定 commandID，要扫菜单标题（含中文） | PixelRunner `commands.js` | 我们暂时没驱动这类命令 |
| `imaging.getLayerMask` 无蒙版时会抛 | ps-banana `tile-automation.host.js:593` | `plugin/src/ps.js:1210` 同结论 |
| `.ccx`/本地安装要在 PS 退出后做 | Sliceman `install-local.mjs` | 我们 `一键安装.bat` 同样等 PS 退出 |
| modal 期间视口操作被拒（setPanZoom） | AdobeDocs/uxp-photoshop issue #500 | 同族：可选视觉操作不要放进关键链路 |

**没有找到**以「命令"<未知的>"当前不可用」为题的公开踩坑文档/issue 集。

---

## 4. 可直接抄（许可允许 + 技术栈一致）

| 抄什么 | 来源（许可） | 我们对应位置 |
|---|---|---|
| `assertBatchPlaySucceeded` 统一错误断言 + `message` 透出 | PixelRunner `commands.js:1-6`（Apache-2.0） | `plugin/src/ps.js` 的 `run()` |
| 本地化菜单标题 → commandID 扫描 + disabled 判定 + 深扫兜底 | PixelRunner `commands.js`（Apache-2.0） | 新增 `plugin/src/menu.js` |
| 事务 plan / recovery 纯函数 + `runCleanupTasks` 收集失败不抛 | OpenLayer `photoshopTransaction.ts`（MIT） | 抠图链的失败清理 |
| `transparencyEnum` / `RGB` → 选区；`allEnum` / `none` | OpenLayer `photoshopAdapter.ts:1914-1936,2745-2784`（MIT） | `plugin/src/ps.js` 选区工具 |
| bounds 读取 + move 居中（读不到就降级） | OpenLayer（MIT） | 尺寸构图 / `compose.js` |
| `getPixels→getData→createImageDataFromBuffer→putPixels` + `dispose` in `finally` + `reportProgress` | colorunmix `main.js:312-400`（MIT） | 边缘净化 / 像素级处理 |
| `.ccx` 打包（zip + manifest 在根 + 版本取自 manifest）；`PS.json` 注册的安全写法（备份 + 解析失败中止 + 只 merge 自己那条） | Sliceman `scripts/*.mjs`（MIT） | `一键安装.bat` / Releases |
| WebP 导出描述符（`save` + `WebPFormat` + `copy:true`） | Sliceman `src/ps/save-image.js`（MIT） | 批量导出 |

## 5. 不能抄

- **ps-banana（GPL-3.0）**：传染性许可，代码不能进本仓库（思路可学：串行锁 / 并发池）。
- **ps-es-to-uxp、PSUXPScriptExamples、documentBoard（无许可）**：只能当"信息"看。
- **PixelRunner 的 AI/网络/GPU 部分**：依赖 RunningHub 付费 API + `tweetnacl` 授权 + 68KB WebGL 着色器（且 dist 经 esbuild + obfuscator）；只借它的 `commands.js` 思路。
- **erasebg**：依赖服务端 + API Key，要上传用户图片，与"全本地"定位冲突。
- **OpenLayer 的 AI 回贴主线**：依赖本地 ComfyUI 桥；只借事务计划器与描述符写法。

---

## 6. 我方复核记录（不是转述）

- ✅ `[亲测]` 亲自抓取 `https://raw.githubusercontent.com/XIAOTsune/PixelRunner/main/src/host/photoshop/commands.js`：`assertBatchPlaySucceeded`、`TOOL_MENU_KEYWORDS`（含「选择并遮住」「选择并遮罩」）、`TOOL_MENU_SCAN_RANGE = { start: 900, end: 5000 }` 全部对上。
- ✅ `[亲测]` 亲自读到 `Sliceman/scripts/install-local.mjs` 全文：注册路径是 `%APPDATA%\Adobe\UXP\PluginsInfo\v1\PS.json`（**注意不在 `Plugins\` 目录下**），条目字段与 §2.3 一致；含 `.bak` 备份、解析失败中止、PS 运行中直接退出的保护。
- ✅ `[亲测]` **实测新事实**：`%APPDATA%\Adobe\UXP\PluginsInfo\v1\PS.json` 在**根本不存在**，UDT 的 `plugins_workspace.json` 也不存在 —— 而我们的插件照常加载（本次会话十余轮真机日志）。**⇒ 注册 PS.json 不是"能加载"的必要条件**；我们"拷贝到 `External\com.ecom.psimage\`"的安装法已被真机证明可用。补注册的价值只在于**面板图标**与"正规安装"身份，且必须照 Sliceman 的安全写法做。
- ⚠️ 另一处需要留意的差异：Sliceman 用 `External\<id>_<version>\`（带版本号），我们用 `External\<id>\`（不带）。两者都能加载；**我们不要改目录名**（改了会与旧副本并存/失联）。

## 7. 没查到的（诚实列出）

1. 没有比"`removeBackground` + `autoCutout` 双链"更好的抠图写法。
2. 没有项目做透视矫正/自动摆正（见 `docs/PLAN-straighten.md`）。
3. 没有"batchPlay 错误码手册"类资料；`命令"<未知的>"当前不可用` 无公开文档。
4. 没有开源项目实现 Adobe 签名 / UPIA 分发（`UPIA` 零命中）。
5. 未认证 API 的 `search` 限 10 次/分钟、`code search` 需 token（本会话 token 已吊销、未使用），因此"按代码内容找仓库"受限 —— 可能仍有使用 `autoCutout` 的仓库未被检索到。
6. ps-banana 的中文文档（`knowledge_base/*.md`）未逐篇阅读（控制台 GBK 乱码）。

## 8. 参考链接

- https://github.com/AdobeDocs/uxp-photoshop-plugin-samples
- https://github.com/jardicc/alchemist
- https://github.com/XIAOTsune/PixelRunner
- https://github.com/MehranMarxian/OpenLayer
- https://github.com/dashuaigc/Sliceman
- https://github.com/dunkel-Stern/photoshop-color-unmix
- https://github.com/peekcat/ps-banana
- https://github.com/adobe-uxp/ps-es-to-uxp
- https://github.com/pixelbin-io/erasebg-photoshop-plugin
