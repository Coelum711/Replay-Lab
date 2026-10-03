#!/usr/bin/env python3
"""Start Replay Lab on a loopback-only local HTTP server and open Studio."""
from __future__ import annotations

import contextlib
import http.server
import os
import socket
import socketserver
import threading
import webbrowser
import json
import re
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
HOST = "127.0.0.1"
VOICEBOX_ORIGIN = "http://127.0.0.1:17493"
VOICEBOX_ID = re.compile(r"^[A-Za-z0-9_-]{1,128}$")


def free_port(preferred: int = 8765) -> int:
    with contextlib.closing(socket.socket(socket.AF_INET, socket.SOCK_STREAM)) as sock:
        try:
            sock.bind((HOST, preferred))
            return preferred
        except OSError:
            sock.bind((HOST, 0))
            return int(sock.getsockname()[1])


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    """Static Replay Lab server plus a narrow, same-origin Voicebox bridge.

    The browser never talks to Voicebox directly, so Voicebox CORS settings and
    Replay Lab's randomly selected local port cannot break the integration.
    Only the read/generate endpoints required by Replay Lab are exposed.
    """

    def log_message(self, fmt: str, *args: object) -> None:
        pass

    def _voicebox_target(self) -> str | None:
        path = self.path.split("?", 1)[0]
        if path in {"/__voicebox/health", "/__voicebox/profiles"}:
            return path.removeprefix("/__voicebox")
        for prefix in ("/__voicebox/history/", "/__voicebox/audio/"):
            if path.startswith(prefix):
                item = path[len(prefix):]
                if VOICEBOX_ID.fullmatch(item):
                    return path.removeprefix("/__voicebox")
        if self.command == "POST" and path == "/__voicebox/generate":
            return "/generate"
        return None

    def _proxy_voicebox(self) -> bool:
        if not self.path.startswith("/__voicebox/"):
            return False
        target = self._voicebox_target()
        if target is None:
            self.send_error(403, "Voicebox endpoint is not exposed by Replay Lab")
            return True
        body = None
        headers: dict[str, str] = {"Accept": self.headers.get("Accept", "*/*")}
        if self.command == "POST":
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                length = 0
            if length < 0 or length > 1_000_000:
                self.send_error(413, "Voicebox request too large")
                return True
            body = self.rfile.read(length) if length else b""
            headers["Content-Type"] = self.headers.get("Content-Type", "application/json")
        request = urllib.request.Request(
            f"{VOICEBOX_ORIGIN}{target}",
            data=body,
            headers=headers,
            method=self.command,
        )
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                payload = response.read()
                self.send_response(response.status)
                for key in ("Content-Type", "Content-Length", "Content-Disposition"):
                    value = response.headers.get(key)
                    if value and key != "Content-Length":
                        self.send_header(key, value)
                self.send_header("Content-Length", str(len(payload)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(payload)
        except urllib.error.HTTPError as error:
            payload = error.read() or json.dumps({"detail": f"Voicebox HTTP {error.code}"}).encode()
            self.send_response(error.code)
            self.send_header("Content-Type", error.headers.get("Content-Type", "application/json"))
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(payload)
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            payload = json.dumps({
                "detail": "Voicebox Local 未连接。请先单独启动 Voicebox，再重试。",
                "reason": str(error),
            }, ensure_ascii=False).encode("utf-8")
            self.send_response(502)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(payload)
        return True

    def do_GET(self) -> None:
        if self._proxy_voicebox():
            return
        super().do_GET()

    def do_POST(self) -> None:
        if self._proxy_voicebox():
            return
        self.send_error(405, "POST is only available for the local Voicebox bridge")


def main() -> None:
    os.chdir(ROOT)
    port = free_port()
    with socketserver.ThreadingTCPServer((HOST, port), QuietHandler) as httpd:
        httpd.daemon_threads = True
        url = f"http://{HOST}:{port}/web/studio.html"
        print("Replay Lab 本地服务器已启动")
        print(url)
        print("关闭这个窗口或按 Ctrl+C 即可停止服务器。")
        print("Voicebox Local bridge: /__voicebox/* → http://127.0.0.1:17493（仅允许生成所需端点）")
        if os.environ.get("REPLAY_LAB_NO_BROWSER") != "1":
            threading.Timer(0.35, lambda: webbrowser.open(url, new=2)).start()
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nReplay Lab 已停止。")


if __name__ == "__main__":
    main()

