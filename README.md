# SteamDB 中文化增强版 🎮

<p align="center">
  <strong>现代化 SteamDB 全站中文化油猴脚本：动态内容实时翻译 + 上游词库自动同步 + 补充词库优先级容灾</strong>
</p>

<p align="center">
  <a href="https://raw.githubusercontent.com/3304711297/steamdb-chinese-plus/main/steamdb-chinese-plus.user.js"><img src="https://img.shields.io/badge/Install-Userscript-brightgreen?style=flat-square&logo=tampermonkey" alt="Install"></a>
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

1. 浏览器需已安装用户脚本管理器（[ScriptCat 脚本猫](https://scriptcat.org/) / Tampermonkey / Violentmonkey 均可）；
2. 点击下方链接直接安装（直连 / 镜像双通道任选）：

| 安装通道 | 链接 | 说明 |
| :--- | :--- | :--- |
| ⚡ **GitHub 直连通道** | [一键安装 steamdb-chinese-plus.user.js](https://raw.githubusercontent.com/3304711297/steamdb-chinese-plus/main/steamdb-chinese-plus.user.js) | **推荐**。版本发布后即刻生效，无缓存延迟 |
| 🌐 **jsDelivr 镜像通道** | [一键安装 (jsDelivr CDN 镜像)](https://cdn.jsdelivr.net/gh/3304711297/steamdb-chinese-plus@main/steamdb-chinese-plus.user.js) | 国内网络直连不畅时使用（CDN 约有 12 小时缓存） |

> 脚本管理器会通过 `@updateURL` 自动检查并平滑静默更新。

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

## 🛠️ 本地开发与测试

```bash
# 1. 运行全量单测套件
node --test tests/engine-dom.test.mjs tests/i18n-core.test.mjs tests/word-priority.test.mjs tests/check-upstream.test.mjs

# 2. 手动检测上游词库更新 (退出码 10 代表有新内容)
node scripts/check-upstream.mjs

# 3. 组装单文件产物并执行语法校验
node build.mjs
node --check steamdb-chinese-plus.user.js
```

### 语义化版本号规则
格式为 `<功能主版本>.<同步构建号>`（例如 `v1.0.1`）：
- **前两位变化**：代表核心翻译引擎架构、算法优化或兼容性修复；
- **末位变化**：代表上游词库自动同步触发的增量发版。

---

## 📄 致谢与开源协议

- 词库源自 [Chr233/GM_Scripts](https://github.com/Chr233/GM_Scripts) 的 `SteamDB/SteamDB_CN.json`（AGPL-3.0）；
- 核心翻译引擎为原创独立实现，采用 CSS 选择器作用域精准匹配，确保游戏原名、价格与数据绝对安全。

本项目依据 **GNU Affero General Public License v3.0 (AGPL-3.0)** 开源。
