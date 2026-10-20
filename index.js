/**
 * dsh-our-free-model-composer-credits — 宿主半体。
 *
 * 本插件的全部可见行为都在 Client 半体（`client.js`，经 `dsh.client` 声明与
 * `exports["./client"]` 被 dsh-client-modules 发现并注入页面）。
 * 宿主半体只需是一个能被 Loader import 的合法模块：导出 name / inject / apply，
 * 否则 `EntryTree.import` 无法为该 entry 建 fiber，客户端 bundle 也就不会被扫描到。
 */
export const name = 'dsh-our-free-model-composer-credits';

export const inject = [];

export function apply() {}
