'use strict';

const path = require('path');
const express = require('express');
const {
  search,
  parseTarget,
  parseTolerance,
  validateGears,
  MAX_STAGES,
} = require('./search');
const { planBatch } = require('./batch');
const {
  planProcure,
  validateBuyableGears,
  MIN_EXISTING,
  MAX_EXISTING,
  MAX_TOTAL_GEARS,
} = require('./procure');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '64kb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

/** 友好访问批量装配页：/batch → /batch.html */
app.get('/batch', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'batch.html'));
});

/** 友好访问缺齿补货采购建议页：/procure → /procure.html */
app.get('/procure', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'procure.html'));
});

/** BigInt 分数安全转为有限小数（用于前端展示） */
function fracToDecimal(frac, digits = 10) {
  const neg = frac.num < 0n;
  let num = frac.num < 0n ? -frac.num : frac.num;
  const intPart = num / frac.den;
  let rem = num % frac.den;
  let out = intPart.toString();
  if (digits > 0) {
    let fracStr = '';
    for (let i = 0; i < digits && rem > 0n; i++) {
      rem *= 10n;
      fracStr += (rem / frac.den).toString();
      rem %= frac.den;
    }
    if (fracStr) out += `.${fracStr}`;
  }
  return neg ? `-${out}` : out;
}

function serializeFrac(f) {
  return { num: f.num.toString(), den: f.den.toString(), decimal: fracToDecimal(f) };
}

function serializeSolution(r) {
  return {
    stages: r.stages,
    ratio: serializeFrac(r.ratio),
    error: serializeFrac(r.error),
    errorPercent: fracToDecimal({ num: r.error.num * 100n, den: r.error.den }, 6),
    pairs: r.pairs.map((p) => ({
      drive: p.drive,
      driven: p.driven,
      stageRatio: serializeFrac(p.stageRatio),
    })),
  };
}

/**
 * 校验装置参数列表（目标速比 / 容差 / 名称）。
 * @param {*} input
 * @param {{min?:number,max?:number}} [opts]
 * @returns {{ok:true,devices:Array}|{ok:false,status?:number,error:string}}
 */
function parseDevices(input, { min = 2, max = 3 } = {}) {
  if (!Array.isArray(input) || input.length < min || input.length > max) {
    return { ok: false, error: `需输入 ${min}${min === max ? '' : `～${max}`} 台装置` };
  }
  const devices = [];
  for (let i = 0; i < input.length; i++) {
    const row = input[i];
    if (!row || typeof row !== 'object') {
      return { ok: false, error: `第 ${i + 1} 台装置数据格式不正确` };
    }
    const target = parseTarget(String(row.target ?? ''));
    if (!target) {
      return {
        ok: false,
        error: `第 ${i + 1} 台装置的目标输出转速比格式不正确：请输入正数（如 0.0833、1/12）`,
      };
    }
    const tolerance = parseTolerance(String(row.tolerance ?? ''));
    if (!tolerance) {
      return {
        ok: false,
        error: `第 ${i + 1} 台装置的允许相对误差格式不正确：请输入非负数（如 0.05 或 5%）`,
      };
    }
    const name = String(row.name ?? '').trim() || `装置 ${i + 1}`;
    if (name.length > 30) {
      return { ok: false, error: `第 ${i + 1} 台装置名称不能超过 30 个字符` };
    }
    devices.push({ name, target, tolerance });
  }
  return { ok: true, devices };
}

app.post('/api/search', (req, res) => {
  const body = req.body || {};

  const target = parseTarget(String(body.target ?? ''));
  if (!target) {
    return res.status(400).json({ error: '目标输出转速比格式不正确：请输入正数（如 0.0833、1/12）' });
  }

  const tolerance = parseTolerance(String(body.tolerance ?? ''));
  if (!tolerance) {
    return res.status(400).json({ error: '允许相对误差格式不正确：请输入非负数（如 0.05 或 5%）' });
  }

  const checked = validateGears(body.gears);
  if (!checked.ok) return res.status(400).json({ error: checked.error });

  const { total, truncated, results } = search(checked.gears, target, tolerance);

  res.json({
    target: serializeFrac(target),
    tolerance: serializeFrac(tolerance),
    maxStages: MAX_STAGES,
    total,
    truncated,
    count: results.length,
    results: results.map(serializeSolution),
  });
});

app.post('/api/batch', (req, res) => {
  const body = req.body || {};

  const checked = validateGears(body.gears);
  if (!checked.ok) return res.status(400).json({ error: checked.error });

  const parsed = parseDevices(body.devices, { min: 2, max: 3 });
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const devices = parsed.devices;

  // 基于全部达标方案分配（不截断 300 条）
  const plan = planBatch(checked.gears, devices);

  const usedIds = new Set();
  for (const pick of plan.picks) {
    if (pick) for (const id of pick.gearIds) usedIds.add(id);
  }
  const unusedGears = checked.gears.filter((g) => !usedIds.has(g.id));

  res.json({
    maxStages: MAX_STAGES,
    deviceCount: devices.length,
    matchedCount: plan.matchedCount,
    totalStages: plan.totalStages,
    errorSum: serializeFrac(plan.errorSum),
    errorSumPercent: fracToDecimal({ num: plan.errorSum.num * 100n, den: plan.errorSum.den }, 6),
    unusedGears,
    devices: devices.map((d, i) => ({
      name: d.name,
      target: serializeFrac(d.target),
      tolerance: serializeFrac(d.tolerance),
      totalMatches: plan.totalMatches[i],
      candidateCount: plan.candidateCounts[i],
      matched: !!plan.picks[i],
      solution: plan.picks[i] ? serializeSolution(plan.picks[i]) : null,
    })),
  });
});

app.post('/api/procure', (req, res) => {
  const body = req.body || {};

  // 现有齿轮：2～8 枚
  const existingChecked = validateGears(body.existingGears, {
    label: '现有齿轮',
    min: MIN_EXISTING,
    max: MAX_EXISTING,
  });
  if (!existingChecked.ok) return res.status(400).json({ error: existingChecked.error });

  // 可购实物齿轮：1～4 枚，带非负整数价格
  const buyableChecked = validateBuyableGears(body.buyableGears);
  if (!buyableChecked.ok) return res.status(400).json({ error: buyableChecked.error });

  // 跨列表编号不得重复；合计不超过 12 枚
  const existingIds = new Set(existingChecked.gears.map((g) => g.id));
  for (const g of buyableChecked.gears) {
    if (existingIds.has(g.id)) {
      return res.status(400).json({ error: `现有齿轮与可购齿轮编号重复：${g.id}` });
    }
  }
  const totalGearCount = existingChecked.gears.length + buyableChecked.gears.length;
  if (totalGearCount > MAX_TOTAL_GEARS) {
    return res.status(400).json({
      error: `现有齿轮与可购齿轮合计不能超过 ${MAX_TOTAL_GEARS} 枚（当前 ${totalGearCount} 枚）`,
    });
  }

  // 固定 2 台装置（各自速比与容差）
  const parsed = parseDevices(body.devices, { min: 2, max: 2 });
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const devices = parsed.devices;

  const result = planProcure(existingChecked.gears, buyableChecked.gears, devices);

  const base = {
    maxStages: MAX_STAGES,
    deviceCount: result.deviceCount,
    subsetsChecked: result.subsetsChecked,
    feasibleSubsets: result.feasibleSubsets,
    devices: devices.map((d, i) => ({
      name: d.name,
      target: serializeFrac(d.target),
      tolerance: serializeFrac(d.tolerance),
      hasMatchInPool: result.deviceHasMatch[i],
    })),
    existingGears: existingChecked.gears,
    buyableGears: buyableChecked.gears,
  };

  if (!result.feasible) {
    return res.json({
      ...base,
      feasible: false,
      purchaseCount: 0,
      totalPrice: 0,
      purchasedGears: [],
      unusedGears: [],
      message:
        '枚举全部可购齿轮子集后，两台装置仍无法在齿轮不复用的前提下同时达标装配。' +
        '请考虑增加可购齿轮、放宽容差或调整目标速比。',
    });
  }

  res.json({
    ...base,
    feasible: true,
    noPurchaseNeeded: result.noPurchaseNeeded,
    purchaseCount: result.purchaseCount,
    totalPrice: result.totalPrice,
    totalStages: result.totalStages,
    errorSum: serializeFrac(result.errorSum),
    errorSumPercent: fracToDecimal({ num: result.errorSum.num * 100n, den: result.errorSum.den }, 6),
    purchasedGears: result.purchasedGears,
    unusedGears: result.unusedGears,
    devices: base.devices.map((d, i) => ({
      ...d,
      solution: serializeSolution(result.picks[i]),
    })),
  });
});

app.listen(PORT, () => {
  console.log(`齿轮组选配服务已启动： http://localhost:${PORT}`);
  console.log(`  单台选配： http://localhost:${PORT}/`);
  console.log(`  批量装配： http://localhost:${PORT}/batch`);
  console.log(`  缺齿补货： http://localhost:${PORT}/procure`);
});
