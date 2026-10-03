"""Loopback-only companion service. Reads Voicebox profiles; never changes them."""
from __future__ import annotations

import argparse
import importlib.util
import io
import json
import platform
import re
import threading
import urllib.error
import urllib.parse
import urllib.request
import wave
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from engine import LANGUAGES, MlxCloneEngine, model_status, verify_source

SERVICE = "replaylab-mlx-clone-bridge"
PROTOCOL = 1
LIMIT = 60 * 1024 * 1024
LOOPBACK = {"localhost", "127.0.0.1", "::1"}


def local_url(value):
    url = urllib.parse.urlsplit(value)
    if (url.scheme != "http" or url.hostname not in LOOPBACK or url.username or url.password
            or url.query or url.fragment or url.path not in ("", "/")):
        raise ValueError("Voicebox 地址必须是无账号的本机 http://127.0.0.1:端口")
    return value.rstrip("/")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise ValueError("本机 Voicebox 请求不允许重定向")


def get_local(url):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    with opener.open(url, timeout=30) as response:
        data = response.read(LIMIT + 1)
        if len(data) > LIMIT:
            raise ValueError("Voicebox 返回的数据过大")
        return data


def sample_from_export(data: bytes):
    """Use the longest valid WAV (3–60s); avoid manual emotion-profile preparation.

    ZIP contents are never extracted to disk and paths are never trusted.
    The chosen filename is returned so the selection is inspectable.
    """
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        entries = archive.infolist()
        if len(entries) > 1000 or sum(x.file_size for x in entries) > LIMIT:
            raise ValueError("Profile ZIP 解压体积/文件数量过大")
        names = [x.filename for x in entries]
        if len(names) != len(set(names)):
            raise ValueError("Profile ZIP 包含重复文件名")
        mapping = json.loads(archive.read("samples.json"))
        if not isinstance(mapping, dict):
            raise ValueError("不支持的 Voicebox samples.json 格式")
        candidates = []
        for name in sorted(mapping):
            if not re.fullmatch(r"[^/\\]+\.wav", name, re.IGNORECASE) or name.startswith("."):
                continue
            sample = archive.read("samples/" + name)
            try:
                with wave.open(io.BytesIO(sample)) as wav:
                    duration = wav.getnframes() / wav.getframerate()
                    if 3 <= duration <= 60 and wav.getnchannels() in (1, 2):
                        candidates.append((duration, name, sample))
            except (wave.Error, EOFError):
                continue
        if not candidates:
            raise ValueError("该 Profile 没有 3–60 秒的 PCM WAV 样本；请在 Voicebox 保留一份干净样本。")
        _, name, sample = max(candidates, key=lambda row: (row[0], row[1]))
        return name, sample


def validate_request(data):
    if not isinstance(data, dict):
        raise ValueError("请求必须是 JSON 对象")
    allowed = {"profile_id", "text", "language", "instruct", "model_size", "seed"}
    if set(data) - allowed:
        raise ValueError("存在未知请求字段")
    if data.get("model_size") != "1.7B":
        raise ValueError("文字情绪桥仅接受 1.7B；已有 0.6B Base 请用于稳定 Voicebox 克隆。")
    if not isinstance(data.get("profile_id"), str) or not re.fullmatch(r"[\w-]{1,128}", data["profile_id"], re.ASCII):
        raise ValueError("无效的 Voicebox Profile ID")
    for key, maximum in (("text", 600), ("instruct", 2000)):
        value = data.get(key, "")
        if not isinstance(value, str) or len(value) > maximum or "\0" in value:
            raise ValueError(f"{key} 需要为不超过 {maximum} 字符的文本")
    if not data.get("text", "").strip():
        raise ValueError("台词不能为空")
    language = data.get("language") or "auto"
    if not isinstance(language, str) or language not in {"auto", *LANGUAGES}:
        raise ValueError("不支持的朗读语言")
    seed = data.get("seed")
    if seed is not None and (type(seed) is not int or not 0 <= seed <= 4294967295):
        raise ValueError("Seed 必须是 0–4294967295 的整数")
    return {**data, "language": LANGUAGES.get(language, "auto"), "instruct": data.get("instruct", ""), "seed": seed}


class Bridge:
    def __init__(self, voicebox, directory, engine=None):
        self.voicebox = local_url(voicebox)
        self.engine = engine or MlxCloneEngine(directory)
        self.lock = threading.Lock()

    def health(self):
        models = model_status()
        dependencies = {name: importlib.util.find_spec(name) is not None for name in
                        ("mlx", "mlx_audio", "numpy", "scipy", "soundfile", "transformers", "huggingface_hub")}
        adapter_compatible = False
        if dependencies["mlx_audio"]:
            try:
                package = importlib.util.find_spec("mlx_audio")
                verify_source(Path(next(iter(package.submodule_search_locations))) / "tts/models/qwen3_tts/qwen3_tts.py")
                adapter_compatible = True
            except (OSError, RuntimeError, TypeError, StopIteration):
                pass
        runtime = (platform.system() == "Darwin" and platform.machine() == "arm64"
                   and all(dependencies.values()) and adapter_compatible)
        return {"service": SERVICE, "protocol": PROTOCOL,
                "capabilities": {"clone_instruct": True, "model_sizes": ["1.7B"], "automatic_model_download": False},
                "runtime_ready": runtime, "dependencies": dependencies,
                "adapter_compatible": adapter_compatible, "models": models,
                "ready": runtime and models["1.7B-Base"]["cached"] and models["1.7B-CustomVoice"]["cached"],
                "voicebox_url": self.voicebox, "busy": self.lock.locked(),
                "quality": "experimental; voice fidelity and emotion require listening"}

    def synthesize(self, data):
        args = validate_request(data)
        if not self.lock.acquire(blocking=False):
            raise BlockingIOError("情绪桥正在生成另一句，请等完成后重试。")
        try:
            # Preflight before reading private voice samples / loading any weights.
            if not self.health()["ready"]:
                raise RuntimeError("本机运行环境或 1.7B Base / CustomVoice 缓存未就绪。请打开桥状态页检查；没有自动下载。")
            encoded = urllib.parse.quote(args["profile_id"], safe="")
            profile = json.loads(get_local(self.voicebox + "/profiles/" + encoded))
            if profile.get("id") != args["profile_id"] or profile.get("voice_type") == "preset":
                raise ValueError("请选择有参考样本的克隆 Profile；不会转用预设声音。")
            name, reference = sample_from_export(get_local(self.voicebox + "/profiles/" + encoded + "/export"))
            wav, metadata = self.engine.synthesize(reference, args["text"], args["language"], args["instruct"], args["seed"])
            return wav, {**metadata, "profile_id": args["profile_id"], "sample": name}
        finally:
            self.lock.release()


def handler_for(bridge):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, format, *args):
            # Do not log scripts, profile audio or credentials.
            pass

        def guard(self):
            try:
                host = urllib.parse.urlsplit("http://" + self.headers.get("Host", "")).hostname
                if host not in LOOPBACK:
                    return False
                origin = self.headers.get("Origin")
                if origin:
                    local_url(origin)
                return True
            except ValueError:
                return False

        def send_data(self, status, data, mime="application/json", headers=None):
            if not isinstance(data, bytes):
                data = json.dumps(data, ensure_ascii=False).encode()
            self.send_response(status)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            origin = self.headers.get("Origin")
            if origin and self.guard():
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
                self.send_header("Access-Control-Expose-Headers", "X-ReplayLab-Profile, X-ReplayLab-Injected, X-ReplayLab-Duration")
            for key, value in (headers or {}).items():
                self.send_header(key, value)
            self.end_headers()
            self.wfile.write(data)

        def do_OPTIONS(self):
            if not self.guard():
                self.send_data(403, {"error": "仅允许本机页面"})
                return
            self.send_data(204, b"", headers={"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type, X-ReplayLab-Bridge",
                "Access-Control-Allow-Private-Network": "true"})

        def do_GET(self):
            if not self.guard():
                self.send_data(403, {"error": "仅允许本机页面"})
                return
            if self.path == "/health":
                self.send_data(200, bridge.health())
            elif self.path == "/":
                self.send_data(200, (Path(__file__).parent / "status.html").read_bytes(), "text/html; charset=utf-8")
            else:
                self.send_data(404, {"error": "不存在的端点"})

        def do_POST(self):
            if not self.guard() or self.headers.get("X-ReplayLab-Bridge") != "1":
                self.send_data(403, {"error": "需要本机来源与桥协议头"})
                return
            if self.path != "/synthesize":
                self.send_data(404, {"error": "不存在的端点"})
                return
            try:
                if self.headers.get("Content-Type", "").split(";")[0] != "application/json":
                    raise ValueError("需要 application/json")
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 16384:
                    raise ValueError("请求过大或为空")
                self.connection.settimeout(20)
                data = json.loads(self.rfile.read(length))
                self.connection.settimeout(None)
                wav, metadata = bridge.synthesize(data)
                with wave.open(io.BytesIO(wav)) as audio:
                    duration = audio.getnframes() / audio.getframerate()
                if duration <= 0:
                    raise ValueError("生成了空音频")
                self.send_data(200, wav, "audio/wav", {"X-ReplayLab-Profile": metadata["profile_id"],
                    "X-ReplayLab-Injected": str(metadata["injection_count"]),
                    "X-ReplayLab-Duration": str(duration)})
            except BlockingIOError as error:
                self.send_data(409, {"error": str(error)})
            except (ValueError, KeyError, zipfile.BadZipFile) as error:
                self.send_data(400, {"error": str(error)})
            except (BrokenPipeError, ConnectionResetError):
                pass
            except Exception as error:
                self.send_data(503, {"error": str(error), "fallback": False})
    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--voicebox", default="http://127.0.0.1:17493")
    parser.add_argument("--port", type=int, default=17494)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    bridge = Bridge(args.voicebox, Path.home() / "Library/Application Support/ReplayLabVoiceBridge/embeddings")
    if args.check:
        print(json.dumps(bridge.health(), ensure_ascii=False, indent=2))
        return
    server = ThreadingHTTPServer(("127.0.0.1", args.port), handler_for(bridge))
    print(f"声音桥已启动：http://127.0.0.1:{server.server_port} · 不自动下载模型 · Ctrl+C 停止", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
