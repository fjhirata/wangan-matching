# -*- coding: utf-8 -*-
"""
湾岸マッチング — APIサーバ（Python標準ライブラリのみ・依存ゼロ）

起動:
    python3 backend/server.py            # http://localhost:8000
    PORT=9000 python3 backend/server.py  # ポート変更
    REFRESH_HOURS=6 python3 backend/server.py   # 自動更新間隔(時間, 既定12)
    REFRESH_TOKEN=xxxx python3 ...              # 手動更新エンドポイントの保護トークン

データ自動更新:
    サーバは裏でスプレッドシート(主DB=成約 / 従DB=スペック)を定期取得し、再集計して反映する。
    シート更新直後に即反映したい場合は GET/POST /api/refresh を叩く（再起動不要）。
    取得失敗時は直前のデータを維持。スプレッドシートは読み取りのみ（編集しない）。

エンドポイント:
    GET  /                 静的フロント
    GET  /api/health       死活確認＋データ鮮度
    GET  /api/config       軸定義・回答スケール・年収倍率・LINE URL・データ鮮度
    GET  /api/questions    診断20問
    GET  /api/mansions     物件一覧
    GET  /api/types        購入タイプ一覧
    POST /api/diagnose     {age, income, areaSqm, answers} -> 診断結果
    GET/POST /api/refresh  スプレッドシートから即時再取得・反映（?token=… で保護可）
"""
import json
import os
import sys
import time
import threading
import mimetypes
from urllib.parse import urlparse, parse_qs
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import db
import engine

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC_DIR = os.path.join(ROOT, "static")
PORT = int(os.environ.get("PORT", "8000"))
REFRESH_HOURS = float(os.environ.get("REFRESH_HOURS", "12"))   # 自動更新間隔
REFRESH_TOKEN = os.environ.get("REFRESH_TOKEN", "")            # 手動更新の保護(任意)

# 集計ビルダー(tools/)を読み込み（失敗しても配信は継続。自動更新のみ無効）
try:
    sys.path.insert(0, os.path.join(ROOT, "tools"))
    import build_mansions_from_db as builder
except Exception as e:  # noqa
    builder = None
    print("[refresh] ビルダー読込失敗・自動更新は無効:", e)

_refresh_lock = threading.Lock()


def refresh_data(reason=""):
    """スプレッドシートを取り直して再集計し、メモリへ反映。失敗時は例外（呼び元が旧データ維持）。"""
    if builder is None:
        raise RuntimeError("ビルダー未読込のため更新できません")
    with _refresh_lock:
        payload = builder.rebuild_and_save(force_fetch=True)
        db.set_mansions(payload)
        print(f"[refresh] {reason}反映: {payload['count']}棟 / 基準月 {payload['priceAnchor']} / {payload['generatedAt']}")
        return payload


def _refresher_loop():
    """裏で定期的にデータ鮮度を確認し、古ければスプレッドシートから再取得して反映。"""
    tick = max(60, min(int(REFRESH_HOURS * 3600), 3600))   # 最大1時間ごとに確認
    while True:
        try:
            if db.snapshot_age_hours() >= REFRESH_HOURS:
                refresh_data(reason="自動更新 ")
        except Exception as e:  # noqa
            print("[refresh] 失敗（前回データを維持）:", e)
        time.sleep(tick)


class Handler(BaseHTTPRequestHandler):
    server_version = "WanganMatching/0.2"

    # ----------------------------------------------------------- helpers
    def _send_json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _send_file(self, path):
        if not os.path.isfile(path):
            self._send_json({"error": "not found", "path": self.path}, 404)
            return
        ctype, _ = mimetypes.guess_type(path)
        ctype = ctype or "application/octet-stream"
        with open(path, "rb") as f:
            body = f.read()
        self.send_response(200)
        self.send_header("Content-Type", ctype + ("; charset=utf-8" if ctype.startswith("text/") or ctype.endswith("javascript") else ""))
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _static_path(self):
        rel = self.path.split("?", 1)[0].lstrip("/")
        if rel == "":
            rel = "index.html"
        full = os.path.normpath(os.path.join(STATIC_DIR, rel))
        if not full.startswith(STATIC_DIR):
            return None
        return full

    def _base_url(self):
        proto = self.headers.get("X-Forwarded-Proto")
        host = self.headers.get("X-Forwarded-Host") or self.headers.get("Host") or "localhost"
        if not proto:
            proto = "http" if host.startswith(("localhost", "127.")) else "https"
        return f"{proto}://{host}"

    def _send_index(self, path):
        """index.html を配信。OGP用の __BASE_URL__ を実ドメインへ置換する。"""
        try:
            with open(path, "r", encoding="utf-8") as f:
                html = f.read()
        except OSError:
            return self._send_json({"error": "not found"}, 404)
        body = html.replace("__BASE_URL__", self._base_url()).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _authorized(self):
        if not REFRESH_TOKEN:
            return True
        q = parse_qs(urlparse(self.path).query)
        tok = (q.get("token") or [""])[0] or self.headers.get("X-Refresh-Token", "")
        return tok == REFRESH_TOKEN

    def _handle_refresh(self):
        if not self._authorized():
            return self._send_json({"ok": False, "error": "unauthorized"}, 401)
        try:
            p = refresh_data(reason="手動更新 ")
            return self._send_json({"ok": True, "count": p["count"],
                                    "priceAnchor": p["priceAnchor"], "generatedAt": p["generatedAt"]})
        except Exception as e:  # noqa
            return self._send_json({"ok": False, "error": str(e)}, 502)

    # ----------------------------------------------------------- routes
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Refresh-Token")
        self.end_headers()

    def do_GET(self):
        route = self.path.split("?", 1)[0]
        try:
            if route == "/api/health":
                return self._send_json({"ok": True, "service": "wangan-matching",
                                        "data": db.get_data_meta(),
                                        "dataAgeHours": round(db.snapshot_age_hours(), 2)})
            if route == "/api/config":
                return self._send_json(db.get_config())
            if route == "/api/questions":
                return self._send_json(db.get_questions_doc())
            if route == "/api/mansions":
                ms = db.get_mansions()
                return self._send_json({"count": len(ms), "meta": db.get_data_meta(), "mansions": ms})
            if route == "/api/types":
                return self._send_json({"types": db.get_types()})
            if route == "/api/refresh":
                return self._handle_refresh()
            if route.startswith("/api/"):
                return self._send_json({"error": "unknown endpoint", "path": route}, 404)
            full = self._static_path()
            if full is None:
                return self._send_json({"error": "forbidden"}, 403)
            if os.path.basename(full) == "index.html":
                return self._send_index(full)
            return self._send_file(full)
        except Exception as e:  # noqa
            return self._send_json({"error": "server error", "detail": str(e)}, 500)

    def do_POST(self):
        route = self.path.split("?", 1)[0]
        try:
            if route == "/api/refresh":
                return self._handle_refresh()
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length) if length else b"{}"
            try:
                payload = json.loads(raw.decode("utf-8") or "{}")
            except json.JSONDecodeError:
                return self._send_json({"error": "invalid JSON body"}, 400)
            if route == "/api/diagnose":
                return self._send_json(engine.diagnose(payload))
            return self._send_json({"error": "unknown endpoint", "path": route}, 404)
        except Exception as e:  # noqa
            return self._send_json({"error": "server error", "detail": str(e)}, 500)

    def log_message(self, fmt, *args):
        if "/api/" in self.path:
            print("[api]", self.command, self.path)


def main():
    db.get_mansions()  # スナップショットを先読み
    if builder is not None:
        threading.Thread(target=_refresher_loop, daemon=True).start()
        print(f"自動更新: {REFRESH_HOURS}時間ごとにスプレッドシートを確認" + ("（トークン保護ON）" if REFRESH_TOKEN else ""))
    httpd = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"湾岸マッチング API + フロント 起動 -> http://localhost:{PORT}")
    print("  手動更新: /api/refresh ／ 停止: Ctrl+C")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n停止しました")
        httpd.server_close()


if __name__ == "__main__":
    main()
