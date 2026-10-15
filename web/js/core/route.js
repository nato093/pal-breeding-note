import { pairKey } from './pair.js';

function compareId(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function palComparator(palOrder) {
  return (a, b) => (palOrder.get(a) ?? Infinity) - (palOrder.get(b) ?? Infinity) || compareId(a, b);
}

export function buildCarrierGraph(index) {
  const adjacency = new Map();
  const addEdge = (from, to, partner, record) => {
    if (!adjacency.has(from)) adjacency.set(from, new Map());
    if (!adjacency.has(to)) adjacency.set(to, new Map());
    if (from === to) return;
    const outgoing = adjacency.get(from);
    if (!outgoing.has(to)) outgoing.set(to, []);
    outgoing.get(to).push({ partner, record });
  };
  for (const record of index.records) {
    addEdge(record.parent1Id, record.childId, record.parent2Id, record);
    if (record.parent1Id !== record.parent2Id) {
      addEdge(record.parent2Id, record.childId, record.parent1Id, record);
    }
  }
  const comparePal = palComparator(index.palOrder);
  const graph = new Map();
  for (const from of [...adjacency.keys()].sort(comparePal)) {
    const outgoing = adjacency.get(from);
    const edges = new Map();
    for (const to of [...outgoing.keys()].sort(comparePal)) {
      const options = outgoing.get(to).sort((a, b) => comparePal(a.partner, b.partner)
        || compareId(a.record.id, b.record.id));
      edges.set(to, options);
    }
    graph.set(from, edges);
  }
  return graph;
}

// graph → (目標 → 回数の表)。graph は記録が変わったときだけ作り直されるので、同じ graph と目標では使い回す
const distanceCache = new WeakMap();

/**
 * 各パルから目標までの最短の配合の回数（登録済みの記録で作った graph を逆向きにたどる）。目標は 0、
 * 目標が直接産まれる親は 1。届かないパルは入らない。
 * @returns {Map<string, number>}
 */
export function distancesTo(graph, target) {
  let byTarget = distanceCache.get(graph);
  if (!byTarget) distanceCache.set(graph, byTarget = new Map());
  const cached = byTarget.get(target);
  if (cached) return cached;
  const parents = new Map();
  for (const [from, edges] of graph) {
    for (const [to, options] of edges) {
      if (!options.length) continue;
      if (!parents.has(to)) parents.set(to, []);
      parents.get(to).push(from);
    }
  }
  const distances = new Map([[target, 0]]);
  const queue = [target];
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head];
    for (const parent of parents.get(current) ?? []) {
      if (distances.has(parent)) continue;
      distances.set(parent, distances.get(current) + 1);
      queue.push(parent);
    }
  }
  byTarget.set(target, distances);
  return distances;
}

function breadthFirstNodes(graph, from, to, blockedNodes = new Set(), blockedEdges = new Map()) {
  if (blockedNodes.has(from) || blockedNodes.has(to)) return null;
  if (from === to) return [from];
  const queue = [from];
  const previous = new Map([[from, null]]);
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head];
    for (const [next, options] of graph.get(current) ?? []) {
      if (!options.length || previous.has(next) || blockedNodes.has(next)
        || blockedEdges.get(current)?.has(next)) continue;
      previous.set(next, current);
      if (next === to) {
        const nodes = [to];
        while (nodes.at(-1) !== from) nodes.push(previous.get(nodes.at(-1)));
        return nodes.reverse();
      }
      queue.push(next);
    }
  }
  return null;
}

function routeFromNodes(graph, nodes) {
  return {
    length: nodes.length - 1,
    nodes,
    steps: nodes.slice(1).map((to, position) => ({
      from: nodes[position], to, options: graph.get(nodes[position]).get(to),
    })),
  };
}

export function shortestRoute(graph, from, to) {
  const nodes = breadthFirstNodes(graph, from, to);
  return nodes ? routeFromNodes(graph, nodes) : null;
}

function sharesPrefix(nodes, prefix) {
  return prefix.every((node, position) => nodes[position] === node);
}

function comparePaths(a, b, comparePal) {
  if (a.length !== b.length) return a.length - b.length;
  for (let i = 0; i < a.length; i++) {
    const compared = comparePal(a[i], b[i]);
    if (compared) return compared;
  }
  return 0;
}

// 各手順に、相手の候補のどれかで同じ組み合わせから別の子も登録されているか（multiChild）と、その最初の相手（multiPartner。
// 画面の「同じ組で別の子も登録あり」から、その組の配合を探す）を足す
function addStepDetails(route, index) {
  return {
    ...route,
    steps: route.steps.map((step) => {
      const multi = step.options.find(({ partner }) => {
        const records = index.byPair.get(pairKey(step.from, partner)) ?? [];
        return new Set(records.map((record) => record.childId)).size > 1;
      });
      return { ...step, multiChild: Boolean(multi), multiPartner: multi?.partner ?? '' };
    }),
  };
}

export function findRoutes(graph, index, from, to, { k = 5, slack = 3 } = {}) {
  if (!Number.isFinite(k) || k < 1 || !Number.isFinite(slack) || slack < 0) return { routes: [] };
  const limit = Math.floor(k);
  const first = breadthFirstNodes(graph, from, to);
  if (!first) return { routes: [] };
  const maxLength = first.length - 1 + Math.floor(slack);
  const accepted = [first];
  const pathKey = (nodes) => JSON.stringify(nodes);
  const seen = new Set([pathKey(first)]);
  const candidates = new Map();
  const comparePal = palComparator(index.palOrder);
  while (accepted.length < limit) {
    const previous = accepted.at(-1);
    for (let position = 0; position < previous.length - 1; position++) {
      const root = previous.slice(0, position + 1);
      const blockedEdges = new Map();
      for (const path of accepted) {
        if (!sharesPrefix(path, root) || path.length <= position + 1) continue;
        const spur = path[position];
        if (!blockedEdges.has(spur)) blockedEdges.set(spur, new Set());
        blockedEdges.get(spur).add(path[position + 1]);
      }
      // 根の手前を再訪させず、分岐点からの BFS でも単純路を保つ。
      const tail = breadthFirstNodes(graph, root.at(-1), to, new Set(root.slice(0, -1)), blockedEdges);
      if (!tail) continue;
      const nodes = [...root.slice(0, -1), ...tail];
      const key = pathKey(nodes);
      if (nodes.length - 1 > maxLength || seen.has(key)) continue;
      candidates.set(key, nodes);
      seen.add(key);
    }
    if (!candidates.size) break;
    // 過去の分岐候補も保持し、全候補の最短を選ぶのが Yen 法の要点。
    const next = [...candidates.values()].sort((a, b) => comparePaths(a, b, comparePal))[0];
    candidates.delete(pathKey(next));
    accepted.push(next);
  }
  return { routes: accepted.map((nodes) => addStepDetails(routeFromNodes(graph, nodes), index)) };
}
