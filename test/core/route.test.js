import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex, findByPair, findByChild, findByParent } from '../../web/js/core/index.js';
import { buildCarrierGraph, shortestRoute, findRoutes } from '../../web/js/core/route.js';

const pals = ['A', 'B', 'C', 'D', 'E', 'F', 'X', 'Y', 'Z'].map((id, no) => ({ id, no, variant: false }));
const rec = (id, parent1Id, parent2Id, childId, confirmCount = 1) => ({ id, parent1Id, parent2Id, childId, confirmCount });
const setup = (records, master = pals) => {
  const index = buildIndex(records, master);
  return { index, graph: buildCarrierGraph(index) };
};
const nodesOf = (result) => result.routes.map((route) => route.nodes);

test('グラフ: A×A は 1 候補だけ作り、同じ from→to をまとめる', () => {
  const aa = rec('aa', 'A', 'A', 'B');
  const ax = rec('ax', 'A', 'X', 'B');
  const { index, graph } = setup([ax, aa]);
  assert.deepEqual([...graph.get('A').keys()], ['B']);
  assert.deepEqual(graph.get('A').get('B'), [{ partner: 'A', record: aa }, { partner: 'X', record: ax }]);
  assert.deepEqual(graph.get('X').get('B'), [{ partner: 'A', record: ax }]);
  assert.deepEqual(nodesOf(findRoutes(graph, index, 'A', 'B')), [['A', 'B']]);
});

test('グラフ: キャリアの自己ループだけ除外し、もう一方の親からの辺を残す', () => {
  const { graph } = setup([rec('aa', 'A', 'A', 'A'), rec('ax', 'A', 'X', 'A')]);
  assert.equal(graph.get('A').size, 0);
  assert.deepEqual([...graph.get('X').keys()], ['A']);
  assert.equal(shortestRoute(graph, 'A', 'X'), null);
});

test('経路: A→B→C→A の循環で停止し、到達不能を返す', () => {
  const { index, graph } = setup([rec('ab', 'A', 'X', 'B'), rec('bc', 'B', 'X', 'C'), rec('ca', 'C', 'X', 'A')]);
  assert.deepEqual(shortestRoute(graph, 'A', 'C').nodes, ['A', 'B', 'C']);
  assert.deepEqual(nodesOf(findRoutes(graph, index, 'A', 'C')), [['A', 'B', 'C']]);
  assert.equal(shortestRoute(graph, 'A', 'D'), null);
  assert.deepEqual(findRoutes(graph, index, 'A', 'D'), { routes: [] });
});

test('経路: from===to は登録有無にかかわらず手数 0', () => {
  for (const records of [[], [rec('ab', 'A', 'X', 'B')]]) {
    const { index, graph } = setup(records);
    assert.deepEqual(shortestRoute(graph, 'A', 'A'), { length: 0, nodes: ['A'], steps: [] });
    assert.deepEqual(findRoutes(graph, index, 'A', 'A'), { routes: [{ length: 0, nodes: ['A'], steps: [] }] });
  }
});

test('INV-1: レコード 0 件なら異なるパル間の検索や経路は空', () => {
  const { index, graph } = setup([]);
  assert.equal(graph.size, 0);
  assert.deepEqual(findByPair(index, 'A', 'B'), []);
  assert.deepEqual(findByChild(index, 'C'), []);
  assert.deepEqual(findByParent(index, 'A'), []);
  assert.equal(shortestRoute(graph, 'A', 'C'), null);
  assert.deepEqual(findRoutes(graph, index, 'A', 'C'), { routes: [] });
});

test('経路: BFS と Yen は固定の手数上限を設けない', () => {
  const master = Array.from({ length: 81 }, (_, no) => ({ id: `P${no}`, no, variant: false }));
  master.push({ id: 'X', no: 81, variant: false });
  const records = Array.from({ length: 80 }, (_, no) => rec(`r${no}`, `P${no}`, 'X', `P${no + 1}`));
  const { index, graph } = setup(records, master);
  assert.equal(shortestRoute(graph, 'P0', 'P80').length, 80);
  assert.equal(findRoutes(graph, index, 'P0', 'P80').routes[0].length, 80);
});

test('経路: 最短＋slack の境界と k を守り、手数の昇順になる', () => {
  const records = [
    rec('ac', 'A', 'X', 'C'), rec('ab', 'A', 'X', 'B'), rec('bc', 'B', 'X', 'C'),
    rec('bd', 'B', 'X', 'D'), rec('dc', 'D', 'X', 'C'), rec('de', 'D', 'X', 'E'), rec('ec', 'E', 'X', 'C'),
    rec('ef', 'E', 'X', 'F'), rec('fc', 'F', 'X', 'C'),
  ];
  const { index, graph } = setup(records);
  assert.deepEqual(findRoutes(graph, index, 'A', 'C').routes.map((route) => route.length), [1, 2, 3, 4]);
  assert.deepEqual(findRoutes(graph, index, 'A', 'C', { slack: 0 }).routes.map((route) => route.length), [1]);
  assert.deepEqual(findRoutes(graph, index, 'A', 'C', { k: 2, slack: 10 }).routes.map((route) => route.length), [1, 2]);
  assert.deepEqual(findRoutes(graph, index, 'A', 'C', { k: 0 }), { routes: [] });
});

test('経路: レコード順とマスター順をシャッフルしても全候補と順序が一致する', () => {
  const records = [rec('ay', 'A', 'Y', 'B'), rec('ax', 'A', 'X', 'B'), rec('ac', 'A', 'X', 'C'), rec('bd', 'B', 'X', 'D'), rec('cd', 'C', 'X', 'D')];
  const reference = setup(records);
  const shuffled = setup([records[3], records[1], records[4], records[0], records[2]], [...pals].reverse());
  assert.deepEqual(reference.graph, shuffled.graph);
  assert.deepEqual(shortestRoute(reference.graph, 'A', 'D'), shortestRoute(shuffled.graph, 'A', 'D'));
  assert.deepEqual(findRoutes(reference.graph, reference.index, 'A', 'D'), findRoutes(shuffled.graph, shuffled.index, 'A', 'D'));
  assert.deepEqual(nodesOf(findRoutes(reference.graph, reference.index, 'A', 'D')), [['A', 'B', 'D'], ['A', 'C', 'D']]);
});

test('ステップ: 確認回数、相手順位、レコード ID の順で代表を選ぶ', () => {
  const records = [rec('z', 'A', 'X', 'B', 9), rec('a', 'A', 'X', 'B', 9), rec('y', 'A', 'Y', 'B', 9), rec('d', 'A', 'D', 'B', 1)];
  const { index, graph } = setup(records);
  const step = findRoutes(graph, index, 'A', 'B').routes[0].steps[0];
  assert.deepEqual(step.options.map((option) => option.record.id), ['d', 'a', 'z', 'y']);
  assert.equal(step.representative.record, records[1]);
  assert.equal(step.multiChild, false);
});

test('ステップ: どの相手候補でも同じペアに異なる子が登録されていれば multiChild', () => {
  const records = [rec('ax', 'A', 'X', 'B', 10), rec('ay', 'A', 'Y', 'B'), rec('ac', 'A', 'Y', 'C')];
  const { index, graph } = setup(records);
  const step = findRoutes(graph, index, 'A', 'B').routes[0].steps[0];
  assert.equal(step.representative.partner, 'X');
  assert.equal(step.multiChild, true);
  assert.equal(findRoutes(graph, index, 'A', 'B', { excludePartners: ['Y'] }).routes[0].steps[0].multiChild, false);
});

test('excludePartners: 候補を除外し、空の辺を使わず別ルートを探す', () => {
  const records = [rec('ab', 'A', 'X', 'B', 10), rec('ay', 'A', 'Y', 'B'), rec('bc', 'B', 'X', 'C'), rec('ad', 'A', 'Y', 'D'), rec('dc', 'D', 'Y', 'C')];
  const { index, graph } = setup(records);
  assert.deepEqual(shortestRoute(graph, 'A', 'C').nodes, ['A', 'B', 'C']);
  const options = { excludePartners: new Set(['X']) };
  assert.deepEqual(shortestRoute(graph, 'A', 'C', options).nodes, ['A', 'D', 'C']);
  const result = findRoutes(graph, index, 'A', 'C', options);
  assert.deepEqual(nodesOf(result), [['A', 'D', 'C']]);
  const direct = findRoutes(graph, index, 'A', 'B', options).routes[0].steps[0];
  assert.equal(direct.options.length, 1);
  assert.equal(direct.representative.partner, 'Y');
  assert.equal(shortestRoute(graph, 'A', 'C', { excludePartners: ['X', 'Y'] }), null);
  assert.deepEqual(findRoutes(graph, index, 'A', 'C', { excludePartners: ['X', 'Y'] }), { routes: [] });
  assert.equal(graph.get('A').get('B').length, 2);
});

test('INV-1: 経路の全ステップの全候補は入力レコードそのものを参照する', () => {
  const records = [rec('ab', 'A', 'X', 'B'), rec('ay', 'A', 'Y', 'B'), rec('ac', 'A', 'X', 'C'), rec('bc', 'B', 'X', 'C')];
  const { index, graph } = setup(records);
  const routes = [shortestRoute(graph, 'A', 'C'), ...findRoutes(graph, index, 'A', 'C').routes];
  for (const route of routes) {
    for (const step of route.steps) {
      for (const option of step.options) {
        assert.ok(records.includes(option.record));
        assert.equal(option.record.childId, step.to);
        assert.ok((option.record.parent1Id === step.from && option.record.parent2Id === option.partner)
          || (option.record.parent2Id === step.from && option.record.parent1Id === option.partner));
      }
    }
  }
});

function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function enumeratePaths(records, from, to, excluded, rank) {
  // 本実装のグラフを使わず、元レコードから総当たり用の辺を独立に作る。
  const adjacency = new Map();
  for (const record of records) {
    for (const [carrier, partner] of [[record.parent1Id, record.parent2Id], [record.parent2Id, record.parent1Id]]) {
      if (carrier === record.childId || excluded.has(partner)) continue;
      if (!adjacency.has(carrier)) adjacency.set(carrier, new Set());
      adjacency.get(carrier).add(record.childId);
    }
  }
  const paths = [];
  const visit = (nodes) => {
    const current = nodes.at(-1);
    if (current === to) {
      paths.push(nodes);
      return;
    }
    for (const next of adjacency.get(current) ?? []) {
      if (!nodes.includes(next)) visit([...nodes, next]);
    }
  };
  visit([from]);
  paths.sort((a, b) => {
    if (a.length !== b.length) return a.length - b.length;
    for (let i = 0; i < a.length; i++) {
      const difference = rank.get(a[i]) - rank.get(b[i]);
      if (difference) return difference;
    }
    return 0;
  });
  return paths;
}

test('ランダムグラフ: 固定シードの 200 ケースを全単純路と照合する', async (t) => {
  const random = createRandom(0x50414c33);
  for (let caseNo = 0; caseNo < 200; caseNo++) {
    await t.test(`ケース ${caseNo + 1}`, () => {
      const count = 6 + Math.floor(random() * 4);
      const master = Array.from({ length: count }, (_, no) => ({ id: `N${no}`, no, variant: false }));
      const ids = master.map((pal) => pal.id);
      const records = [];
      for (const from of ids) {
        for (const to of ids) {
          if (random() >= 0.2) continue;
          const partner = ids[Math.floor(random() * count)];
          records.push(rec(`r${records.length}`, from, partner, to, Math.floor(random() * 10)));
        }
      }
      const from = ids[Math.floor(random() * count)];
      const to = ids[Math.floor(random() * count)];
      const excluded = new Set(caseNo % 3 === 0 ? [ids[Math.floor(random() * count)]] : []);
      const { index, graph } = setup(records, master);
      const all = enumeratePaths(records, from, to, excluded, index.palOrder);
      const k = 1 + Math.floor(random() * 7);
      const slack = Math.floor(random() * 4);
      const options = { k, slack, excludePartners: excluded };
      const shortest = shortestRoute(graph, from, to, options);
      assert.equal(shortest?.length ?? null, all.length ? all[0].length - 1 : null);
      const result = findRoutes(graph, index, from, to, options);
      const expected = all.filter((nodes) => nodes.length <= all[0].length + slack).slice(0, k);
      assert.deepEqual(result.routes.map((route) => route.length), expected.map((nodes) => nodes.length - 1));
      assert.deepEqual(nodesOf(result), expected);
      assert.equal(new Set(result.routes.map((route) => JSON.stringify(route.nodes))).size, result.routes.length);
      for (const route of result.routes) {
        assert.equal(new Set(route.nodes).size, route.nodes.length);
        assert.equal(route.length, route.steps.length);
        assert.ok(route.length <= shortest.length + slack);
        for (const [position, step] of route.steps.entries()) {
          assert.equal(step.from, route.nodes[position]);
          assert.equal(step.to, route.nodes[position + 1]);
          assert.ok(step.options.includes(step.representative));
          assert.ok(step.options.length > 0);
          for (const option of step.options) {
            assert.ok(records.includes(option.record));
            assert.ok(!excluded.has(option.partner));
            assert.equal(option.record.childId, step.to);
            assert.ok((option.record.parent1Id === step.from && option.record.parent2Id === option.partner)
              || (option.record.parent2Id === step.from && option.record.parent1Id === option.partner));
          }
        }
      }
      const reversed = setup([...records].reverse(), [...master].reverse());
      assert.deepEqual(result, findRoutes(reversed.graph, reversed.index, from, to, options));
    });
  }
});
