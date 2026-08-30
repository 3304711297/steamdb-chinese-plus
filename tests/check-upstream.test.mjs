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
import {
    extractDictVersion,
    sha256,
    parseStateText,
    UnexpectedError,
    candidateSources,
} from '../scripts/check-upstream.mjs';

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
