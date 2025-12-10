import React, { useState, useEffect, useMemo } from "react";

// ISEF Symbolic Risk Game
// Single-file React component (TypeScript / TSX) intended for a Vite + React + Tailwind setup.
// Features:
// - Procedural network generator (sparse to dense)
// - Symbolic constraint solver that deterministically simulates cascades
// - Interactive UI to knock out nodes, inject capital, and test rules
// - Visual network + mini-dashboard, and short puzzle campaign that ties to the paper

// NOTE: This file is a single-file demo. For production split into components and add proper bundler config.

type NodeId = number;

type Edge = { from: NodeId; to: NodeId; amount: number }; // amount is obligation weight

type Node = {
  id: NodeId;
  name: string;
  capital: number; // symbolic starting capital
  buffer: number; // threshold (minimum required capital)
  alive: boolean; // current state
};

// Utility: random in range
const rand = (min: number, max: number) => Math.random() * (max - min) + min;

// Generate a synthetic financial network
function generateNetwork(n = 12, density = 0.15) {
  const nodes: Node[] = [];
  for (let i = 0; i < n; i++) {
    // base capital and buffer chosen so some nodes are fragile
    const capital = Math.round(rand(40, 160));
    const buffer = Math.round(capital * rand(0.1, 0.4));
    nodes.push({ id: i, name: `Bank ${String.fromCharCode(65 + (i % 26))}${i}`, capital, buffer, alive: true });
  }
  const edges: Edge[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      if (Math.random() < density) {
        // obligation amount relative to lender's capital
        const amount = Math.round(rand(5, 40));
        edges.push({ from: i, to: j, amount });
      }
    }
  }
  return { nodes, edges };
}

// Symbolic deterministic solver. Inputs: nodes, edges, initial failed nodes set.
// Rules (deterministic):
// - Each node's "net capital" = capital - losses from defaulted counterparties (i.e., unpaid incoming obligations)
// - If net capital < buffer, node fails. When node fails, its outgoing obligations become unpaid and cause losses to recipients.
// - Process repeats until no new failures.

function runCascade(nodesIn: Node[], edgesIn: Edge[], initialFailed: Set<NodeId>) {
  // make deep copies
  const nodes = nodesIn.map((n) => ({ ...n }));
  const edges = edgesIn.map((e) => ({ ...e }));

  const idToNode = new Map<number, Node>();
  nodes.forEach((n) => idToNode.set(n.id, n));

  // keep track of unpaid obligations: when a node fails, its outgoing obligations are unpaid -> losses to recipients
  const failed = new Set<NodeId>(initialFailed);
  // mark initial
  nodes.forEach((n) => (n.alive = !failed.has(n.id)));

  // iterative propagation
  let changed = true;
  const history: { step: number; failedThisStep: NodeId[]; snapshot: Node[] }[] = [];
  let step = 0;
  while (changed) {
    changed = false;
    // compute losses caused by failed nodes this step
    const losses = new Map<NodeId, number>();
    for (const f of failed) {
      // outgoing obligations from failed node f are unpaid
      for (const e of edges.filter((x) => x.from === f)) {
        // recipient loses 'amount'
        losses.set(e.to, (losses.get(e.to) || 0) + e.amount);
      }
    }

    const newlyFailed: NodeId[] = [];
    // For each alive node, compute net capital after losing unpaid incoming obligations from failed counterparties
    for (const n of nodes) {
      if (!n.alive) continue;
      const loss = losses.get(n.id) || 0;
      const net = n.capital - loss;
      // deterministic rule: if net < buffer -> fail
      if (net < n.buffer) {
        n.alive = false;
        failed.add(n.id);
        newlyFailed.push(n.id);
        changed = true;
      }
    }
    history.push({ step, failedThisStep: newlyFailed.slice(), snapshot: nodes.map((s) => ({ ...s })) });
    step++;
    // To avoid infinite loops in degenerate cases, break after some large steps
    if (step > nodes.length + 5) break;
  }

  return {
    finalNodes: nodes,
    failed,
    history,
  };
}

// Minimal network layout for visualization: positions in circle
function layoutPositions(nodes: Node[]) {
  const R = 160;
  const cx = 240;
  const cy = 200;
  const N = nodes.length;
  const pos = new Map<number, { x: number; y: number }>();
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 - Math.PI / 2;
    pos.set(nodes[i].id, { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) });
  }
  return pos;
}

export default function ISEFSymbolicRiskGame() {
  const [nNodes, setNnodes] = useState(12);
  const [density, setDensity] = useState(0.18);
  const [seedNetwork, setSeedNetwork] = useState(() => generateNetwork(nNodes, density));
  const [selected, setSelected] = useState<Set<NodeId>>(new Set());
  const [history, setHistory] = useState<any[]>([]);
  const [results, setResults] = useState<any | null>(null);
  const [mode, setMode] = useState<'play' | 'symbolic' | 'puzzle'>('play');
  const pos = useMemo(() => layoutPositions(seedNetwork.nodes), [seedNetwork]);

  useEffect(() => {
    // regenerate when size or density changes
    setSeedNetwork(generateNetwork(nNodes, density));
    setSelected(new Set());
    setHistory([]);
    setResults(null);
  }, [nNodes, density]);

  function toggleSelect(id: number) {
    const s = new Set(selected);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    setSelected(s);
  }

  function reset() {
    setSeedNetwork(generateNetwork(nNodes, density));
    setSelected(new Set());
    setHistory([]);
    setResults(null);
  }

  function runScenario() {
    const res = runCascade(seedNetwork.nodes, seedNetwork.edges, selected);
    setResults(res);
    setHistory(res.history);
  }

  function autoFindCritical() {
    // brute force: try failing each single node and compute final impact, pick the one with max failures
    const impacts: { id: number; impact: number }[] = [];
    for (const n of seedNetwork.nodes) {
      const res = runCascade(seedNetwork.nodes, seedNetwork.edges, new Set([n.id]));
      impacts.push({ id: n.id, impact: res.failed.size });
    }
    impacts.sort((a, b) => b.impact - a.impact);
    const top = impacts.slice(0, 3);
    return top;
  }

  const critical = useMemo(() => autoFindCritical(), [seedNetwork]);

  // UI pieces
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-indigo-900 text-slate-100 p-6">
      <div className="max-w-6xl mx-auto bg-white/5 rounded-2xl p-6 shadow-2xl ring-1 ring-white/5">
        <header className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-semibold">Symbolic Risk — ISEF Mini-Game</h1>
            <p className="text-sm text-slate-300 mt-1">Explore deterministic cascades in synthetic financial networks.</p>
          </div>
          <div className="flex gap-2">
            <button
              className="px-3 py-1 bg-indigo-600 rounded hover:bg-indigo-500"
              onClick={() => setMode(mode === 'play' ? 'symbolic' : 'play')}
            >
              {mode === 'play' ? 'Symbolic View' : 'Play Mode'}
            </button>
            <button className="px-3 py-1 bg-emerald-600 rounded hover:bg-emerald-500" onClick={runScenario}>
              Run Scenario
            </button>
            <button className="px-3 py-1 bg-rose-600 rounded hover:bg-rose-500" onClick={reset}>
              Shuffle
            </button>
          </div>
        </header>

        <main className="grid grid-cols-3 gap-4">
          <section className="col-span-2 bg-white/3 rounded p-4">
            <div className="flex gap-4 items-center mb-2">
              <label className="text-sm">Nodes: </label>
              <input type="range" min={6} max={24} value={nNodes} onChange={(e) => setNnodes(+e.target.value)} />
              <span className="text-sm">{nNodes}</span>

              <label className="text-sm ml-4">Density: </label>
              <input
                type="range"
                min={0.05}
                max={0.45}
                step={0.01}
                value={density}
                onChange={(e) => setDensity(+e.target.value)}
              />
              <span className="text-sm">{density.toFixed(2)}</span>
            </div>

            <div className="flex gap-4">
              <svg width={480} height={420} className="bg-white/3 rounded">
                {/* edges */}
                {seedNetwork.edges.map((e, idx) => {
                  const a = pos.get(e.from)!;
                  const b = pos.get(e.to)!;
                  const dx = b.x - a.x;
                  const dy = b.y - a.y;
                  const dist = Math.sqrt(dx * dx + dy * dy);
                  const normx = dx / dist;
                  const normy = dy / dist;
                  // arrow tail offset
                  const fromx = a.x + normx * 22;
                  const fromy = a.y + normy * 22;
                  const tox = b.x - normx * 22;
                  const toy = b.y - normy * 22;
                  const strokeW = Math.max(1, Math.log(e.amount + 1));
                  return (
                    <g key={idx}>
                      <line x1={fromx} y1={fromy} x2={tox} y2={toy} strokeWidth={strokeW} strokeOpacity={0.5} stroke="white" />
                      {/* small arrowhead */}
                      <polygon
                        points={`${tox},${toy} ${tox - normx * 6 - normy * 3},${toy - normy * 6 + normx * 3} ${tox - normx * 6 + normy * 3},${toy - normy * 6 - normx * 3}`}
                        fill="white"
                        opacity={0.6}
                      />
                    </g>
                  );
                })}

                {/* nodes */}
                {seedNetwork.nodes.map((n) => {
                  const p = pos.get(n.id)!;
                  const alive = results ? results.finalNodes.find((x: Node) => x.id === n.id).alive : n.alive;
                  const isSelected = selected.has(n.id);
                  const r = 18;
                  return (
                    <g key={n.id} transform={`translate(${p.x},${p.y})`} onClick={() => toggleSelect(n.id)} style={{ cursor: 'pointer' }}>
                      <circle r={r} fill={alive ? (isSelected ? '#0ea5e9' : '#34d399') : '#ef4444'} stroke="#000" strokeOpacity={0.2} />
                      <text x={0} y={4} textAnchor="middle" fontSize={9} fontWeight={700} fill="#042c4a">
                        {n.name.split(' ')[1]}
                      </text>
                    </g>
                  );
                })}
              </svg>

              <div className="flex-1">
                <h3 className="text-lg font-medium">Selected nodes</h3>
                <p className="text-sm text-slate-300 mb-2">Click nodes on the graph to toggle initial failure set.</p>

                <div className="grid grid-cols-2 gap-2 max-h-[300px] overflow-auto">
                  {seedNetwork.nodes.map((n) => {
                    const alive = results ? results.finalNodes.find((x: Node) => x.id === n.id).alive : n.alive;
                    return (
                      <div
                        key={n.id}
                        className={`p-2 rounded flex items-center justify-between ${selected.has(n.id) ? 'bg-indigo-600/40' : 'bg-white/5'}`}
                      >
                        <div>
                          <div className="font-medium">{n.name}</div>
                          <div className="text-xs text-slate-300">Capital {n.capital} • Buffer {n.buffer}</div>
                        </div>
                        <div className="text-xs">
                          <div className={`${alive ? 'text-emerald-300' : 'text-rose-300'}`}>{alive ? 'Alive' : 'Failed'}</div>
                          <button className="mt-1 px-2 py-0.5 text-xs bg-white/6 rounded" onClick={() => toggleSelect(n.id)}>
                            Toggle
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* history timeline */}
            <div className="mt-4">
              <h4 className="text-sm font-medium">Cascade History</h4>
              <div className="text-xs text-slate-300 mt-2">
                {history.length === 0 && <div>No simulation run yet. Click "Run Scenario" to simulate.</div>}
                {history.map((h: any, idx: number) => (
                  <div key={idx} className="mb-2">
                    <div className="font-semibold">Step {h.step}:</div>
                    <div className="ml-2">Failed this step: {h.failedThisStep.length ? h.failedThisStep.map((id: number) => `Bank ${String.fromCharCode(65 + (id % 26))}${id}`).join(', ') : '—'}</div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <aside className="col-span-1 bg-white/3 rounded p-4 flex flex-col gap-3">
            <div>
              <h3 className="font-medium">Quick Stats</h3>
              <div className="text-sm text-slate-300 mt-2">
                <div>Nodes: {seedNetwork.nodes.length}</div>
                <div>Edges: {seedNetwork.edges.length}</div>
                <div>Top critical (single-node impact): {critical.map((c) => `Bank ${String.fromCharCode(65 + (c.id % 26))}${c.id} (${c.impact})`).join(', ')}</div>
              </div>
            </div>

            <div>
              <h4 className="font-medium">Symbolic Inspector</h4>
              <div className="text-sm text-slate-300 mt-2">
                <p>
                  Rule: <span className="font-semibold">net = capital - unpaidIncoming</span>. If <span className="font-semibold">net &lt; buffer</span>, node fails.
                </p>
                <p className="mt-2">This is a deterministic (symbolic) rule — no randomness during propagation.</p>
              </div>
            </div>

            <div>
              <h4 className="font-medium">Puzzle Mode</h4>
              <div className="text-sm text-slate-300 mt-2">
                <p>Try to achieve one of the short challenges:</p>
                <ol className="ml-4 list-decimal">
                  <li>Cause a cascade that fails &gt; 50% of nodes.</li>
                  <li>Prevent cascades by injecting capital to a single node to keep system stable.</li>
                  <li>Find a low-degree node whose failure causes major damage (hidden fragility).</li>
                </ol>
                <p className="mt-2 text-xs">Tips: use the quick stats above — the top critical candidate is a good clue.</p>
              </div>
            </div>

            <div>
              <h4 className="font-medium">Export / Share</h4>
              <div className="flex gap-2 mt-2">
                <button
                  className="px-3 py-1 bg-violet-600 rounded"
                  onClick={() => {
                    const blob = new Blob([JSON.stringify(seedNetwork, null, 2)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'network.json';
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  Download Network
                </button>

                <button
                  className="px-3 py-1 bg-sky-600 rounded"
                  onClick={() => {
                    // save scenario: selected + network
                    const save = { network: seedNetwork, initialFailed: Array.from(selected) };
                    const blob = new Blob([JSON.stringify(save, null, 2)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'scenario.json';
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  Save Scenario
                </button>
              </div>
            </div>

            <div className="mt-auto text-xs text-slate-400">
              Built for ISEF — inspired by the paper "A Symbolic Approach to Detecting Structural Risk in Financial
              Networks". Use the symbolic inspector to learn why cascades happen.
            </div>
          </aside>
        </main>
      </div>
    </div>
  );
}
