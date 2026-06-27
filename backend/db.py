# -*- coding: utf-8 -*-
"""
データアクセス層（DB抽象化）。

マンションデータ(data/mansions.json)は2つの実スプレッドシートから
tools/build_mansions_from_db.py が集計したもの。
このモジュールは集計済みデータをメモリに保持し、サーバの自動更新／手動更新
（server.py）からホットスワップ（set_mansions）できるようにしている。
→ スプレッドシートが更新されたら、再起動なしでアプリに反映される。
"""
import json
import os
import functools

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, "data")
MANSIONS_PATH = os.path.join(DATA_DIR, "mansions.json")

# 設定（本番では .env や設定ファイルへ）
INCOME_MULTIPLIER = 7          # 総予算 = 世帯年収 × 7（上限目安）
LINE_URL = "https://liff.line.me/2000002966-QKeEB4Jy/landing?follow=%40057dqjjg&lp=p6O2dE&liff_id=2000002966-QKeEB4Jy"   # FJリアルティ LINE友だち追加（LIFF）

# メモリ上の現在データ（自動/手動更新で差し替え）
_mansions = None
_meta = {}


def _load(filename):
    with open(os.path.join(DATA_DIR, filename), "r", encoding="utf-8") as f:
        return json.load(f)


def _load_snapshot():
    global _mansions, _meta
    doc = _load("mansions.json")
    _mansions = doc["mansions"]
    _meta = {k: doc.get(k) for k in ("source", "priceMethod", "priceAnchor", "dataYearMax", "generatedAt", "count")}


def get_mansions():
    """現在のマンション一覧。初回はスナップショットを読み込む。"""
    if _mansions is None:
        _load_snapshot()
    return _mansions


def set_mansions(payload):
    """更新後のデータをメモリに反映（server.py の自動/手動更新から呼ぶ）。"""
    global _mansions, _meta
    _mansions = payload["mansions"]
    _meta = {k: payload.get(k) for k in ("source", "priceMethod", "priceAnchor", "dataYearMax", "generatedAt", "count")}


def get_data_meta():
    if _mansions is None:
        _load_snapshot()
    return _meta


def snapshot_age_hours():
    """mansions.json の更新からの経過時間[h]。自動更新の要否判定に使用。"""
    try:
        import time
        return (time.time() - os.path.getmtime(MANSIONS_PATH)) / 3600.0
    except OSError:
        return 1e9   # ファイルが無ければ「要更新」


@functools.lru_cache(maxsize=1)
def get_questions_doc():
    return _load("questions.json")


@functools.lru_cache(maxsize=1)
def get_types():
    return _load("types.json")["types"]


def get_config():
    doc = get_questions_doc()
    meta = get_data_meta()
    return {
        "axes": doc["axes"],
        "scale": doc["scale"],
        "incomeMultiplier": INCOME_MULTIPLIER,
        "lineUrl": LINE_URL,
        "dataMeta": {
            "source": meta.get("source"),
            "priceAnchor": meta.get("priceAnchor"),
            "generatedAt": meta.get("generatedAt"),
            "count": meta.get("count"),
        },
    }


def clear_cache():
    get_questions_doc.cache_clear()
    get_types.cache_clear()
    _load_snapshot()
