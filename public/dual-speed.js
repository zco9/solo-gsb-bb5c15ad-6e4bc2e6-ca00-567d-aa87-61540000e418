'use strict';

const MIN_GEARS = 4;
const MAX_GEARS = 12;

const gearRowsBox = document.getElementById('gear-rows');
const deviceRowsBox = document.getElementById('device-rows');
const form = document.getElementById('dual-form');
const formError = document.getElementById('form-error');
const resultPanel = document.getElementById('result-panel');
const resultSummary = document.getElementById('result-summary');
const resultBanner = document.getElementById('result-banner');
const planPanel = document.getElementById('plan-panel');
const fixedStageBox = document.getElementById('fixed-stage');
const deviceResults = document.getElementById('device-results');
const shaftTableBox = document.getElementById('shaft-table');

/* 示例：固定 G1(10)→G5(30)=1/3；一档 G3(15)→G8(60)=1/4，合计 1/12；
   二档换装中间轴轮为 G4(20)→G8(60)=1/3，合计 1/9；仅第二级主动轴位需更换 */
const EXAMPLE_GEARS = [
  { id: 'G1', teeth: 10 },
  { id: 'G2', teeth: 12 },
  { id: 'G3', teeth: 15 },
  { id: 'G4', teeth: 20 },
  { id: 'G5', teeth: 30 },
  { id: 'G6', teeth: 40 },
  { id: 'G7', teeth: 50 },
  { id: 'G8', teeth: 60 },
];

const EXAMPLE_DEVICES = [
  { name: '档位 1（低速）', target: '1/12', tolerance: '5%' },
  { name: '档位 2（高速）', target: '1/9', tolerance: '5%' },
];

function el(tag, className, html) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

/* ---------------- 齿轮清单编辑 ---------------- */

function addGearRow(id = '', teeth = '') {
  const row = el('div', 'gear-row');
  row.innerHTML = `
    <input class="gear-id-input" placeholder="如 G1" value="${id}" />
    <input class="gear-teeth-input" type="number" min="1" max="100000" step="1" placeholder="齿数" value="${teeth}" />
    <button type="button" class="btn danger-ghost" title="删除该齿轮">✕</button>
  `;
  row.querySelector('button').addEventListener('click', () => {
    if (gearRowsBox.children.length <= MIN_GEARS) {
      alert(`双档换速至少保留 ${MIN_GEARS} 枚齿轮`);
      return;
    }
    row.remove();
  });
  gearRowsBox.appendChild(row);
}

document.getElementById('btn-add-gear').addEventListener('click', () => {
  if (gearRowsBox.children.length >= MAX_GEARS) {
    alert(`最多 ${MAX_GEARS} 枚齿轮`);
    return;
  }
  addGearRow();
});

function collectGears() {
  const gears = [];
  const ids = new Set();
  for (const row of gearRowsBox.querySelectorAll('.gear-row')) {
    const id = row.querySelector('.gear-id-input').value.trim();
    const teethRaw = row.querySelector('.gear-teeth-input').value.trim();
    if (!id && !teethRaw) continue; // 空行忽略
    if (!id) throw new Error('存在未填写编号的齿轮行');
    if (ids.has(id)) throw new Error(`齿轮编号重复：${id}`);
    ids.add(id);
    const teeth = Number(teethRaw);
    if (!Number.isInteger(teeth) || teeth < 1) throw new Error(`齿轮 ${id} 的齿数需为正整数`);
    gears.push({ id, teeth });
  }
  if (gears.length < MIN_GEARS || gears.length > MAX_GEARS) {
    throw new Error(`双档换速需填写 ${MIN_GEARS}～${MAX_GEARS} 枚齿轮（当前 ${gears.length} 枚）`);
  }
  return gears;
}

/* ---------------- 档位（固定 2 档） ---------------- */

function addDeviceRow(name = '', target = '', tolerance = '') {
  const row = el('div', 'device-row');
  row.innerHTML = `
    <input class="device-name-input" placeholder="如 低速档（可空）" value="${name}" maxlength="30" />
    <input class="device-target-input" placeholder="目标速比，如 1/12" value="${target}" />
    <input class="device-tolerance-input" placeholder="容差，如 5%" value="${tolerance}" />
    <span></span>
  `;
  deviceRowsBox.appendChild(row);
}

function collectDevices() {
  const devices = [];
  for (const row of deviceRowsBox.querySelectorAll('.device-row')) {
    const name = row.querySelector('.device-name-input').value.trim();
    const target = row.querySelector('.device-target-input').value.trim();
    const tolerance = row.querySelector('.device-tolerance-input').value.trim();
    if (!target) throw new Error(`第 ${devices.length + 1} 档未填写目标输出转速比`);
    if (!tolerance) throw new Error(`第 ${devices.length + 1} 档未填写允许相对误差`);
    devices.push({ name, target, tolerance });
  }
  if (devices.length !== 2) throw new Error('双档换速固定针对 2 个档位');
  return devices;
}

document.getElementById('btn-example').addEventListener('click', () => {
  gearRowsBox.innerHTML = '';
  EXAMPLE_GEARS.forEach((g) => addGearRow(g.id, g.teeth));
  deviceRowsBox.innerHTML = '';
  EXAMPLE_DEVICES.forEach((d) => addDeviceRow(d.name, d.target, d.tolerance));
});

/* 初始：示例数据 */
EXAMPLE_GEARS.forEach((g) => addGearRow(g.id, g.teeth));
EXAMPLE_DEVICES.forEach((d) => addDeviceRow(d.name, d.target, d.tolerance));

/* ---------------- 结果渲染 ---------------- */

function renderPairsTable(solution) {
  const table = el('table', 'pairs');
  table.innerHTML = `
    <thead><tr>
      <th>级</th><th>主动轮（编号 / 齿数）</th><th>从动轮（编号 / 齿数）</th><th>本级速比（主动/从动）</th>
    </tr></thead>`;
  const tbody = el('tbody');
  solution.pairs.forEach((p, i) => {
    const tr = el('tr');
    tr.innerHTML = `
      <td>${i + 1}${i === 0 ? '（固定）' : '（换装）'}</td>
      <td><span class="gear-id">${p.drive.id}</span> · ${p.drive.teeth} 齿</td>
      <td><span class="gear-id">${p.driven.id}</span> · ${p.driven.teeth} 齿</td>
      <td class="frac">${p.stageRatio.num}/${p.stageRatio.den} ≈ ${p.stageRatio.decimal}</td>`;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  return table;
}

function renderDeviceCard(d, index) {
  const card = el('div', 'solution best');

  const head = el('div', 'solution-head');
  const title = el('span', 'solution-title');
  title.appendChild(el('span', 'badge badge-ok', '已达标'));
  title.appendChild(document.createTextNode(`${d.name}（第 ${index + 1} 档）`));
  head.appendChild(title);

  head.appendChild(el('span', 'solution-meta',
    `目标比 <strong class="frac">${d.target.num}/${d.target.den}</strong>` +
    ` ≈ <strong>${d.target.decimal}</strong>` +
    ` &nbsp;|&nbsp; 容差 <strong>${d.tolerance.decimal}</strong>`));
  card.appendChild(head);

  const s = d.solution;
  card.appendChild(el('div', 'solution-meta',
    `恰好 2 级传动 · 实际转速比 ` +
    `<strong class="frac">${s.ratio.num}/${s.ratio.den}</strong>` +
    ` ≈ <strong>${s.ratio.decimal}</strong>` +
    ` &nbsp;|&nbsp; 相对误差 <strong>${s.errorPercent}%</strong>`));
  card.appendChild(renderPairsTable(s));
  return card;
}

function gearChip(g, extraClass = '') {
  const chip = el('span', `chip ${extraClass}`.trim());
  chip.textContent = `${g.id} · ${g.teeth} 齿`;
  return chip;
}

function renderShaftTable(data) {
  const table = el('table', 'pairs');
  table.innerHTML = `
    <thead><tr>
      <th>轴位</th>
      <th>${data.devices[0].name}（第 1 档）</th>
      <th>${data.devices[1].name}（第 2 档）</th>
      <th>换档时是否更换</th>
    </tr></thead>`;
  const tbody = el('tbody');
  data.shafts.forEach((sh) => {
    const tr = el('tr');
    tr.innerHTML = `
      <td>${sh.label}</td>
      <td><span class="gear-id">${sh.gear1.id}</span> · ${sh.gear1.teeth} 齿</td>
      <td><span class="gear-id">${sh.gear2.id}</span> · ${sh.gear2.teeth} 齿</td>
      <td>${sh.changed ? '<strong style="color:var(--warn)">需更换</strong>' : '不更换'}</td>`;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  return table;
}

function showBanner(kind, text) {
  resultBanner.hidden = false;
  resultBanner.className = `alert ${kind}`;
  resultBanner.textContent = text;
}

form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  formError.hidden = true;
  resultPanel.hidden = true;

  let payload;
  try {
    payload = { gears: collectGears(), devices: collectDevices() };
  } catch (e) {
    formError.textContent = e.message;
    formError.hidden = false;
    return;
  }

  try {
    const resp = await fetch('/api/dual-speed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || '双档选配失败');

    resultPanel.hidden = false;
    deviceResults.innerHTML = '';
    fixedStageBox.innerHTML = '';
    shaftTableBox.innerHTML = '';
    resultBanner.hidden = true;

    if (!data.feasible) {
      planPanel.hidden = true;
      resultSummary.textContent =
        `第 1 档两级达标配对 ${data.devices[0].twoStageMatchCount} 条，` +
        `第 2 档 ${data.devices[1].twoStageMatchCount} 条`;
      showBanner('error', data.message);
      return;
    }

    planPanel.hidden = false;
    resultSummary.innerHTML =
      `共 ${data.candidateCount} 组共用固定第一级的达标装配 · ` +
      `需更换轴位 <strong>${data.replacementCount}</strong> 个 · ` +
      `两档相对误差之和 ${data.errorSum.decimal}（${data.errorSumPercent}%）`;

    fixedStageBox.appendChild(gearChip(data.fixedStage.drive, 'chip-buy'));
    fixedStageBox.appendChild(el('span', 'stage-arrow', '→'));
    fixedStageBox.appendChild(gearChip(data.fixedStage.driven, 'chip-buy'));
    fixedStageBox.appendChild(el('span', 'muted',
      `本级速比 ${data.fixedStage.stageRatio.num}/${data.fixedStage.stageRatio.den}` +
      ` ≈ ${data.fixedStage.stageRatio.decimal}`));

    data.devices.forEach((d, i) => deviceResults.appendChild(renderDeviceCard(d, i)));

    shaftTableBox.appendChild(renderShaftTable(data));

    showBanner('ok',
      `已按“换装轴位最少（${data.replacementCount} 个）→ 两档相对误差之和最小 → 齿轮编号自然序”` +
      '从全部达标装配中选出唯一方案：换档时只需按下表更换第二级对应轴位上的齿轮。');
  } catch (e) {
    resultPanel.hidden = false;
    planPanel.hidden = true;
    resultSummary.textContent = '';
    showBanner('error', `请求出错：${e.message}`);
  }
});
