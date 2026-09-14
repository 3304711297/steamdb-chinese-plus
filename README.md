# SteamDB 中文化增强版 🎮

<p align="center">
  <strong>现代化 SteamDB 全站中文化油猴脚本：动态内容实时翻译 + 上游词库自动同步 + 补充词库优先级容灾</strong>
</p>

<p align="center">
  <a href="https://raw.githubusercontent.com/3304711297/steamdb-chinese-plus/main/steamdb-chinese-plus.user.js"><img src="https://img.shields.io/badge/Install-Rolling%20Track-brightgreen?style=flat-square&logo=tampermonkey" alt="Install Rolling Track"></a>
  <a href="https://github.com/3304711297/steamdb-chinese-plus/releases"><img src="https://img.shields.io/github/v/release/3304711297/steamdb-chinese-plus?style=flat-square&label=Release%20Baseline&logo=github" alt="Release Baseline"></a>
  <a href="https://github.com/3304711297/steamdb-chinese-plus/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/3304711297/steamdb-chinese-plus/ci.yml?branch=main&label=CI%20Build&style=flat-square" alt="CI Status"></a>
  <a href="https://github.com/3304711297/steamdb-chinese-plus/actions/workflows/upstream-sync.yml"><img src="https://img.shields.io/github/actions/workflow/status/3304711297/steamdb-chinese-plus/upstream-sync.yml?branch=main&label=Sync%20Upstream%20(6h)&style=flat-square" alt="Sync Upstream"></a>
  <img src="https://img.shields.io/badge/Target-SteamDB.info-1b2838?style=flat-square&logo=steam" alt="SteamDB">
  <a href="https://www.gnu.org/licenses/agpl-3.0"><img src="https://img.shields.io/badge/License-AGPL--3.0-blue.svg?style=flat-square" alt="License"></a>
</p>

---

## 📖 项目简介

中文化 [SteamDB](https://steamdb.info/) 全站界面的油猴用户脚本：涵盖导航栏、表格表头、筛选器、状态徽章、输入占位符 (Placeholder) 与悬浮提示 (Tooltip)。

前身是 GreasyFork 的著名脚本 [SteamDB_CN](https://greasyfork.org/zh-CN/scripts/437076)（作者 Chr_，已停更）。本仓库对词库进行了 Vendored 维护，并彻底重写为支持 **MutationObserver 动态实时翻译与空闲批处理** 的现代化高性能引擎。

---

## 🚀 一键安装

1. 浏览器需已安装用户脚本管理器（推荐 [ScriptCat 脚本猫](https://scriptcat.org/)，亦完全兼容 Tampermonkey、Violentmonkey 等）；
2. 根据您的稳定性偏好与更新需求，选择对应的发布通道安装：

### 📦 发布通道对比与安装指引

| 发布通道 | 安装链接 | 适用场景与特性 | 更新机制与频率 |
| :--- | :--- | :--- | :--- |
| 🚀 **滚动通道 (Rolling)**<br>*(推荐·GitHub 直连)* | [⚡ 一键安装 steamdb-chinese-plus.user.js](https://raw.githubusercontent.com/3304711297/steamdb-chinese-plus/main/steamdb-chinese-plus.user.js) | **默认推荐**。跟随 `main` 主分支，第一时间获得引擎优化、新特性与词库更新，无 CDN 缓存延迟 | **高频静默更新**<br>代码提交或每 6h 词库同步时即时生效 |
| 🌐 **滚动通道 (Rolling)**<br>*(备选·CDN 镜像)* | [🔗 一键安装 (jsDelivr 镜像)](https://cdn.jsdelivr.net/gh/3304711297/steamdb-chinese-plus@main/steamdb-chinese-plus.user.js) | 适合国内网络无法顺畅直连 GitHub Raw 的网络环境（CDN 节点存在约 12 小时缓存） | **高频**<br>跟随 `main` 分支（存在 CDN 缓存窗口） |
| 🛡️ **稳定通道 (Stable)**<br>*(最新稳定版直链)* | [📦 一键安装 Releases 最新资产](https://github.com/3304711297/steamdb-chinese-plus/releases/latest/download/steamdb-chinese-plus.user.js) | **极致稳定**。跟随 Releases 最新稳定标签（首个稳定基线 `v1.4.4`，之后随 Releases 推进），仅在发布正式 GitHub Release 时更新，免受高频自动同步扰动 | **低频**<br>仅在正式发布里程碑 Release 标签时更新 |
| 📜 **稳定通道 (Stable)**<br>*(历史版本归档)* | [🗄️ 浏览 GitHub Releases 归档列表](https://github.com/3304711297/steamdb-chinese-plus/releases) | 查看完整发版说明、历史变更记录，或下载历史指定版本以供锁定回滚 | 按需手动下载与回滚 |

> 💡 **更新与切换说明**：
> - **滚动通道**脚本内置 `@updateURL` 与 `@downloadURL` 指向 `main` 分支，脚本管理器将跟随主分支日常演进平滑静默升级。
> - **稳定通道**脚本资产锚定在 GitHub Releases，首个稳定基线为 **v1.4.4**，之后随 Releases 持续推进。
> - 滚动通道与稳定通道产物命名一致，如需切换通道，直接点击目标通道链接重新安装覆盖即可。

---

## ⚡ 相比原版 SteamDB_CN 的核心升级

| 特性维度 | 🚀 SteamDB Chinese Plus (本项目) | 💤 原版 SteamDB_CN (停更) |
| :--- | :--- | :--- |
| **动态内容响应** | **MutationObserver + requestIdleCallback**，表格排序、翻页、弹窗、动态筛选毫秒级实时汉化 | 仅页面初次加载时执行一次，动态翻页后失效 |
| **排版与空白保护** | **精准保留节点前后空白字符**，确保原生 UI 间距与 Flex 排版不崩塌 | 粗暴替换可能导致文字紧贴或布局变形 |
| **动态作用域字典** | **完整实装 DYNAMIC 动态字典段** | 标注“暂未实装” |
| **词库自动同步** | **GitHub Actions 每 6 小时自动检测上游更新**，多 CDN 候选容灾，自动发版 | 需人工手动更新 |
| **本地攒词模式** | 脚本菜单支持一键开启「输出未命中词条」，方便日常补充漏翻 | 无内置辅助工具 |
| **词库冲突裁决** | 严格遵循 `Base 基础词库 → Supplement 自有补充 → Build 组装` 三级覆盖 | 无分层覆盖体系 |

---

## 🔄 词库优先级与合并机制

```text
┌──────────────────────────────────────┐
│  sources/steamdb-dict.json (Base)    │  <── GitHub Actions 每 6h 自动拉取更新
└──────────────────┬───────────────────┘
                   │ 覆盖合并 (Supplement 优先级更高)
                   ▼
┌──────────────────────────────────────┐
│ sources/steamdb-supplement.json      │  <── 本地实机抓取补充的词条 (永不被上游冲掉)
└──────────────────┬───────────────────┘
                   │
                   ▼ (Node.js 构建器: build.mjs)
┌──────────────────────────────────────┐
│ steamdb-chinese-plus.user.js         │  <── 最终发布的零依赖单文件产物
└──────────────────────────────────────┘
```

1. **同 Key 覆盖规则**：`supplement` 中已有的词条在合并时优先覆盖 `base` 中的同名词条。若想恢复使用上游译文，直接删除 `supplement` 中对应条目即可。
2. **Key 更名迁移保护**：若上游发生 Key 更名，新 Key 自动采用上游最新翻译，旧 Key 在 `supplement` 中保留不影响页面匹配，防止误伤。

---

## 📂 项目结构

仓库核心布局与文件职责一览：

```text
steamdb-chinese-plus/
├── build.mjs                        # 构建器（OUR_BASE 版本常量所在）
├── engine.js                        # 翻译引擎入口
├── i18n-core.mjs                    # 翻译核心
├── steamdb-chinese-plus.user.js     # 构建产物（勿手改，CI 会校验产物与源一致）
├── upstream.config.json             # 上游同步配置
├── upstream.state.json              # 上游同步状态（buildNumber + snapshotHashes 快照锚点）
├── sources/
│   ├── steamdb-dict.json            # 上游基础词库（GitHub Actions 每 6h 自动同步）
│   └── steamdb-supplement.json      # 自有补充词库（优先级更高，永不被上游冲掉）
├── scripts/
│   └── check-upstream.mjs           # 上游检测（退出码 0/10/20，语义见下节）
├── tests/                           # 5 个单测：engine-dom / i18n-core / word-priority / check-upstream / build
└── docs/                            # 开发文档与记录
```

### 🔐 同步状态文件与退出码

`upstream.state.json` 里有两组哈希，**语义不同，不要互相替代**：

| 字段 | 记录内容 | 用途 |
| :--- | :--- | :--- |
| `sources.<源名>.hashes` | **上游原文**的 sha256 | 判断"上游是否发布了新内容"（与本地无关） |
| `snapshotHashes` | **本地 `sources/` 快照文件**当前内容的 sha256 | 判断"本地快照是否被人工改动过" |

本仓库对上游词库做过死词条清理，因此这两组值**天然不相等**（上游原文哈希 ≠ 清理后的本地哈希），这是预期状态而非异常：

- 上游一有更新，快照会被**整文件覆盖**。任何人工改动（如清理死词条）都必须把 `snapshotHashes` 同步回写为实际值；
- 否则 `check-upstream.mjs` 会以**退出码 20 中断并指名不一致的文件**，避免改动在下次同步时被静默丢弃；
- 想长期保留的自有词条请放进 `sources/steamdb-supplement.json`（合并优先级更高，永不被上游覆盖）。

`check-upstream.mjs` 退出码：

| 退出码 | 含义 | 工作流行为 |
| :--- | :--- | :--- |
| `0` | 无更新，或上游全部候选源不可用（快照原样保留） | 保持绿色 |
| `10` | 快照已更新，需重新构建 | 触发重建 + 单测门禁后提交 |
| `20` | **仓库自身状态异常**：状态文件缺失/损坏，或本地快照与 `snapshotHashes` 不一致 | 变红报警，需人工介入 |

同步写入状态文件遵循"**实质性变化才落盘**"：`checkedAt` 只记录最近一次实质状态变化的检查时刻，因此上游长期宕机时不会每 6 小时产生一个只差时间戳的噪音提交——首次判定不可用（状态跃迁）记录一次，其后每次调度仅在日志中告警。

---

## 🛠️ 本地开发与测试

```bash
# 1. 运行全量单测套件
node --test tests/engine-dom.test.mjs tests/i18n-core.test.mjs tests/word-priority.test.mjs tests/check-upstream.test.mjs tests/build.test.mjs

# 2. 手动检测上游词库更新 (退出码 10 代表有新内容)
node scripts/check-upstream.mjs

# 3. 组装单文件产物并执行语法校验
node build.mjs
node --check steamdb-chinese-plus.user.js
```

### 📌 版本基线与双通道规范

| 维度 | 🚀 滚动通道 (Rolling Track) | 🛡️ 稳定通道 (Stable Track) |
| :--- | :--- | :--- |
| **代码基线** | `main` 分支最新代码 | GitHub Releases 标签版本（**首个稳定基线 `v1.4.4`，之后随 Releases 推进**） |
| **分发地址** | `main/steamdb-chinese-plus.user.js` | [Releases 最新资产永久直链](https://github.com/3304711297/steamdb-chinese-plus/releases/latest/download/steamdb-chinese-plus.user.js) |
| **更新触发** | 主干 Commit 合并、每 6h 定时词库同步 | 维护者正式切出 GitHub Release 时发布 |
| **适用人群** | 追求最新特性与最新词库、愿意协助反馈体验的用户 | 追求生产级绝对稳定、不希望受频繁更新打扰的用户 |
| **版本回滚** | 随 `main` 滚动前进 | 支持随时在 [Releases 归档](https://github.com/3304711297/steamdb-chinese-plus/releases) 下载固定历史版本 |

#### 1. 版本基线演进（Release Baseline）
- **基线版本**：本项目首个稳定通道基线正式确立为 **v1.4.4**。
- **历史说明**：仓库早期采用纯滚动开发模式且未维护历史 Git tag；自 **v1.4.4** 起全面建立正式 Release 里程碑管理，后续稳定版本均遵循规范打 Tag 发布。

#### 2. 构建版本号构成规则
脚本元数据 `@version` 遵循 `<功能主版本>.<同步构建号>` 格式（例如 `1.4.4`）：
- **前两位（如 `1.4`）**：核心功能版本（权威来源为 `build.mjs` 中的 `OUR_BASE`），在发生翻译引擎重构、DOM 批处理逻辑调整、新功能特性实装或关键兼容性修复时手动递增；
- **末位（如 `4`）**：上游同步构建号（权威来源为 `upstream.state.json` 中的 `buildNumber`），由 GitHub Actions（`upstream-sync.yml`）每 6 小时自动检测，仅在上游词库发生实质变动时自动递增，保证脚本管理器识别到版本号递增并触发静默更新。

#### 3. 客户端平滑更新机制
- **滚动通道**：通过脚本内置 `@updateURL` 与 `@downloadURL` 默认绑定 `main` 分支 raw 链接。脚本管理器（ScriptCat / Tampermonkey 等）依据预设策略后台静默拉取更新；
- **稳定通道**：通过 Release 资产安装。用户享受经过充分验证的里程碑产物；
- **安全回滚机制**：如遇特殊环境兼容性异常，用户可随时在 [Releases 归档列表](https://github.com/3304711297/steamdb-chinese-plus/releases) 下载任一历史版本覆盖安装，实现版本锁定。

---

## ❓ 常见问题 (FAQ)

<details>
<summary><b>Q1：安装后页面没有翻译效果？</b></summary>

- 先确认用户脚本管理器已启用、本脚本处于运行状态，并刷新页面；
- 确认脚本已获得 `steamdb.info` 的站点访问权限；
- ScriptCat 用户在 Edge 浏览器下，需在扩展设置中开启「允许访问文件 URL」；若控制台出现 `ERR_BLOCKED_BY_CLIENT`，通常是浏览器跟踪防护或扩展拦截了请求，将 SteamDB 加入例外 / 信任列表后重试；
- 仍未生效时，请携带浏览器版本与控制台报错截图到仓库提交 Issue。

</details>

<details>
<summary><b>Q2：词库多久更新一次？</b></summary>

GitHub Actions 每 6 小时自动检测上游词库，检测到更新即自动构建发版：

- **滚动通道**：跟随 `main` 分支，提交与词库同步后即时生效；
- **jsDelivr 镜像**：存在约 12 小时的 CDN 缓存窗口，介意延迟可改用 GitHub 直连通道；
- **稳定通道**：仅在发布正式 Release 时更新。

</details>

<details>
<summary><b>Q3：表格排序 / 翻页后内容没有翻译？</b></summary>

引擎基于 **MutationObserver + requestIdleCallback**，对 DOM 动态变化做毫秒级实时汉化，排序、翻页、弹窗等动态内容理论上不会漏翻。若确实遇到漏翻，欢迎提交 Issue 并附上页面 URL 与截图。

</details>

<details>
<summary><b>Q4：会翻译游戏名或价格数据吗？</b></summary>

不会。翻译引擎采用 CSS 选择器作用域精准匹配，只汉化界面词汇（表头、导航、筛选器等），游戏原名、价格与数据绝对安全。

</details>

<details>
<summary><b>Q5：发现漏翻的词条怎么办？</b></summary>

脚本菜单内置「输出未命中词条」功能，开启后正常浏览页面即可收集漏翻词条；将导出内容整理后到仓库提交 Issue，即可被收录进 `sources/steamdb-supplement.json`。

</details>

---

## 📄 致谢与开源协议

- 词库源自 [Chr233/GM_Scripts](https://github.com/Chr233/GM_Scripts) 的 `SteamDB/SteamDB_CN.json`（AGPL-3.0）；
- 核心翻译引擎为原创独立实现，采用 CSS 选择器作用域精准匹配，确保游戏原名、价格与数据绝对安全。

本项目依据 **GNU Affero General Public License v3.0 (AGPL-3.0)** 开源。
