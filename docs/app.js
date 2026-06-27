/* ===== 湾岸マッチング フロントエンド (vanilla JS / 依存ゼロ) ===== */
const CONFIG = {
  LINE_URL: "https://liff.line.me/2000002966-QKeEB4Jy/landing?follow=%40057dqjjg&lp=p6O2dE&liff_id=2000002966-QKeEB4Jy",
  INCOME_MULTIPLIER: 7,
};
const $app = document.getElementById("app");
const TSUBO = 3.30578;

const state = {
  config: null, axes: [], scale: [], questions: [], types: [], mansions: [],
  screen: "intro",
  input: { age: 40, income: 1800, area: 70 },
  answers: {}, qIndex: 0,
  result: null,
};

/* ---------- 起動 ---------- */
async function boot() {
  try {
    const [qdoc, typesDoc, mans] = await Promise.all([
      fetch("./data/questions.json").then((r) => r.json()),
      fetch("./data/types.json").then((r) => r.json()),
      fetch("./data/mansions.json").then((r) => r.json()),
    ]);
    state.axes = qdoc.axes;
    state.scale = qdoc.scale;
    state.questions = qdoc.questions;
    state.types = typesDoc.types;
    state.mansions = mans.mansions || [];
    state.config = { incomeMultiplier: CONFIG.INCOME_MULTIPLIER, lineUrl: CONFIG.LINE_URL };
    const fresh = document.getElementById("dataFresh");
    if (fresh && mans.generatedAt) {
      fresh.textContent = `データ更新 ${String(mans.generatedAt).slice(0, 10)}／成約 基準月 ${mans.priceAnchor || ""}`;
    }
    document.getElementById("boot").classList.add("hide");
    render();
  } catch (e) {
    document.getElementById("boot").innerHTML =
      '<div style="padding:24px;text-align:center;max-width:340px">' +
      '<div class="boot-logo">湾岸マッチング</div>' +
      '<p style="margin-top:14px;line-height:1.7">データの読み込みに失敗しました。<br>少し時間をおいて再読み込みしてください。</p></div>';
    console.error(e);
  }
}

/* ---------- ユーティリティ ---------- */
function fmtMan(man) {
  man = Math.round(man);
  if (man >= 10000) {
    const oku = Math.floor(man / 10000), rest = man % 10000;
    return rest ? `${oku}億${rest.toLocaleString()}万円` : `${oku}億円`;
  }
  return `${man.toLocaleString()}万円`;
}
function calcBudget(income, area) {
  const mult = (state.config && state.config.incomeMultiplier) || 7;
  const total = income * mult;
  const tsubo = area / TSUBO;
  return { total, tsubo, perTsubo: tsubo ? total / tsubo : 0 };
}
function el(html) { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstChild; }
function go(screen) { state.screen = screen; render(); window.scrollTo({ top: 0, behavior: "smooth" }); }
function track(ev, params) { try { if (window.gtag) window.gtag("event", ev, params || {}); } catch (e) {} }

/* ---------- ルーター ---------- */
function render() {
  if (state.screen === "intro") return renderIntro();
  if (state.screen === "step1") return renderStep1();
  if (state.screen === "quiz") return renderQuiz();
  if (state.screen === "loading") return renderLoading();
  if (state.screen === "result") return renderResult();
}

/* ---------- INTRO ---------- */
function renderIntro() {
  $app.innerHTML = `
    <section class="hero fade">
      <span class="badge badge-warn">📊 実データ（成約＋物件スペック）で診断</span>
      <div class="hero-illust"><img class="hero-icon" src="fujifujita.png" alt="ふじふじ太" onerror="this.style.display='none';this.parentNode.textContent='🌆'"></div>
      <h1><span class="accent">湾岸マッチング</span></h1>
      <p class="hero-sub">あなたにベストな湾岸タワマンがわかるマッチングアプリ</p>
      <p class="lead">性格・価値観 × ご予算で、湾岸エリアの<br>タワーマンション約47棟から提案します。</p>
      <div class="kpis">
        <div class="kpi"><b>47</b><span>対象タワマン</span></div>
        <div class="kpi"><b>20</b><span>診断の質問</span></div>
        <div class="kpi"><b>3<small>分</small></b><span>かんたん診断</span></div>
      </div>
      <button class="btn btn-primary" id="start">無料で診断をはじめる</button>
      <p class="note">登録不要・無料／結果はSNSでシェアできます</p>
    </section>`;
  document.getElementById("start").onclick = () => go("step1");
}

/* ---------- STEP1 前提条件 ---------- */
function renderStep1() {
  const i = state.input;
  $app.innerHTML = `
    <section class="fade">
      <div class="step-head"><span class="step-tag">STEP 1 / 3</span><span class="badge">前提条件</span></div>
      <div class="progress"><i style="width:33%"></i></div>
      <div class="card">
        <h2 class="sec">まずは、あなたの条件を</h2>
        <p class="sub">年収から無理のない予算と、買える坪単価を自動計算します。</p>

        <div class="field">
          <div class="flabel"><b>年齢</b><span class="fval" id="vAge">${i.age}歳</span></div>
          <input type="range" id="age" min="22" max="70" step="1" value="${i.age}">
        </div>
        <div class="field">
          <div class="flabel"><b>世帯年収</b><span class="fval" id="vInc">${i.income}万円</span></div>
          <input type="range" id="income" min="400" max="4000" step="50" value="${i.income}">
        </div>
        <div class="field">
          <div class="flabel"><b>希望の広さ</b><span class="fval" id="vArea">${i.area}㎡</span></div>
          <input type="range" id="area" min="30" max="150" step="5" value="${i.area}">
        </div>

        <div class="budget-box" id="budgetBox"></div>
        <button class="btn btn-primary" id="next">価値観診断にすすむ →</button>
      </div>
    </section>`;

  const upd = () => {
    document.getElementById("vAge").textContent = i.age + "歳";
    document.getElementById("vInc").textContent = i.income.toLocaleString() + "万円";
    document.getElementById("vArea").textContent = i.area + "㎡";
    const b = calcBudget(i.income, i.area);
    const per = Math.round(b.perTsubo);
    const ms = state.mansions || [];
    let line2, hint;
    if (ms.length) {
      const inBudget = ms.filter((m) => m.tsuboPrice <= b.perTsubo).length;
      const maxTsubo = Math.max(...ms.map((m) => m.tsuboPrice));
      line2 = `<div class="br"><span>この広さで予算内のタワマン</span><b>${inBudget}<small> / ${ms.length}棟</small></b></div>`;
      hint = `※ ${i.area}㎡ ≒ ${b.tsubo.toFixed(1)}坪。` +
        (per >= maxTsubo ? "湾岸タワマンの全価格帯が射程内です 🎯" : `坪単価 約${per.toLocaleString()}万円/坪 までが狙えます。`);
    } else {
      line2 = `<div class="br"><span>買える坪単価の上限</span><b>${per.toLocaleString()}万円/坪</b></div>`;
      hint = `※ ${i.area}㎡ ≒ ${b.tsubo.toFixed(1)}坪 で計算。あくまで目安です。`;
    }
    document.getElementById("budgetBox").innerHTML = `
      <div class="br"><span>総予算の目安（年収×${(state.config.incomeMultiplier)||7}）</span><b>${fmtMan(b.total)}</b></div>
      ${line2}
      <div class="hint">${hint}</div>`;
  };
  document.getElementById("age").oninput = (e) => { i.age = +e.target.value; upd(); };
  document.getElementById("income").oninput = (e) => { i.income = +e.target.value; upd(); };
  document.getElementById("area").oninput = (e) => { i.area = +e.target.value; upd(); };
  document.getElementById("next").onclick = () => { state.qIndex = 0; go("quiz"); };
  upd();
}

/* ---------- STEP2 価値観診断 ---------- */
function renderQuiz() {
  const total = state.questions.length;
  const q = state.questions[state.qIndex];
  const axis = state.axes.find((a) => a.key === q.axis) || {};
  const cur = state.answers[q.id];
  const pct = Math.round((state.qIndex / total) * 100);

  $app.innerHTML = `
    <section class="fade">
      <div class="step-head"><span class="step-tag">STEP 2 / 3</span><span class="badge">価値観診断</span></div>
      <div class="progress"><i style="width:${pct}%"></i></div>
      <div class="card qcard">
        <div class="qnum">Q ${state.qIndex + 1} / ${total}</div>
        <div><span class="qaxis">${axis.emoji || ""} ${axis.label || ""}</span></div>
        <div class="qtext">${q.text}</div>
        <div class="opts">
          ${state.scale.map((s) => `
            <button class="opt ${cur === s.value ? "sel" : ""}" data-v="${s.value}">
              <span class="dot"></span><span>${s.label}</span>
            </button>`).join("")}
        </div>
        <div class="q-nav">
          <button class="q-back" id="back" ${state.qIndex === 0 ? "disabled" : ""}>← 戻る</button>
          <span class="step-tag">あと ${total - state.qIndex} 問</span>
        </div>
      </div>
    </section>`;

  $app.querySelectorAll(".opt").forEach((b) => {
    b.onclick = () => {
      state.answers[q.id] = +b.dataset.v;
      $app.querySelectorAll(".opt").forEach((x) => x.classList.remove("sel"));
      b.classList.add("sel");
      setTimeout(() => {
        if (state.qIndex < total - 1) { state.qIndex++; renderQuiz(); window.scrollTo({top:0}); }
        else submit();
      }, 240);
    };
  });
  const back = document.getElementById("back");
  if (back) back.onclick = () => { if (state.qIndex > 0) { state.qIndex--; renderQuiz(); } };
}

/* ---------- ローディング ---------- */
function renderLoading() {
  $app.innerHTML = `<div class="loading fade"><div class="spin"></div>
    <p>あなたにベストな湾岸タワマンを<br>診断しています…</p></div>`;
}

function submit() {
  go("loading");
  try {
    const res = WANGAN.diagnose(
      { age: state.input.age, income: state.input.income, areaSqm: state.input.area, answers: state.answers },
      { axes: state.axes, questions: state.questions, types: state.types, mansions: state.mansions },
      { lineUrl: CONFIG.LINE_URL }
    );
    state.result = res;
    track("diagnose_complete", { type: res.type && res.type.name, affordable: res.affordableCount });
    setTimeout(() => go("result"), 600); // 演出
  } catch (e) {
    console.error(e);
    alert("診断の計算でエラーが発生しました。再読み込みしてください。");
    go("step1");
  }
}

/* ---------- レーダーチャート(SVG) ---------- */
function radarSVG(values, axes) {
  const cx = 170, cy = 142, R = 96, n = axes.length;
  const ang = (i) => ((-90 + (i * 360) / n) * Math.PI) / 180;
  const pt = (i, r) => [cx + r * Math.cos(ang(i)), cy + r * Math.sin(ang(i))];
  let grid = "";
  [0.25, 0.5, 0.75, 1].forEach((f) => {
    const p = axes.map((_, i) => pt(i, R * f).map((v) => v.toFixed(1)).join(",")).join(" ");
    grid += `<polygon points="${p}" fill="none" stroke="rgba(20,70,130,.16)" stroke-width="1"/>`;
  });
  let spokes = "";
  axes.forEach((_, i) => { const [x, y] = pt(i, R); spokes += `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="rgba(20,70,130,.16)"/>`; });
  const poly = axes.map((a, i) => pt(i, R * (values[a.key] / 100)).map((v) => v.toFixed(1)).join(",")).join(" ");
  let dots = "", labels = "";
  axes.forEach((a, i) => {
    const [x, y] = pt(i, R * (values[a.key] / 100));
    dots += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4.2" fill="#f3c64b" stroke="#fff" stroke-width="1.5"/>`;
    const [lx, ly] = pt(i, R + 22);
    const dx = lx - cx;
    const anchor = Math.abs(dx) < 12 ? "middle" : (dx > 0 ? "start" : "end");
    labels += `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="${anchor}" dominant-baseline="middle" font-size="12.5" font-weight="700" fill="#1463bf">${a.label}</text>`;
  });
  return `<svg viewBox="0 0 340 300" width="100%" style="max-width:340px;height:auto" role="img" aria-label="価値観レーダーチャート">
    ${grid}${spokes}
    <polygon points="${poly}" fill="rgba(20,99,191,.16)" stroke="#1463bf" stroke-width="2.5"/>
    ${dots}${labels}</svg>`;
}

/* ---------- STEP3 結果 ---------- */
function renderResult() {
  const r = state.result, t = r.type, axes = r.axesMeta || state.axes;
  const medals = ["🥇", "🥈", "🥉"];
  const recapNote = r.affordableCount === 0
    ? `<p class="lock-note">※ ご予算ではやや背伸びの物件が中心です。無理のない資金計画はLINEでご相談を。</p>` : "";

  $app.innerHTML = `
    <section class="fade">
      <div class="card card result-hero">
        <span class="badge badge-warn" style="position:absolute;top:14px;right:14px">実データ</span>
        <div class="emoji">${t.emoji}</div>
        <div class="tlabel">あなたの購入タイプは</div>
        <h1><span class="accent">${t.name}</span></h1>
        <div class="catch">${t.catch}</div>
        <p class="desc">${t.desc}</p>
      </div>

      <div class="section-title">📊 あなたの価値観バランス</div>
      <div class="card">
        <div class="radar-wrap">${radarSVG(r.userAxis, axes)}</div>
        <div class="axis-legend">
          ${axes.map((a) => `<div><b>${r.userAxis[a.key]}</b><br>${a.label}</div>`).join("")}
        </div>
      </div>

      <div class="section-title">🏙️ あなたにおすすめTOP3</div>
      <div class="budget-recap">
        <div><span>総予算の目安</span><b>${fmtMan(r.budget.maxTotal)}</b></div>
        <div><span>許容坪単価</span><b>${r.affordableCount >= r.totalCount ? "全棟射程" : Math.round(r.budget.maxTsuboPrice).toLocaleString() + "万"}</b></div>
        <div><span>予算内</span><b>${r.affordableCount}<small>/${r.totalCount}棟</small></b></div>
      </div>
      ${recapNote}
      <div id="ranks">
        ${r.matches.map((m, idx) => `
          <div class="rank">
            <div class="rthumb">
              ${m.photoUrl ? `<img src="${m.photoUrl}" alt="${m.name}の外観" loading="lazy" onerror="this.style.display='none'">` : ""}
              <span class="medal">${medals[idx] || ""}</span>
            </div>
            <div class="rinfo">
              ${idx === 0 ? '<span class="best-badge">★ ベストマッチ</span>' : ""}
              <div class="rname">${m.name}</div>
              <div class="rmeta">${m.area}${m.station ? "・" + m.station + "駅 徒歩" + m.walkMin + "分" : ""}${m.ageYears ? "・築" + m.ageYears + "年" : ""}${m.seismic ? "・" + m.seismic : ""}${m.totalUnits ? "・" + m.totalUnits + "戸" : ""}</div>
              <div class="chips">
                <span class="chip price">坪単価 ${m.tsuboPrice}万</span>
                ${m.trendPct != null ? `<span class="chip ${m.trendPct >= 0 ? "up" : "down"}">📈 ${m.trendPct >= 0 ? "+" : ""}${m.trendPct}%</span>` : ""}
                <span class="chip">成約${m.txCount}件</span>
                ${m.overBudget ? '<span class="chip over">予算オーバー</span>' : ""}
              </div>
              ${(() => { const fs = ["プール", "ジム", "サウナ", "バー", "コンビニ", "内廊下"].filter((f) => m.facilities && m.facilities[f]); return fs.length ? `<div class="chips">${fs.map((f) => `<span class="chip fac">${f === "バー" ? "ラウンジ/バー" : f}</span>`).join("")}</div>` : ""; })()}
              <div class="rest">坪単価＝直近${m.tsuboWindowMonths ? m.tsuboWindowMonths + "ヶ月" : "全期間"}平均（${m.txInWindow}件）／ ${state.input.area}㎡概算 <b>${fmtMan(m.estTotal)}</b></div>
            </div>
            <div class="match"><b>${m.matchPct}<small>%</small></b><span>マッチ度</span></div>
          </div>`).join("")}
      </div>
      <p class="lock-note">📊 坪単価＝直近3ヶ月の成約移動平均（1取引1票）。スペック・共用施設・各スコアは実物件データに基づく算出値です。</p>
      <p class="lock-note">🔒 各物件の詳細スコア・現在の空室状況はLINEでご案内します</p>

      <div class="card cta-card">
        <h3>気になる物件、見つかりましたか？</h3>
        <p>専任アドバイザーが、あなたのタイプに合わせて<br>具体的な部屋・価格をご提案します。</p>
        <button class="btn btn-line" id="line">💬 この物件について相談する（LINE）</button>
        <div class="share-row">
          <button class="btn btn-x btn-sm" id="share">𝕏 結果をシェア</button>
          <button class="btn btn-ghost btn-sm" id="again">もう一度診断</button>
        </div>
      </div>
    </section>`;

  document.getElementById("line").onclick = () => {
    const url = r.lineUrl || (state.config && state.config.lineUrl) || "#";
    track("line_click", { type: r.type && r.type.name, top: r.matches[0] && r.matches[0].name });
    window.open(url, "_blank");
  };
  document.getElementById("share").onclick = shareX;
  document.getElementById("again").onclick = () => { state.answers = {}; state.qIndex = 0; go("intro"); };
}

function shareX() {
  const r = state.result, t = r.type;
  track("share_click", { type: t && t.name });
  const names = r.matches.map((m, i) => `${i + 1}. ${m.name}`).join("\n");
  const text = `私の湾岸タワマンタイプは「${t.emoji}${t.name}」でした！\n${t.catch}\n\n◤おすすめ物件TOP3◢\n${names}\n\nあなたは何タイプ？`;
  const url = location.origin + location.pathname;
  window.open(
    `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}&hashtags=湾岸マッチング,湾岸タワマン`,
    "_blank"
  );
}

boot();
