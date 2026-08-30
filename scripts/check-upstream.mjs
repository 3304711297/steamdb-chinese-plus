/**
 * 上游词库检查与同步
 *
 * 职责:
 *   1. 按 upstream.config.json 逐个尝试上游仓库(含镜像),拉取词库文件
 *   2. 与 upstream.state.json 中记录的哈希比对,判断是否有更新
 *   3. 有更新 → 覆盖 sources/ 下的本地快照,递增 buildNumber,记录新版本号
 *   4. 上游不可用(删除/断网/改名)→ 记录状态并正常退出,绝不改动本地快照
 *
 * 设计原则(与 openrouter-chinese-plus 同构):本仓库的 sources/ 是完整的 vendored
 * 快照,上游消失只影响"能否跟进新词库",不影响本项目继续构建、发布和维护。
 * 工作流因此永远不会因上游挂掉而变红。
 *
 * 退出码:0 = 无需处理(无更新或上游不可用);10 = 快照已更新,需要重新构建;
 *       20 = 本仓库自身状态异常(如 upstream.state.json 缺失/损坏)——绝不能静默,
 *       否则重算会从默认 buildNumber 起步、产物版本号倒退,脚本管理器将不再提示更新。
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

export { extractDictVersion, sha256, parseStateText, UnexpectedError, candidateSources };
