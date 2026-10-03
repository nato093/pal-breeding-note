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

function filterPartners(graph, excludePartners) {
  const excluded = new Set(excludePartners ?? []);
  if (!excluded.size) return graph;
  const filtered = new Map();
  for (const [from, outgoing] of graph) {
    const edges = new Map();
    for (const [to, options] of outgoing) {
      const available = options.filter((option) => !excluded.has(option.partner));
      if (available.length) edges.set(to, available);
    }
    filtered.set(from, edges);
  }
  return filtered;
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

export function shortestRoute(graph, from, to, { excludePartners } = {}) {
  const available = filterPartners(graph, excludePartners);
  const nodes = breadthFirstNodes(available, from, to);
  return nodes ? routeFromNodes(available, nodes) : null;
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

function addStepDetails(route, index) {
  const comparePal = palComparator(index.palOrder);
  return {
    ...route,
    steps: route.steps.map((step) => {
      const representative = [...step.options].sort((a, b) => b.record.confirmCount - a.record.confirmCount
        || comparePal(a.partner, b.partner) || compareId(a.record.id, b.record.id))[0];
      const multiChild = step.options.some(({ partner }) => {
        const records = index.byPair.get(pairKey(step.from, partner)) ?? [];
        return new Set(records.map((record) => record.childId)).size > 1;
      });
      return { ...step, representative, multiChild };
    }),
  };
}

export function findRoutes(graph, index, from, to, { k = 5, slack = 3, excludePartners } = {}) {
  if (!Number.isFinite(k) || k < 1 || !Number.isFinite(slack) || slack < 0) return { routes: [] };
  const limit = Math.floor(k);
  const available = filterPartners(graph, excludePartners);
  const first = breadthFirstNodes(available, from, to);
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
      const tail = breadthFirstNodes(available, root.at(-1), to, new Set(root.slice(0, -1)), blockedEdges);
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
  return { routes: accepted.map((nodes) => addStepDetails(routeFromNodes(available, nodes), index)) };
}
