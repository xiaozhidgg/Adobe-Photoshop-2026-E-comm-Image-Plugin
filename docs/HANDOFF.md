# HANDOFF：会话交接（新对话先读这份）

> 用途：记录**会话状态** —— 做完什么、什么没做、下一步从哪开始。**这不是项目文档**。
> 生成时间：2026-10-16（会话结束前）。项目文档在 `docs/DEVELOPER.md`（为什么/怎么改）、`docs/INTERFACE.md`（冻结契约）、`docs/PLAN.md`（决策与验收）。

---

## 0. 三十秒现状

- **插件可用**：`plugin/` 下 13 个文件与装机目录**逐文件哈希一致（不一致 0 个）**；真机日志 `ecom-debug.log` 531141 字节，最后写入 2026-10-16 09:20。
- **代码与 GitHub 同步**：本地 `main` = 远端 `main` = `34730f6 feat(install): 一键安装/卸载 bat + 文档同步`；Release `v1.0.0`（附 `ecom-psimage-v1.0.0.zip`）已发布。
- **有 4 处未提交改动**（用户明确"先不提交，放本地"）：
  - `M README.md`（目录树补新文档，并补上原先漏掉的 `DEVELOPER.md`）
  - `M docs/DEVELOPER.md`（开头索引 +1 行）
  - `?? docs/RESEARCH-plugins.md`（18151 字节 / 238 行）
  - `?? docs/PLAN-straighten.md`（含 §8 多物体、§9 只读探针）

---

## 1. 环境事实（新对话必须知道）

| 项 | 值 |
|---|---|
| 项目根 | `<插件仓库根目录>` |
| 装机目录 | `%APPDATA%\Adobe\UXP\Plugins\External\com.ecom.psimage\` |
| 真机日志 | `%APPDATA%\Adobe\UXP\PluginsStorage\PHSP\27\External\com.ecom.psimage\PluginData\ecom-debug.log` |
| 远端仓库 | `https://github.com/xiaozhidgg/Adobe-Photoshop-2026-E-comm-Image-Plugin`（本地 `.git/config` **无 token**） |
| 网络 | 直连 GitHub 超时，**必须走 Clash 代理 `http://本地代理端口`** |
| GitHub 凭证 | 会话里出现过的那枚 PAT 已建议吊销、临时 token 文件已删 → **推送前需要用户重新提供凭证** |
| Photoshop | 27.1；装机 / 换代码前**必须完全退出 PS** 再启动 |
| 回归命令 | `node --check` ×10；`%TEMP%\ecom-hostsim.js`（132 项）、`%TEMP%\ecom-v6-check.js`（62 项）、`%TEMP%\ecom-v3-probe2.js`（27 项）—— 期望**全 0 失败** |
| 调研克隆产物 | `%TEMP%\uxp-survey\`（9 个 shallow clone，可删） |

---

## 2. 本次会话做了什么

1. 修「调尺寸时图层是锁住状态导致插件卡住」：`plugin/src/ps.js` 增 `domFindLayerById` / `layerLockInfo` / `ensureUnlocked`，`plugin/src/compose.js` 缩放居前先解锁，`run()` 退避循环加一次性锁探测 → 文档 §18。✅ 已装机，**待真机复测**。
2. 加「导出可自选输出目录」：`ps.pickFolder(initialDomainName)`（`localFileSystem.getFolder`）+ 面板「输出目录 / 选择… / 清除」 → 文档 §19。✅ 已装机。
3. 烘焙图层蒙版（`applyUserMask` 候选表 + 回读确认；失败不再掐死流程）→ 文档 §16/§17。✅ 真机已验证（日志 `应用蒙版生效形式 = delete+apply`）。
4. GitHub 上传 + `一键安装.bat` / `一键卸载.bat` + Release `v1.0.0`。
5. 调研同类开源插件 → `docs/RESEARCH-plugins.md`；自动摆正 / 透视矫正方案 → `docs/PLAN-straighten.md`（含多物体一节）。

---

## 3. 没做的事（新对话的候选，按建议顺序）

1. **只读探针（推荐第一步，零风险）**：只写日志报告 θ / 四角 / 拟合残差 / 透视比 / 建议动作，并**真机回读** `lensCorrection`、`cameraRaw`、`transform quad` 三个事件名是否可用、参数键名是什么。做法见 `docs/PLAN-straighten.md` §9。**不要在这一步改画面。**
2. 用户**未采纳**的 3 条代码改进（清单在 `docs/RESEARCH-plugins.md` §4）：① `run()` 统一错误断言（`PixelRunner commands.js` 的 `assertBatchPlaySucceeded`）② `menu.js` 本地化菜单标题扫 commandID ③ PS 串行锁（ps-banana 思路，**注意其 GPL-3.0 代码不可抄**）。
3. 摆正分档推进：A 档（旋转）→ B 档（透视）→ D 档（多物体）；每档都要真机复测。
4. 真机验收欠账：① 锁住图层时不再卡住 ②「选择…」输出目录 ③ 卸载 → 安装的逐文件哈希核对（需 PS 完全退出）。

---

## 4. 踩坑速查（省一次返工）

- **`stringIDToTypeID` 会凭空造 ID**：事件名写错当时不报错，PS 执行时才回「命令"<未知的>"当前不可用」→ 新描述符一律**候选表逐个试 + 回读确认**（范例：`plugin/src/ps.js` 的 `applyUserMask`）。
- 「当前不可用」有**三种**含义：PS 真忙（退避重试）/ 名字错（回 `<未知的>`）/ **图层锁定**（先解锁，文档 §18）。
- **命令成功 ≠ 生效**：必须回读。读蒙版用整层 `get` + `hasKey('userMaskEnabled')`（其**布尔值**才是判据）；按通道引用读蒙版在 PS 27.1 恒报「程序错误」，不可用作判据。
- **ExtendScript DOM 句柄会失效**：必须**重新取对象**再读（别复用手里的 `L.mask`）。
- 可选步骤失败只 `log("warn", ...)` 继续，**不得掐死一键流程**（文档 §17）。
- 装机 / 换代码前必须**完全退出 PS**（PS 退出时会重写自己的注册文件）。

---

## 5. 给新对话的第一句话（可直接粘贴）

> 先读 `docs/HANDOFF.md`、`docs/PLAN-straighten.md`（§8 多物体、§9 只读探针）、`docs/RESEARCH-plugins.md`，然后按 §9 做**只读探针**（只写日志、不改画面）。
