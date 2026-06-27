/* ===== 湾岸マッチング 診断エンジン（ブラウザ版・engine.pyの移植） =====
   GitHub Pages（静的ホスティング）で動かすため、診断ロジックをクライアント側で実行する。
   計算内容は backend/engine.py と同一。 */
(function (global) {
  "use strict";
  var TSUBO_PER_SQM = 3.30578;
  var AXES = ["liv", "asset", "fac", "loc", "size"];
  var INCOME_MULTIPLIER = 7; // 総予算 = 世帯年収 × 7

  // STEP1: 予算
  function computeBudget(incomeMan, areaSqm) {
    incomeMan = Math.max(0, Number(incomeMan) || 0);
    areaSqm = Math.max(1, Number(areaSqm) || 1);
    var maxTotal = incomeMan * INCOME_MULTIPLIER;
    var tsubo = areaSqm / TSUBO_PER_SQM;
    var maxTsuboPrice = tsubo ? maxTotal / tsubo : 0;
    return {
      incomeMultiplier: INCOME_MULTIPLIER,
      maxTotal: Math.round(maxTotal),
      areaSqm: Math.round(areaSqm * 10) / 10,
      tsuboCount: Math.round(tsubo * 100) / 100,
      maxTsuboPrice: Math.round(maxTsuboPrice * 10) / 10,
    };
  }

  // STEP2: 20問 → 5軸 0-100
  function computeUserAxes(answers, questions) {
    answers = answers || {};
    var raw = {}, count = {};
    AXES.forEach(function (a) { raw[a] = 0; count[a] = 0; });
    questions.forEach(function (q) {
      var a = q.axis;
      var v = answers[q.id];
      if (v === undefined) v = answers[String(q.id)];
      v = Number(v) || 0;
      v = Math.max(-2, Math.min(2, v));
      if (q.rev) v = -v;
      raw[a] += v;
      count[a] += 1;
    });
    var user = {};
    AXES.forEach(function (a) {
      var n = count[a] || 1, lo = -2 * n, hi = 2 * n;
      user[a] = hi !== lo ? Math.round((raw[a] - lo) / (hi - lo) * 100) : 50;
    });
    return user;
  }

  // STEP3: タイプ判定（最近傍 archetype）
  function classifyType(userAxes, types) {
    var best = null, bestDist = Infinity;
    types.forEach(function (t) {
      var d = 0;
      AXES.forEach(function (a) { var diff = userAxes[a] - t.axis[a]; d += diff * diff; });
      d = Math.sqrt(d);
      if (d < bestDist) { bestDist = d; best = t; }
    });
    return { key: best.key, name: best.name, emoji: best.emoji, catch: best.catch, desc: best.desc, axis: best.axis };
  }

  // STEP3: 物件スコアリング & TOP3
  function scoreMansions(userAxes, budget, mansions, topN) {
    topN = topN || 3;
    var weights = {}, wsum = 0;
    AXES.forEach(function (a) { weights[a] = userAxes[a] + 10; wsum += weights[a]; });
    if (!wsum) wsum = 1;
    var maxTsubo = budget.maxTsuboPrice;
    var ranked = [], affordable = 0;
    mansions.forEach(function (m) {
      var s = m.scores, matchRaw = 0;
      AXES.forEach(function (a) { matchRaw += weights[a] * s[a]; });
      matchRaw = matchRaw / wsum;
      var aff = m.tsuboPrice <= maxTsubo;
      if (aff) affordable += 1;
      ranked.push({
        id: m.id, name: m.name, area: m.area,
        tsuboPrice: m.tsuboPrice, tsuboWindowMonths: m.tsuboWindowMonths, txInWindow: m.txInWindow,
        trendPct: m.trendPct, txCount: m.txCount, medianSqm: m.medianSqm, repLayout: m.repLayout || "",
        station: m.station, walkMin: m.walkMin, builtYear: m.builtYear, ageYears: m.ageYears,
        seismic: m.seismic, floors: m.floors, totalUnits: m.totalUnits, photoUrl: m.photoUrl,
        facilities: m.facilities || {}, specsPending: !!m.specsPending, scores: s,
        estTotal: Math.round(m.tsuboPrice * budget.tsuboCount),
        matchPct: Math.max(1, Math.min(99, Math.round(matchRaw))),
        overBudget: !aff,
      });
    });
    ranked.sort(function (a, b) {
      if (a.overBudget !== b.overBudget) return a.overBudget ? 1 : -1;
      return b.matchPct - a.matchPct;
    });
    return { matches: ranked.slice(0, topN), affordableCount: affordable };
  }

  // まとめ
  function diagnose(input, data, opts) {
    opts = opts || {};
    var budget = computeBudget(input.income, input.areaSqm);
    var userAxes = computeUserAxes(input.answers, data.questions);
    var type = classifyType(userAxes, data.types);
    var r = scoreMansions(userAxes, budget, data.mansions);
    return {
      input: { age: input.age, income: input.income, areaSqm: input.areaSqm },
      budget: budget,
      userAxis: userAxes,
      axesMeta: data.axes,
      type: type,
      matches: r.matches,
      affordableCount: r.affordableCount,
      totalCount: data.mansions.length,
      lineUrl: opts.lineUrl || "",
      isMock: false,
    };
  }

  global.WANGAN = { diagnose: diagnose, AXES: AXES };
})(window);
