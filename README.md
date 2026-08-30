# SteamDB 中文化增强版

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![CI](https://github.com/3304711297/steamdb-chinese-plus/actions/workflows/ci.yml/badge.svg)](https://github.com/3304711297/steamdb-chinese-plus/actions/workflows/ci.yml)

中文化 [SteamDB](https://steamdb.info/) 全站界面的油猴用户脚本:导航、表格表头、筛选器、按钮、placeholder、悬浮提示一网打尽。

前身是 GreasyFork 的 [SteamDB_CN](https://greasyfork.org/zh-CN/scripts/437076)(作者 Chr_,已停更)。本仓库 vendored 其词库并持续维护,替换为支持动态内容的原创引擎。

## 安装

1. 浏览器安装用户脚本管理器([ScriptCat 脚本猫](https://scriptcat.org/) / Tampermonkey / Violentmonkey 均可)
2. 点击安装:[steamdb-chinese-plus.user.js](https://raw.githubusercontent.com/3304711297/steamdb-chinese-plus/main/steamdb-chinese-plus.user.js)

脚本管理器会通过 `@updateURL` 自动检查更新。

## 相比原版 SteamDB_CN 的改进

- **动态内容实时翻译**:原脚本只在页面加载时翻译一次;本引擎用 MutationObserver + `requestIdleCallback` 空闲批处理,表格排序/翻页、通知面板、筛选面板的动态刷新内容也会被翻译
- **空白保留**:文本替换保留节点原文的前导/尾随空白,不破坏布局
- **DYNAMIC 段已实装**:原词库的 DYNAMIC(动态作用域词典)标注"暂未实装",本引擎已实装
- **攒词条模式**:脚本管理器菜单一键开关"输出未命中词",配合本仓库的补充词库机制持续补词
- **上游词库自动跟进**:GitHub Actions 每 6 小时检测词库上游更新,有更新自动重组并发新版本;raw 不可达时自动走 jsDelivr / 作者自有 CDN 容灾;上游消失不影响使用

## 词库来源与致谢

- 词库取自 [Chr_/GM_Scripts](https://github.com/Chr_/GM_Scripts) 的 `SteamDB/SteamDB_CN.json`(AGPL-3.0),快照保存在 `sources/steamdb-dict.json`
- 引擎为原创实现,设计思路参考原脚本的选择器作用域方案(按 CSS 选择器圈定翻译范围,词典精确匹配本身即是安全机制,不会误伤应用名/价格等页面数据)

本项目按 **AGPL-3.0** 发布;上游词库内容版权归原作者所有(Chr_、joejoe5、cyb233、lyzlyslyc、悠久の蝶、shiquda)。

## 开发

```bash
node build.mjs        # 组装生成 steamdb-chinese-plus.user.js(勿手改)
node --check steamdb-chinese-plus.user.js
node --test tests/i18n-core.test.mjs tests/check-upstream.test.mjs
node scripts/check-upstream.mjs   # 手动检查上游词库更新(退出码 10=有更新)
```

目录结构:

```
sources/steamdb-dict.json       上游词库快照(vendored,自动同步)
sources/steamdb-supplement.json 自有补充词条(真机漏翻,同步不会冲掉)
i18n-core.mjs                   纯函数翻译核心(引擎与单测共用)
engine.js                       翻译引擎(原创,无词库)
build.mjs                       组装:头部 + 核心 + 词库 + 引擎 → 单文件产物
scripts/check-upstream.mjs      上游词库检查与同步(候选源整组容灾)
upstream.config.json            上游仓库与 CDN/镜像配置
upstream.state.json             同步状态(哈希/词库版本/buildNumber)
```

版本号语义:格式 `<功能版本>.<同步构建号>`——前两段变化 = 功能/引擎/兼容性变更;仅末段变化 = 纯词库自动同步。
