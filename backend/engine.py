# -*- coding: utf-8 -*-
"""
診断・マッチングエンジン（バックエンドの中核ロジック）。

仕様書 STEP1〜3 を実装:
  STEP1 前提条件 -> 総予算 = 世帯年収 × 7、許容坪単価 = 総予算 / 希望坪数 で絞り込み
  STEP2 価値観診断 -> 20問×5段階回答を5軸(居住性/資産性/施設充実度/立地/広さ)スコアへ集計
  STEP3 タイプ判定 + レーダー用5軸 + マッチ度順 物件TOP3

※スコアの計算式・係数はプロトタイプ用の暫定値。正式なスコアリング定義は
  従DB（後日支給）の確定後に調整します。
"""
import math
import db

TSUBO_PER_SQM = 3.30578  # 1坪 = 約3.30578㎡
AXES = ["liv", "asset", "fac", "loc", "size"]


# ---------------------------------------------------------------- STEP1: 予算
def compute_budget(income_man, area_sqm):
    """income_man: 世帯年収[万円], area_sqm: 希望面積[㎡]"""
    income_man = max(0, float(income_man or 0))
    area_sqm = max(1.0, float(area_sqm or 1))
    max_total = income_man * db.INCOME_MULTIPLIER          # 総予算[万円]
    tsubo = area_sqm / TSUBO_PER_SQM                        # 希望坪数
    max_tsubo_price = max_total / tsubo if tsubo else 0     # 許容坪単価[万円/坪]
    return {
        "incomeMultiplier": db.INCOME_MULTIPLIER,
        "maxTotal": round(max_total),
        "areaSqm": round(area_sqm, 1),
        "tsuboCount": round(tsubo, 2),
        "maxTsuboPrice": round(max_tsubo_price, 1),
    }


# ------------------------------------------------------- STEP2: 5軸スコア集計
def compute_user_axes(answers, questions_doc):
    """answers: {questionId(str/int): value(-2..2)} -> 各軸 0-100 に正規化"""
    answers = answers or {}
    # 軸ごとに raw を集計
    raw = {a: 0.0 for a in AXES}
    count = {a: 0 for a in AXES}
    for q in questions_doc["questions"]:
        a = q["axis"]
        v = answers.get(str(q["id"]), answers.get(q["id"], 0))
        try:
            v = float(v)
        except (TypeError, ValueError):
            v = 0.0
        v = max(-2.0, min(2.0, v))
        if q.get("rev"):
            v = -v
        raw[a] += v
        count[a] += 1
    # 正規化: 各軸 n問 → [-2n, +2n] を 0-100 へ
    user = {}
    for a in AXES:
        n = count[a] or 1
        lo, hi = -2 * n, 2 * n
        user[a] = round((raw[a] - lo) / (hi - lo) * 100) if hi != lo else 50
    return user


# --------------------------------------------------------- STEP3: タイプ判定
def classify_type(user_axes, types):
    """ユーザー5軸ベクトルに最も近い archetype を採用"""
    best, best_dist = None, float("inf")
    for t in types:
        d = math.sqrt(sum((user_axes[a] - t["axis"][a]) ** 2 for a in AXES))
        if d < best_dist:
            best, best_dist = t, d
    return {
        "key": best["key"], "name": best["name"], "emoji": best["emoji"],
        "catch": best["catch"], "desc": best["desc"], "axis": best["axis"],
    }


# --------------------------------------------- STEP3: 物件スコアリング & TOP3
def score_mansions(user_axes, budget, mansions, top_n=3):
    # 重み = ユーザーの軸スコア。全て中立(=50付近)でも比較できるよう微小な下駄を履かせる
    weights = {a: user_axes[a] + 10 for a in AXES}
    wsum = sum(weights.values()) or 1
    max_tsubo = budget["maxTsuboPrice"]

    ranked = []
    affordable_count = 0
    for m in mansions:
        s = m["scores"]
        match_raw = sum(weights[a] * s[a] for a in AXES) / wsum  # 0-100
        affordable = m["tsuboPrice"] <= max_tsubo
        if affordable:
            affordable_count += 1
        ranked.append({
            "id": m["id"], "name": m["name"], "area": m["area"],
            "tsuboPrice": m["tsuboPrice"],                 # 坪単価=直近3ヶ月の成約移動平均(1取引1票)
            "tsuboWindowMonths": m.get("tsuboWindowMonths"),  # 算定に使った窓(基本3/拡大時はその月数)
            "txInWindow": m.get("txInWindow"),             # 窓内の成約件数
            "trendPct": m.get("trendPct"),                 # 値上がり率(資産性の裏付け)
            "txCount": m.get("txCount"),                   # 累計成約件数
            "medianSqm": m.get("medianSqm"),               # 成約面積の中央値
            "repLayout": m.get("repLayout", ""),           # 代表間取り
            # 従DB(スペック)由来
            "station": m.get("station"), "walkMin": m.get("walkMin"),
            "builtYear": m.get("builtYear"), "ageYears": m.get("ageYears"),
            "seismic": m.get("seismic"), "floors": m.get("floors"),
            "totalUnits": m.get("totalUnits"),
            "photoUrl": m.get("photoUrl"),
            "facilities": m.get("facilities", {}),
            "specsPending": m.get("specsPending", False),
            "scores": s,
            "estTotal": round(m["tsuboPrice"] * budget["tsuboCount"]),  # 希望面積での概算総額[万円]
            "matchPct": max(1, min(99, round(match_raw))),
            "overBudget": not affordable,
        })

    # 予算内を優先し、その中でマッチ度降順。予算内が3件未満なら予算オーバーで補完。
    ranked.sort(key=lambda x: (x["overBudget"], -x["matchPct"]))
    return ranked[:top_n], affordable_count


# ------------------------------------------------------------------- まとめ
def diagnose(payload):
    age = payload.get("age")
    income = payload.get("income")
    area_sqm = payload.get("areaSqm")
    answers = payload.get("answers", {})

    questions_doc = db.get_questions_doc()
    types = db.get_types()
    mansions = db.get_mansions()

    budget = compute_budget(income, area_sqm)
    user_axes = compute_user_axes(answers, questions_doc)
    type_ = classify_type(user_axes, types)
    matches, affordable_count = score_mansions(user_axes, budget, mansions)

    return {
        "input": {"age": age, "income": income, "areaSqm": area_sqm},
        "budget": budget,
        "userAxis": user_axes,
        "axesMeta": questions_doc["axes"],
        "type": type_,
        "matches": matches,
        "affordableCount": affordable_count,
        "totalCount": len(mansions),
        "lineUrl": db.LINE_URL,
        "isMock": True,
    }
