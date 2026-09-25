'use strict';

/**
 * 双档换速装配算法（精确分数计算，基于 BigInt）
 *
 * 场景：同一台手摇机械装置有两个档位（互斥运行，不同时工作），两档都要求
 * **恰好两级**传动，且：
 *   - 两档共用同一对“有向齿轮对”作为固定的第一级（主动轴、中间轴上的
 *     齿轮不拆卸）；
 *   - 第二级可换装：第二级的主动轮（中间轴位）与从动轮（输出轴位）按档
 *     更换；
 *   - 每档内部 4 枚齿轮不得复用；两档互斥运行，换装级允许使用同一实物
 *     （即可与另一档的第二级，甚至固定级齿轮重复）。
 *
 * 在全部达标装配中按以下顺序选出唯一方案：
 *   1. 第二级主动、从动两个轴位中**需要更换的数量最少**（0～2）；
 *   2. 两档**相对误差之和最小**（精确分数比较）；
 *   3. 按齿轮编号**自然序**决胜：先固定级 (主动, 从动)，再依次两档第二级。
 *
 * 每档候选直接由 enumerateMatches 给出的“恰好两级”完整达标方案展开为
 * 有序两级列车（方案内两级顺序两种），再以固定第一级为键分组配对。
 */

const {
  enumerateMatches,
  enrichMatch,
  makeFrac,
} = require('./search');

/** 双档换速固定两级传动所需的最少 / 最多齿轮数 */
const MIN_DUAL_GEARS = 4;
const MAX_DUAL_GEARS = 12;

/**
 * 从“恰好两级”达标方案展开为全部有序两级列车。
 *
 * enumerateMatches 两级方案的 idxs 已按主动轮下标升序归一，展开为两种
 * 物理级顺序即得到全部有序列车，且不会重复：
 * 同一有序列车对应唯一的无序配对集合与朝向，只会来自唯一一个方案的一种展开。
 *
 * @param {Array} matches enumerateMatches 的完整结果（未截断）
 * @param {number} gearCount 齿轮总数（用于构造去重键）
 * @returns {Array<{first:{driveIndex,drivenIndex},second:{driveIndex,drivenIndex},
 *                  ratio:object,error:object}>}
 */
function trainsFromTwoStageMatches(matches, gearCount) {
  const trains = [];
  const seen = new Set();
  for (const m of matches) {
    if (m.stages !== 2) continue;
    const [p, q] = m.idxs;
    for (const [first, second] of [[p, q], [q, p]]) {
      // 键只需刻画有序两级列车本身（固定/换装的角色由配对阶段决定）
      const key =
        ((first.driveIndex * gearCount + first.drivenIndex) * gearCount +
          second.driveIndex) *
          gearCount +
        second.drivenIndex;
      if (seen.has(key)) continue;
      seen.add(key);
      trains.push({ first, second, ratio: m.ratio, error: m.error });
    }
  }
  return trains;
}

/**
 * 枚举单档的全部“有序两级”达标列车。
 * @param {Array<{id:string,teeth:number}>} gears
 * @param {{num:bigint,den:bigint}} target 目标输出转速比（正分数）
 * @param {{num:bigint,den:bigint}} tolerance 允许相对误差（非负分数）
 */
function enumerateTwoStageTrains(gears, target, tolerance) {
  return trainsFromTwoStageMatches(
    enumerateMatches(gears, target, tolerance),
    gears.length,
  );
}

/**
 * 两个候选装配的择优比较（<0 表示 a 优于 b）。
 *
 * 候选字段：replacements（需更换轴位数）、errNum/errDen（两档误差之和）、
 * seq（6 个齿轮下标：固定主动、固定从动、一档第二级主动、从动、二档第二级主动、从动）。
 */
function planCmp(a, b) {
  // 1) 第二级需更换轴位数量最少
  if (a.replacements !== b.replacements) return a.replacements - b.replacements;
  // 2) 两档相对误差之和最小（精确分数比较）
  const le = a.errNum * b.errDen;
  const re = b.errNum * a.errDen;
  if (le !== re) return le < re ? -1 : 1;
  // 3) 齿轮编号自然序：固定级在前，再依次两档换装级（索引序即编号自然序）
  for (let i = 0; i < a.seq.length; i++) {
    if (a.seq[i] !== b.seq[i]) return a.seq[i] - b.seq[i];
  }
  return 0;
}

/**
 * 将有序两级列车展开为带编号/齿数的两级方案（结构对齐 serializeSolution）。
 */
function buildSolution(train, gears) {
  const base = enrichMatch(
    { stages: 2, ratio: train.ratio, error: train.error, idxs: [train.first, train.second] },
    gears,
  );
  return {
    stages: 2,
    ratio: base.ratio,
    error: base.error,
    pairs: base.pairs,
    flatIds: base.flatIds,
    gearIds: base.gearIds,
  };
}

/**
 * 主入口：在共用齿轮清单上为两个档位寻找唯一的双档换速装配。
 *
 * @param {Array<{id:string,teeth:number}>} gears 规范化齿轮（按编号自然序，4～12 枚）
 * @param {Array<{name:string,target:object,tolerance:object}>} devices 恰好 2 档
 * @returns {object} 有解返回 feasible:true 与固定级/两档换装级/需更换轴位；
 *                   无解返回 feasible:false 及各档是否存在两级达标方案的诊断
 */
function planDualSpeed(gears, devices) {
  const [d1, d2] = devices;

  // 每档枚举一次：既得到“恰好两级”达标方案数（诊断），也展开为有序列车
  const matches1 = enumerateMatches(gears, d1.target, d1.tolerance);
  const matches2 = enumerateMatches(gears, d2.target, d2.tolerance);
  const twoStageMatches = [
    matches1.filter((m) => m.stages === 2),
    matches2.filter((m) => m.stages === 2),
  ];
  const twoStageMatchCounts = twoStageMatches.map((list) => list.length);

  const trains1 = trainsFromTwoStageMatches(twoStageMatches[0], gears.length);
  const trains2 = trainsFromTwoStageMatches(twoStageMatches[1], gears.length);

  // 第二档列车按固定第一级 (主动下标, 从动下标) 分组
  const byFirst = new Map();
  for (const t2 of trains2) {
    const key = t2.first.driveIndex * gears.length + t2.first.drivenIndex;
    let list = byFirst.get(key);
    if (!list) {
      list = [];
      byFirst.set(key, list);
    }
    list.push(t2);
  }

  let best = null;
  let candidateCount = 0;

  for (const t1 of trains1) {
    const key = t1.first.driveIndex * gears.length + t1.first.drivenIndex;
    const list = byFirst.get(key);
    if (!list) continue;
    for (const t2 of list) {
      candidateCount++;
      const replacements =
        (t1.second.driveIndex !== t2.second.driveIndex ? 1 : 0) +
        (t1.second.drivenIndex !== t2.second.drivenIndex ? 1 : 0);
      const errNum =
        t1.error.num * t2.error.den + t2.error.num * t1.error.den;
      const errDen = t1.error.den * t2.error.den;
      const seq = [
        t1.first.driveIndex,
        t1.first.drivenIndex,
        t1.second.driveIndex,
        t1.second.drivenIndex,
        t2.second.driveIndex,
        t2.second.drivenIndex,
      ];
      const cand = { t1, t2, replacements, errNum, errDen, seq };
      if (!best || planCmp(cand, best) < 0) best = cand;
    }
  }

  if (!best) {
    return {
      feasible: false,
      gearCount: gears.length,
      candidateCount: 0,
      twoStageMatchCounts,
    };
  }

  const fixedDrive = gears[best.t1.first.driveIndex];
  const fixedDriven = gears[best.t1.first.drivenIndex];
  const fixedStage = {
    drive: { id: fixedDrive.id, teeth: fixedDrive.teeth },
    driven: { id: fixedDriven.id, teeth: fixedDriven.teeth },
    stageRatio: makeFrac(BigInt(fixedDrive.teeth), BigInt(fixedDriven.teeth)),
  };

  const sol1 = buildSolution(best.t1, gears);
  const sol2 = buildSolution(best.t2, gears);

  // 四个物理轴位（固定级两轴在两档间不变，故不出现在更换清单中）
  const shafts = [
    {
      position: 'fixed-drive',
      label: '第一级主动轴',
      gear1: { id: fixedDrive.id, teeth: fixedDrive.teeth },
      gear2: { id: fixedDrive.id, teeth: fixedDrive.teeth },
      changed: false,
    },
    {
      position: 'fixed-driven',
      label: '第一级从动轴（中间轴固定轮）',
      gear1: { id: fixedDriven.id, teeth: fixedDriven.teeth },
      gear2: { id: fixedDriven.id, teeth: fixedDriven.teeth },
      changed: false,
    },
    {
      position: 'second-drive',
      label: '第二级主动轴位（中间轴换装轮）',
      gear1: sol1.pairs[1].drive,
      gear2: sol2.pairs[1].drive,
      changed: best.t1.second.driveIndex !== best.t2.second.driveIndex,
    },
    {
      position: 'second-driven',
      label: '第二级从动轴位（输出轴换装轮）',
      gear1: sol1.pairs[1].driven,
      gear2: sol2.pairs[1].driven,
      changed: best.t1.second.drivenIndex !== best.t2.second.drivenIndex,
    },
  ];

  return {
    feasible: true,
    gearCount: gears.length,
    candidateCount,
    twoStageMatchCounts,
    replacementCount: best.replacements,
    errorSum: makeFrac(best.errNum, best.errDen),
    fixedStage,
    solutions: [sol1, sol2],
    shafts,
  };
}

module.exports = {
  MIN_DUAL_GEARS,
  MAX_DUAL_GEARS,
  enumerateTwoStageTrains,
  planDualSpeed,
  planCmp,
};
