// 接続診断: 本番構成（GitHub Pages → GAS → Sheets）で CORS・CSP・書き込みの挙動を実ブラウザで確かめる。
import { API_URL } from './config.js';

const cspViolations = [];
document.addEventListener('securitypolicyviolation', (e) => {
  cspViolations.push(`${e.violatedDirective} ${e.blockedURI}`);
});

async function call(passcode, action, payload = {}) {
  const res = await fetch(API_URL, {
    method: 'POST',
    // 文字列の body は text/plain になり、プリフライトが発生しない
    body: JSON.stringify({ ...payload, action, passcode }),
    credentials: 'omit',
    redirect: 'follow',
  });
  return JSON.parse(await res.text());
}

async function timed(fn) {
  const t0 = performance.now();
  const value = await fn();
  return { value, ms: Math.round(performance.now() - t0) };
}

function addRow(tbody, name, ok, detail) {
  const tr = document.createElement('tr');
  const tdName = document.createElement('td');
  tdName.textContent = name;
  const tdOk = document.createElement('td');
  tdOk.textContent = ok ? 'OK' : 'NG';
  tdOk.className = ok ? 'ok' : 'ng';
  const tdDetail = document.createElement('td');
  tdDetail.textContent = typeof detail === 'string' ? detail : JSON.stringify(detail);
  tr.append(tdName, tdOk, tdDetail);
  tbody.append(tr);
  return ok;
}

const FORMULA_CASES = [
  { text: '=1+1', mode: 'raw' },
  { text: '=1+1', mode: 'quoted' },
  { text: '+81-90', mode: 'raw' },
  { text: '-なし', mode: 'raw' },
  { text: '@メモ', mode: 'raw' },
  { text: '普通のメモ', mode: 'raw' },
];

async function run(passcode) {
  const tbody = document.querySelector('#results tbody');
  tbody.replaceChildren();
  const results = [];
  const step = async (name, fn) => {
    try {
      const [ok, detail] = await fn();
      results.push(addRow(tbody, name, ok, detail));
    } catch (err) {
      results.push(addRow(tbody, name, false, `${err.name}: ${err.message}`));
    }
  };

  await step('API URL の設定', async () => [Boolean(API_URL), API_URL ? 'あり' : 'config.js が空']);
  await step('ping（CORS・302 リダイレクト）', async () => {
    const { value, ms } = await timed(() => call(passcode, 'ping'));
    return [value.ok === true && value.env === 'test', { ms, ...value }];
  });
  await step('誤ったパスワードは拒否', async () => {
    const value = await call('WRONG-CODE', 'ping');
    return [value.ok === false && value.code === 'AUTH', value];
  });
  await step('全件取得（応答時間）', async () => {
    const { value, ms } = await timed(() => call(passcode, 'snapshot'));
    return [value.ok === true, { ms, count: value.records ? value.records.length : null, code: value.code }];
  });
  await step('診断シートの初期化', async () => {
    const value = await call(passcode, 'probeReset');
    return [value.ok === true, value];
  });
  for (const c of FORMULA_CASES) {
    await step(`書き込み: ${c.text}（${c.mode}）`, async () => {
      const value = await call(passcode, 'probe', { ...c, tag: 'formula' });
      // 数式として解釈されず、文字として残っていれば合格
      const ok = value.ok === true && value.formula === '';
      return [ok, { stored: value.stored, display: value.display, formula: value.formula }];
    });
  }
  await step('並列 5 件の書き込み（取りこぼし・重複なし）', async () => {
    const tag = `burst-${Date.now()}`;
    const { value: all, ms } = await timed(() =>
      Promise.all([1, 2, 3, 4, 5].map((n) => call(passcode, 'probe', { text: `burst ${n}`, tag }))),
    );
    const stats = await call(passcode, 'probeStats', { tag });
    const rows = all.map((r) => r.row);
    const unique = new Set(rows).size === 5;
    const codes = all.map((r) => (r.ok ? 'ok' : r.code));
    return [stats.count === 5 && unique && all.every((r) => r.ok), { ms, rows, codes, count: stats.count }];
  });
  await step('CSP 違反なし', async () => [cspViolations.length === 0, cspViolations.length ? cspViolations : 'なし']);

  const passed = results.filter(Boolean).length;
  document.getElementById('summary').textContent = `${passed} / ${results.length} 件 OK`;
}

document.getElementById('run').addEventListener('click', () => {
  const input = document.getElementById('passcode');
  run(input.value).catch((err) => {
    document.getElementById('summary').textContent = `診断が中断しました: ${err.message}`;
  });
});
