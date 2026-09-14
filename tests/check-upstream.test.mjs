/**
 * check-upstream.mjs 纯函数单元测试(node:test 内置运行器,零依赖)
 *
 * 运行:node --test tests/check-upstream.test.mjs
 *
 * 只测可导出的纯函数;主流程(main)在直接执行时才运行,
 * import 本模块不会发起任何网络请求。
 * 重点守护:parseStateText 拒绝缺失/损坏的状态文件——
 * 一旦静默回退到默认 buildNumber,产物版本号会倒退,脚本管理器将不再提示更新。
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
    extractDictVersion,
    sha256,
    parseStateText,
    UnexpectedError,
    candidateSources,
    detectSnapshotDrift,
    snapshotDigests,
} from '../scripts/check-upstream.mjs';

/** 在系统临时目录建一个只属于本测试的根目录,结束后自动清理 */
function withTempRoot(fn) {
    const root = mkdtempSync(join(tmpdir(), 'steamdb-drift-'));
    try {
        return fn(root);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}
describe('extractDictVersion(词库版本提取)', () => {
    test('从 SteamDB_CN.json 提取 DOC."更新时间" 字段', () => {
        assert.strictEqual(
            extractDictVersion('{"DOC":{"更新时间":"2026-1-21"},"STATIC":{"h1":{}}}'),
            '2026-1-21'
        );
    });

    test('非 JSON 内容返回 null(404 页面等脏数据不能当版本号)', () => {
        assert.strictEqual(extractDictVersion('<html>404</html>'), null);
    });

    test('DOC 缺失或更新时间为空返回 null', () => {
        assert.strictEqual(extractDictVersion('{"STATIC":{}}'), null);
        assert.strictEqual(extractDictVersion('{"DOC":{"更新时间":""}}'), null);
    });
});

describe('sha256', () => {
    test('与已知摘要一致', () => {
        assert.strictEqual(
            sha256('abc'),
            'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
        );
    });
});

describe('parseStateText(状态文件校验——防 buildNumber 倒退)', () => {
    test('合法状态通过校验', () => {
        const r = parseStateText(JSON.stringify({ buildNumber: 2, sources: { Chr_: {} } }));
        assert.strictEqual(r.ok, true);
        assert.strictEqual(r.state.buildNumber, 2);
    });

    test('损坏 JSON 被拒绝并给出原因', () => {
        const r = parseStateText('{broken json');
        assert.strictEqual(r.ok, false);
        assert.match(r.reason, /JSON 解析失败/);
    });

    test('buildNumber 缺失、为 0、非整数、为字符串一律拒绝', () => {
        for (const bad of [
            JSON.stringify({ sources: {} }),
            JSON.stringify({ buildNumber: 0, sources: {} }),
            JSON.stringify({ buildNumber: '2', sources: {} }),
            JSON.stringify({ buildNumber: 1.5, sources: {} }),
        ]) {
            assert.strictEqual(parseStateText(bad).ok, false, `应拒绝: ${bad}`);
        }
    });

    test('sources 缺失或类型非法被拒绝', () => {
        assert.strictEqual(parseStateText(JSON.stringify({ buildNumber: 2 })).ok, false);
        assert.strictEqual(parseStateText(JSON.stringify({ buildNumber: 2, sources: [] })).ok, false);
    });

    test('顶层非对象(null/数组)被拒绝', () => {
        assert.strictEqual(parseStateText('null').ok, false);
        assert.strictEqual(parseStateText('[1,2]').ok, false);
    });

    test('snapshotHashes 缺失 → 合法(兼容旧状态文件,首次运行会自动锚定)', () => {
        assert.strictEqual(parseStateText(JSON.stringify({ buildNumber: 4, sources: {} })).ok, true);
    });

    test('snapshotHashes 格式非法 → 拒绝(漂移判据不能静默失效)', () => {
        for (const bad of [
            { buildNumber: 4, sources: {}, snapshotHashes: [] },
            { buildNumber: 4, sources: {}, snapshotHashes: 'abc' },
            { buildNumber: 4, sources: {}, snapshotHashes: null },
            { buildNumber: 4, sources: {}, snapshotHashes: { 'a.json': 'nothex' } },
            { buildNumber: 4, sources: {}, snapshotHashes: { 'a.json': 'e5b3' } },
            { buildNumber: 4, sources: {}, snapshotHashes: { 'a.json': 123 } },
        ]) {
            const r = parseStateText(JSON.stringify(bad));
            assert.strictEqual(r.ok, false, `应拒绝: ${JSON.stringify(bad)}`);
            assert.match(r.reason, /snapshotHashes/);
        }
    });

    test('snapshotHashes 合法(64 位小写十六进制)→ 通过', () => {
        const digest = 'e5b3065b1feaaabb48f5050dd4e1af007dc06baabc65ccf363ac52f24ac84523';
        const r = parseStateText(JSON.stringify({
            buildNumber: 4, sources: {}, snapshotHashes: { 'sources/steamdb-dict.json': digest },
        }));
        assert.strictEqual(r.ok, true);
    });
});

describe('candidateSources(上游容灾候选源顺序与整组语义)', () => {
    const source = {
        repo: 'Chr_/GM_Scripts',
        branch: 'master',
        cdn: [
            'https://cdn.jsdelivr.net/gh/{repo}@{branch}/{path}',
            'https://raw.chrxw.com/GM_Scripts/{branch}/{path}',
        ],
        mirrors: ['someone/fork'],
        files: [{ local: 'sources/steamdb-dict.json', remote: 'SteamDB/SteamDB_CN.json' }],
    };
    const file = source.files[0];

    test('顺序:主仓库 raw → 各 cdn 模板 → 镜像仓库 raw,占位符正确展开', () => {
        const [primary, jsd, chrxw, mirror] = candidateSources(source);
        assert.strictEqual(primary.label, 'Chr_/GM_Scripts');
        assert.strictEqual(
            primary.url(file.remote),
            'https://raw.githubusercontent.com/Chr_/GM_Scripts/master/SteamDB/SteamDB_CN.json'
        );
        assert.strictEqual(jsd.label, 'Chr_/GM_Scripts(cdn:cdn.jsdelivr.net)');
        assert.strictEqual(
            jsd.url(file.remote),
            'https://cdn.jsdelivr.net/gh/Chr_/GM_Scripts@master/SteamDB/SteamDB_CN.json'
        );
        assert.strictEqual(chrxw.label, 'Chr_/GM_Scripts(cdn:raw.chrxw.com)');
        assert.strictEqual(
            chrxw.url(file.remote),
            'https://raw.chrxw.com/GM_Scripts/master/SteamDB/SteamDB_CN.json'
        );
        assert.strictEqual(mirror.label, 'someone/fork');
        assert.strictEqual(
            mirror.url(file.remote),
            'https://raw.githubusercontent.com/someone/fork/master/SteamDB/SteamDB_CN.json'
        );
    });

    test('cdn 为单个字符串时兼容', () => {
        const single = { repo: 'a/b', branch: 'main', cdn: 'https://cdn.example/{path}' };
        const [, only] = candidateSources(single);
        assert.strictEqual(only.label, 'a/b(cdn:cdn.example)');
        assert.strictEqual(only.url('x.json'), 'https://cdn.example/x.json');
    });

    test('未配置 cdn/mirrors 时只有主仓库一个候选源', () => {
        const minimal = { repo: 'a/b', branch: 'main' };
        assert.strictEqual(candidateSources(minimal).length, 1);
    });
});

describe('UnexpectedError(仓库自身异常的分类标记)', () => {
    test('带 unexpected 标记,供退出码分流为失败', () => {
        const e = new UnexpectedError('状态文件损坏');
        assert.strictEqual(e.unexpected, true);
        assert.strictEqual(e.name, 'UnexpectedError');
    });
});

describe('detectSnapshotDrift(本地快照哈希漂移——防人工改动被静默丢弃)', () => {
    const local = 'sources/steamdb-dict.json';
    const upstreamHash = 'e5b3065b1feaaabb48f5050dd4e1af007dc06baabc65ccf363ac52f24ac84523';
    const cleanedHash = '6f7f767f78fdaca886c1aaa1771b214e30f703c39232a90ce139aa156701de9d';

    test('实际哈希与记录一致 → 不漂移(日常无漂移路径必须零告警)', () => {
        const r = detectSnapshotDrift({ snapshotHashes: { [local]: upstreamHash } },
                                      { [local]: upstreamHash });
        assert.strictEqual(r.drifted, false);
        assert.deepStrictEqual(r.mismatches, []);
    });

    test('本地快照被改动 → 判定漂移并同时给出记录值与实际值', () => {
        const r = detectSnapshotDrift({ snapshotHashes: { [local]: upstreamHash } },
                                      { [local]: cleanedHash });
        assert.strictEqual(r.drifted, true);
        assert.strictEqual(r.mismatches.length, 1);
        assert.strictEqual(r.mismatches[0].local, local);
        assert.strictEqual(r.mismatches[0].recorded, upstreamHash);
        assert.strictEqual(r.mismatches[0].actual, cleanedHash);
    });

    test('快照文件缺失(实际值 null)也算漂移,不能因"读不到"就放过', () => {
        const r = detectSnapshotDrift({ snapshotHashes: { [local]: upstreamHash } },
                                      { [local]: null });
        assert.strictEqual(r.drifted, true);
        assert.strictEqual(r.mismatches.length, 1);
    });

    test('首次运行尚未记录(snapshotHashes 缺失)→ 不算漂移,标记为待锚定', () => {
        const r = detectSnapshotDrift({}, { [local]: cleanedHash });
        assert.strictEqual(r.drifted, false);
        assert.strictEqual(r.unrecorded, true);
    });

    test('记录中缺失某个文件时该文件按待锚定处理,不影响其它文件的比对', () => {
        const r = detectSnapshotDrift(
            { snapshotHashes: { [local]: upstreamHash } },
            { [local]: upstreamHash, 'sources/other.json': cleanedHash }
        );
        assert.strictEqual(r.drifted, false);
    });
});

describe('snapshotDigests(读取本地快照文件的实际 sha256)', () => {
    test('与实际内容一致,文件缺失记为 null 而非抛错', () => {
        withTempRoot((root) => {
            writeFileSync(join(root, 'a.json'), '{"x":1}', 'utf8');
            const d = snapshotDigests(root, ['a.json', 'missing.json']);
            assert.strictEqual(d['a.json'], sha256('{"x":1}'));
            assert.strictEqual(d['missing.json'], null);
        });
    });

    test('支持带目录的相对路径(与 config 中 files[].local 同形)', () => {
        withTempRoot((root) => {
            mkdirSync(join(root, 'sources'), { recursive: true });
            writeFileSync(join(root, 'sources/steamdb-dict.json'), 'ABC', 'utf8');
            const d = snapshotDigests(root, ['sources/steamdb-dict.json']);
            assert.strictEqual(d['sources/steamdb-dict.json'], sha256('ABC'));
        });
    });
});

describe('端到端:快照漂移必须以退出码 20 中断(先于任何网络请求)', () => {
    const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

    /** 把脚本与配置复制到一次性临时仓库,避免测试改动真实仓库 */
    function stageRepo(root, snapshotHashes) {
        cpSync(join(repoRoot, 'scripts'), join(root, 'scripts'), { recursive: true });
        cpSync(join(repoRoot, 'sources'), join(root, 'sources'), { recursive: true });
        cpSync(join(repoRoot, 'upstream.config.json'), join(root, 'upstream.config.json'));
        writeFileSync(join(root, 'upstream.state.json'), JSON.stringify({
            buildNumber: 4,
            sources: { Chr_: { status: 'unchanged' } },
            snapshotHashes,
        }, null, 2) + '\n', 'utf8');
    }

    function runScript(root) {
        return spawnSync(process.execPath, ['scripts/check-upstream.mjs'],
            { cwd: root, encoding: 'utf8' });
    }

    test('快照被改动一个字节 → 退出码 20,stderr 指明不一致的文件', () => {
        const root = mkdtempSync(join(tmpdir(), 'steamdb-drift-e2e-'));
        try {
            // 记录值与真实快照不符:模拟"人工清理了快照但没回写 state"
            stageRepo(root, { 'sources/steamdb-dict.json': sha256('上游原文(已不再是本地内容)') });
            const r = runScript(root);
            assert.strictEqual(r.status, 20, `应退出 20,实际 ${r.status}; stderr=${r.stderr}`);
            assert.match(r.stderr, /snapshotHashes/);
            assert.match(r.stderr, /sources\/steamdb-dict\.json/);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('记录值与真实快照一致 → 不因漂移校验中断(退出码不是 20)', () => {
        withTempRoot((root) => {
            stageRepo(root, {}); // 未记录 → 按"待锚定"处理,不误报
            writeFileSync(join(root, 'upstream.config.json'), JSON.stringify({
                sources: [{
                    name: 'Chr_', repo: 'invalid.invalid/nowhere', branch: 'main',
                    cdn: ['https://invalid.invalid/{repo}/{branch}/{path}'],
                    files: [{ local: 'sources/steamdb-dict.json', remote: 'x.json' }],
                }],
            }), 'utf8');
            const r = runScript(root);
            assert.notStrictEqual(r.status, 20, `漂移校验不应在此中断; stderr=${r.stderr}`);
        });
    });
});
