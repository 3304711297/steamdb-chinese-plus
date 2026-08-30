/**
 * 组装脚本:生成单文件 userscript
 *
 * 结构:
 *   1. 元数据头(含来源署名、远程安装/自动更新地址)
 *   2. i18n-core.mjs 翻译核心(内联时去掉 export)
 *   3. 词库 sources/steamdb-dict.json + sources/steamdb-supplement.json(合并后内联)
 *   4. engine.js 翻译引擎(原创)
 *
 * 版本号规则:`<ourBase>.<buildNumber>`
 *   - ourBase:我们自己的功能版本,人工改动功能(含引擎修复/兼容性调整)时手动递增
 *     (唯一权威来源是下方 OUR_BASE 常量)
 *   - buildNumber:upstream.state.json 中的构建号,上游词库每次实际更新时由
 *     scripts/check-upstream.mjs 自动 +1,保证脚本管理器能识别到新版本
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateLocales, mergeLocales } from './i18n-core.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(join(root, name), 'utf8');

/* ====== 发布配置 ====== */
const REPO_OWNER = '3304711297';
const REPO_NAME = 'steamdb-chinese-plus';
const OUR_BASE = '1.2'; // 我们自己的功能版本号,有功能性改动(含引擎修复/兼容性调整)时手动递增

const state = JSON.parse(readFileSync(join(root, 'upstream.state.json'), 'utf8'));
const BUILD_NUMBER = state.buildNumber || 1;
const VERSION = `${OUR_BASE}.${BUILD_NUMBER}`;
const UPSTREAM_DICT_VERSION =
    (state.sources && state.sources.Chr_ && state.sources.Chr_.versions?.dict) || '未知';
const RAW_URL = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/main/steamdb-chinese-plus.user.js`;

const HEADER = `// ==UserScript==
// @name         SteamDB 中文化增强版
// @namespace    steamdb-chinese-plus
// @description  中文化 SteamDB(steamdb.info)全站界面:导航、表格表头、筛选器、按钮、placeholder、悬浮提示;表格排序/通知面板等动态内容实时翻译。词库基于 Chr_/GM_Scripts SteamDB_CN (AGPL-3.0);翻译引擎为原创实现
// @version      ${VERSION}
// @author       steamdb-chinese-plus
// @license      AGPL-3.0
// @icon         https://steamdb.info/static/img/favicon.ico
// @match        https://steamdb.info/*
// @noframes     页面内嵌 iframe 不注入,避免重复翻译与重复菜单命令
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @homepageURL  https://github.com/${REPO_OWNER}/${REPO_NAME}
// @supportURL   https://github.com/${REPO_OWNER}/${REPO_NAME}/issues
// @downloadURL  ${RAW_URL}
// @updateURL    ${RAW_URL}
// ==/UserScript==

/**
 * 来源与取舍说明:
 *
 * 1. 词库 —— 取自 Chr_/GM_Scripts 的 SteamDB/SteamDB_CN.json (AGPL-3.0)
 *    https://github.com/Chr_/GM_Scripts (GreasyFork 脚本 437076 SteamDB_CN)
 *    选择理由:唯一成规模的 SteamDB 汉化词库(1400+ 词条,选择器作用域组织),
 *    原 GreasyFork 脚本已停更,本仓库 vendored 其词库并自动跟进。
 *    当前内联词库版本:v${UPSTREAM_DICT_VERSION}
 *
 * 2. 翻译引擎 —— 本文件原创实现,设计思路参考原脚本的选择器作用域方案:
 *    相比原脚本"页面加载时一次性翻译",本引擎支持动态内容
 *    (表格排序/通知面板/筛选面板)的实时翻译,文本替换保留原文空白。
 *
 * 3. 本仓库通过 GitHub Actions 定时检测上游词库更新并自动重组,
 *    上游快照完整保存在 sources/ 目录,上游项目消失也不影响使用与维护。
 *    自有补充词条放 sources/steamdb-supplement.json,合并时优先级高于上游。
 *
 * 本作品按 AGPL-3.0 许可证发布;上游词库内容版权归原作者所有。
 */

`;

/** 内联 i18n-core:去掉 export 关键字(浏览器端不需要模块导出) */
function inlineCore(source) {
    const stripped = source.replace(/^export\s+/gm, '');
    if (/^\s*export\b/m.test(stripped)) throw new Error('i18n-core.mjs 存在无法内联的 export 形式');
    return stripped.trimEnd();
}

const base = JSON.parse(read('sources/steamdb-dict.json'));
const baseError = validateLocales(base);
if (baseError) throw new Error(`上游词库文件不合法: ${baseError}`);

// 合并自有补充词库:与上游快照分离,check-upstream 只覆盖 steamdb-dict.json,不会被同步冲掉。
// 允许空补充词库(尚无实测漏翻词条时)。REGEX 段也算有效内容,
// 否则"只有正则规则"的补充词库会被误判为空而整体丢失
const supplement = JSON.parse(read('sources/steamdb-supplement.json'));
const supplementHasEntries = ['STATIC', 'DYNAMIC', 'INPUT', 'LABEL']
    .some((k) => supplement[k] && Object.keys(supplement[k]).length > 0)
    || (Array.isArray(supplement.REGEX) && supplement.REGEX.length > 0);
let dict;
if (supplementHasEntries) {
    const supplementError = validateLocales(supplement);
    if (supplementError) throw new Error(`补充词库不合法: ${supplementError}`);
    dict = mergeLocales(base, supplement);
} else {
    dict = mergeLocales(base, null);
}

let entryCount = 0;
for (const dic of Object.values(dict.STATIC)) entryCount += Object.keys(dic).length;
for (const section of ['INPUT', 'LABEL']) entryCount += Object.keys(dict[section] || {}).length;
for (const dic of Object.values(dict.DYNAMIC || {})) entryCount += Object.keys(dic).length;
const dictVersion = (dict.DOC && dict.DOC['更新时间']) || UPSTREAM_DICT_VERSION;

const core = inlineCore(read('i18n-core.mjs'));
const engine = read('engine.js').trimEnd();

const output = HEADER +
    `(function () {\n'use strict';\n\n` +
    `/* ==== 翻译核心(原创,与 tests/ 共用同一实现)==== */\n` + core + '\n\n' +
    `/* ==== 词库(内联自 Chr_/GM_Scripts SteamDB_CN.json v${UPSTREAM_DICT_VERSION} + 自有补充)==== */\n` +
    `const __LOCALES = ${JSON.stringify(dict)};\n` +
    `const __DICT_VERSION = ${JSON.stringify(dictVersion)};\n` +
    `const __ENTRY_COUNT = ${entryCount};\n` +
    `const __VERSION = ${JSON.stringify(VERSION)};\n\n` +
    `/* ==== 翻译引擎(原创)==== */\n` + engine + '\n' +
    `})();\n`;

const outPath = join(root, 'steamdb-chinese-plus.user.js');
writeFileSync(outPath, output, 'utf8');
console.log(`已生成: ${outPath} (${output.length} 字节,版本 ${VERSION},上游词库 v${UPSTREAM_DICT_VERSION},${entryCount} 词条)`);
