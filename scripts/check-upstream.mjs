/**
 * 上游词库检查与同步
 *
 * 职责:
 *   1. 按 upstream.config.json 逐个尝试上游仓库(含镜像),拉取词库文件
 *   2. 与 upstream.state.json 中记录的哈希比对,判断是否有更新
 *   3. 有更新 → 覆盖 sources/ 下的本地快照,递增 buildNumber,记录新版本号
 *   4. 上游不可用(删除/断网/改名)→ 记录状态并正常退出,绝不改动本地快照
 *   5. 校验本地快照内容与 state 的 snapshotHashes 记录一致:
 *      快照上的任何人工改动必须显式锚定,否则会在下次上游更新时被静默覆盖
 *
 * 设计原则(与 openrouter-chinese-plus 同构):本仓库的 sources/ 是完整的 vendored
 * 快照,上游消失只影响"能否跟进新词库",不影响本项目继续构建、发布和维护。
 * 工作流因此永远不会因上游挂掉而变红。
 *
 * 退出码:0 = 无需处理(无更新或上游不可用);10 = 快照已更新,需要重新构建;
 *       20 = 本仓库自身状态异常(如 upstream.state.json 缺失/损坏、
 *       本地快照与 snapshotHashes 记录不一致)——绝不能静默,
 *       否则重算会从默认 buildNumber 起步、产物版本号倒退,脚本管理器将不再提示更新;
 *       或人工清理过的快照被上游原文整文件覆盖后无人察觉。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const execFileAsync = promisify(execFile);

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = join(projectRoot, 'upstream.config.json');
const STATE_PATH = join(projectRoot, 'upstream.state.json');

const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));

const EXIT_OK = 0;
const EXIT_UPDATED = 10;
const EXIT_UNEXPECTED = 20;

/** 标记"本仓库自身状态异常"的错误:必须让工作流变红,不允许当作网络问题静默放过 */
class UnexpectedError extends Error {
    constructor(message) {
        super(message);
        this.name = 'UnexpectedError';
        this.unexpected = true;
    }
}

/**
 * 校验状态文件内容(纯函数,供单元测试)。
 * buildNumber 是产物版本号的基准,缺失/非法时宁可选择失败也绝不静默回退到默认值——
 * 一旦从默认值重算,哪怕上游内容没变,版本号也会倒退,
 * 脚本管理器会把降版视为"已是最新",用户从此收不到更新。
 * @returns {{ok: true, state: object} | {ok: false, reason: string}}
 */
function parseStateText(raw) {
    let state;
    try {
        state = JSON.parse(raw);
    } catch (e) {
        return { ok: false, reason: `JSON 解析失败: ${e.message}` };
    }
    if (!state || typeof state !== 'object' || Array.isArray(state)) {
        return { ok: false, reason: '顶层必须是对象' };
    }
    if (!Number.isInteger(state.buildNumber) || state.buildNumber < 1) {
        return { ok: false, reason: `buildNumber 非法(${JSON.stringify(state.buildNumber)}),必须是 >=1 的整数` };
    }
    if (typeof state.sources !== 'object' || state.sources === null || Array.isArray(state.sources)) {
        return { ok: false, reason: 'sources 缺失或类型非法' };
    }
    // snapshotHashes 是"本地快照是否被改动"的唯一判据,格式非法时必须显式失败:
    // 若当作"未记录"放过,漂移校验会被静默跳过,人工改过的快照仍会被上游整文件覆盖
    if (state.snapshotHashes !== undefined) {
        const sh = state.snapshotHashes;
        if (typeof sh !== 'object' || sh === null || Array.isArray(sh)) {
            return { ok: false, reason: 'snapshotHashes 类型非法,应是 {相对路径: sha256} 对象' };
        }
        for (const [local, digest] of Object.entries(sh)) {
            if (typeof digest !== 'string' || !/^[0-9a-f]{64}$/.test(digest)) {
                return { ok: false, reason: `snapshotHashes["${local}"] 非法(${JSON.stringify(digest)}),应是 64 位十六进制 sha256` };
            }
        }
    }
    return { ok: true, state };
}

function loadState() {
    let raw;
    try {
        raw = readFileSync(STATE_PATH, 'utf8');
    } catch (e) {
        throw new UnexpectedError(
            `无法读取状态文件 upstream.state.json(${e.message})。` +
            '该文件随仓库提交,缺失说明仓库被改动;拒绝以默认 buildNumber 重建以免版本号倒退,请先恢复该文件。'
        );
    }
    const parsed = parseStateText(raw);
    if (!parsed.ok) {
        throw new UnexpectedError(
            `状态文件 upstream.state.json 已损坏(${parsed.reason})。` +
            '拒绝自动重建以免版本号倒退,请从 git 历史恢复该文件。'
        );
    }
    return parsed.state;
}

function saveState(state) {
    writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

function sha256(text) {
    return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * 读取本地快照文件的实际 sha256(纯函数,供单元测试)。
 * 哈希对象为 UTF-8 解码后的文本内容,与上游拉取侧 `sha256(text)` 同口径,
 * 因此"上游原文写入本地"后两侧哈希可直接比对。
 * 文件缺失/不可读记为 null,由调用方判定为漂移——绝不因"读不到"就静默放过。
 * @param {string} root 仓库根目录
 * @param {string[]} locals 相对路径列表(与 config 的 files[].local 同形)
 * @returns {Object<string, string|null>}
 */
function snapshotDigests(root, locals) {
    const digests = {};
    for (const local of locals) {
        try {
            digests[local] = sha256(readFileSync(join(root, local), 'utf8'));
        } catch {
            digests[local] = null;
        }
    }
    return digests;
}

/**
 * 比对本地快照实际哈希与 state.snapshotHashes 记录(纯函数,供单元测试)。
 * 背景:本仓库的 sources/ 是 vendored 快照,上游有更新时会被整文件覆盖。
 * 若有人直接清理/改写了快照却没更新记录,改动会在下次上游更新时静默丢失。
 * 首次运行或新增快照文件(snapshotHashes 未记录该文件)时按"待锚定"处理,不算漂移——
 * 由调用方在落盘时补记,保证启用本校验的当次运行不会误报。
 * @param {object} state
 * @param {Object<string, string|null>} actualDigests
 * @returns {{drifted: boolean, mismatches: Array<{local: string, recorded: string, actual: string|null}>, unrecorded: boolean}}
 */
function detectSnapshotDrift(state, actualDigests) {
    const recorded = state && typeof state.snapshotHashes === 'object' && state.snapshotHashes !== null
        ? state.snapshotHashes
        : null;
    const unrecorded = !recorded || Object.keys(recorded).length === 0;
    const mismatches = [];
    for (const [local, actual] of Object.entries(actualDigests || {})) {
        if (unrecorded || typeof recorded[local] !== 'string') continue;
        if (recorded[local] !== actual) {
            mismatches.push({ local, recorded: recorded[local], actual });
        }
    }
    return { drifted: mismatches.length > 0, mismatches, unrecorded };
}

/** 从快照摘要集合中挑出可锚定的条目(读不到的文件不写入 null 覆盖记录) */
function anchorable(digests) {
    return Object.fromEntries(
        Object.entries(digests || {}).filter(([, v]) => typeof v === 'string')
    );
}

const UA = 'steamdb-chinese-plus-updater';

async function fetchText(url) {
    // 优先直接请求(CI 环境直连);失败后回退 curl —— curl 自动遵循
    // http_proxy/https_proxy 环境变量,兼容本地开发环境代理上网的场景
    try {
        // AbortSignal.timeout:Node fetch 默认无请求超时,最坏情况可挂数分钟;
        // 与 curl 回退的 --max-time 30 对齐
        const res = await fetch(url, {
            redirect: 'follow',
            headers: { 'user-agent': UA },
            signal: AbortSignal.timeout(30000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
        return res.text();
    } catch (directError) {
        // -f:HTTP >= 400 视为失败(仓库不存在/已删除时返回 404 页面而非内容,
        // 绝不能把 404 页面当成上游文件写进快照)
        const { stdout } = await execFileAsync(
            'curl',
            ['-sSLf', '--max-time', '30', '-A', UA, url],
            { maxBuffer: 20 * 1024 * 1024 }
        );
        if (!stdout) throw directError;
        return stdout;
    }
}

/** 从 SteamDB_CN.json 内容提取词库版本号(DOC."更新时间" 字段) */
function extractDictVersion(dictText) {
    try {
        const doc = JSON.parse(dictText).DOC;
        const v = doc && doc['更新时间'];
        return typeof v === 'string' && v ? v : null;
    } catch {
        return null;
    }
}

/**
 * 候选源列表(按优先级):主仓库 raw → cdn 模板(可配置多个,raw 被墙/被限时容灾,
 * CDN 有缓存可能滞后)→ 各镜像仓库 raw。
 * 每个 candidate 是一个"整组源":同一 source 的全部文件必须来自同一个候选源,
 * 不允许逐文件各自回退——否则多文件上游会出现"半 raw 半 CDN"的混合快照。
 * @returns {Array<{label: string, url: (remote: string) => string}>}
 */
function candidateSources(source) {
    const rawUrl = (repo, remote) =>
        `https://raw.githubusercontent.com/${repo}/${source.branch}/${remote}`;
    const list = [{ label: source.repo, url: (remote) => rawUrl(source.repo, remote) }];
    const cdnTemplates = source.cdn === undefined
        ? []
        : (Array.isArray(source.cdn) ? source.cdn : [source.cdn]);
    for (const template of cdnTemplates) {
        list.push({
            label: `${source.repo}(cdn:${new URL(template.replace('{repo}', source.repo)).host})`,
            url: (remote) => template
                .replace('{repo}', source.repo)
                .replace('{branch}', source.branch)
                .replace('{path}', remote),
        });
    }
    for (const repo of source.mirrors || []) {
        list.push({ label: repo, url: (remote) => rawUrl(repo, remote) });
    }
    return list;
}

/**
 * 按候选源整组拉取一个 source 的全部文件:
 * 某个候选源必须把 source.files 全部拉成功才采用,任一文件失败即整组作废、换下一个源。
 * @returns {{ok: boolean, repoUsed?: string, files?: Object<string,string>, error?: Error}}
 */
async function fetchSource(source) {
    let lastError = null;
    for (const candidate of candidateSources(source)) {
        const files = {};
        let complete = true;
        for (const f of source.files) {
            try {
                files[f.local] = await fetchText(candidate.url(f.remote));
            } catch (e) {
                lastError = e;
                complete = false;
                console.warn(`[upstream] 候选源 "${candidate.label}" 拉取 ${f.remote} 失败: ${e.message}`);
                break;
            }
        }
        if (complete) return { ok: true, repoUsed: candidate.label, files };
    }
    return { ok: false, error: lastError };
}

async function main() {
    const state = loadState();
    state.sources = state.sources || {};
    let anyChanged = false;   // 上游内容有实质更新(需要重新构建)
    let stateDirty = false;   // 状态文件需要落盘(内容有实质变化才写,避免时间戳churn)

    // 上游会整文件覆盖这些快照;它们一旦被本地人工改动而未更新记录,
    // 改动就会在下一次上游更新时静默丢失——必须先于任何网络动作检出并中断
    const snapshotLocals = [...new Set(
        config.sources.flatMap((s) => s.files.map((f) => f.local))
    )];

    const before = snapshotDigests(projectRoot, snapshotLocals);
    const drift = detectSnapshotDrift(state, before);
    if (drift.drifted) {
        const detail = drift.mismatches
            .map((m) => `  - ${m.local}\n      记录: ${m.recorded}\n      实际: ${m.actual ?? '(文件缺失或不可读)'}`)
            .join('\n');
        throw new UnexpectedError(
            '本地快照与 upstream.state.json 的 snapshotHashes 记录不一致:\n' + detail +
            '\n这意味着快照被直接改动过(如人工清理词条)。上游一旦更新,该改动会被整文件覆盖而静默丢失。' +
            '请确认改动是刻意保留的,并把 snapshotHashes 更新为实际值(或改走 sources/steamdb-supplement.json);' +
            '本次拒绝继续,以免覆盖前先被误判为"无更新"。'
        );
    }

    for (const source of config.sources) {
        const prev = state.sources[source.name] || {};
        const result = await fetchSource(source);
        const now = new Date().toISOString();

        if (!result.ok) {
            // 上游全部候选仓库不可用:保留本地快照原样,仅记录状态
            const entry = {
                ...prev,
                status: 'unavailable',
                checkedAt: now,
                lastError: result.error ? String(result.error.message || result.error) : 'unknown',
            };
            // 与上次状态完全一致则不落盘(上游长期消失时避免每次调度都产生提交)
            if (JSON.stringify(entry) !== JSON.stringify(prev)) {
                state.sources[source.name] = entry;
                stateDirty = true;
            }
            console.warn(
                `[upstream] ⚠ 上游 "${source.name}" 全部候选仓库均不可用,` +
                `继续使用本地快照(构建不受影响)。上次已知版本: ${prev.versions?.dict || '未知'}`
            );
            continue;
        }

        const hashes = {};
        for (const [local, text] of Object.entries(result.files)) {
            hashes[local] = sha256(text);
        }
        const versions = {
            dict: extractDictVersion(result.files[source.files[0].local]),
        };

        const unchanged =
            prev.hashes && Object.entries(hashes).every(([k, v]) => prev.hashes[k] === v);

        if (unchanged) {
            // 无更新:不落盘(时间戳等易变字段不写入),工作流不会因此产生空提交
            console.log(`[upstream] "${source.name}" 无更新 (词库 v${versions.dict})`);
        } else {
            // 写入新快照并递增构建号,驱动产物版本号上涨以触发用户端自动更新
            for (const [local, text] of Object.entries(result.files)) {
                writeFileSync(join(projectRoot, local), text, 'utf8');
            }
            state.buildNumber = (state.buildNumber || 0) + 1;
            state.sources[source.name] = {
                ...prev,
                status: 'updated',
                repoUsed: result.repoUsed,
                checkedAt: now,
                lastChangedAt: now,
                hashes,
                versions,
                lastError: null,
            };
            anyChanged = true;
            stateDirty = true;
            console.log(`[upstream] ✓ "${source.name}" 检测到更新: 词库 v${prev.versions?.dict || '?'} → v${versions.dict},buildNumber → ${state.buildNumber}`);
        }
    }

    // 锚定本地快照的实际哈希:首次启用本校验时补记(不误报为漂移),
    // 上游更新写入新内容后同步刷新,保证记录始终等于磁盘上的真实快照
    const after = anchorable(snapshotDigests(projectRoot, snapshotLocals));
    const recorded = state.snapshotHashes || {};
    if (Object.entries(after).some(([local, digest]) => recorded[local] !== digest)) {
        state.snapshotHashes = { ...recorded, ...after };
        stateDirty = true;
        console.log('[upstream] 已锚定本地快照哈希:', JSON.stringify(state.snapshotHashes));
    }

    if (stateDirty) saveState(state);
    process.exitCode = anyChanged ? EXIT_UPDATED : EXIT_OK;
}

/**
 * 仅在直接执行本脚本时运行 main(node scripts/check-upstream.mjs)。
 * 被测试文件 import 时绝不触发网络请求——此前 main() 在模块顶层无条件执行,
 * 任何针对本文件的单元测试都会变成一次真实的上游拉取。
 */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((e) => {
        if (e && e.unexpected) {
            // 本仓库自身状态异常(状态文件缺失/损坏等):以非 0/10 退出码失败,
            // 工作流据此变红报警——这类问题静默放过会导致版本号倒退或词库停更无人察觉
            console.error('[upstream] ✗ 本仓库状态异常,需要人工介入:', e.message);
            process.exit(EXIT_UNEXPECTED);
        }
        // 网络异常等环境性错误:保持快照不动,由下次调度重试,不视为失败
        console.error('[upstream] 检查过程发生网络异常(不影响现有构建):', e);
        process.exit(EXIT_OK);
    });
}

export {
    extractDictVersion,
    sha256,
    parseStateText,
    UnexpectedError,
    candidateSources,
    snapshotDigests,
    detectSnapshotDrift,
};
