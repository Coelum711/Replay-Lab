"""Experimental MLX speaker injection. No model files or Voicebox code are patched.

Private MLX input assembly is pinned and checked before use. This is an
experimental inference adapter, not a claim of perceptual voice fidelity.
"""
from __future__ import annotations

import gc
import hashlib
import inspect
import json
import os
from pathlib import Path

REPOS = {
    "0.6B-Base": "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16",
    "1.7B-Base": "mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16",
    "1.7B-CustomVoice": "mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-bf16",
}
LANGUAGES = dict(zip(
    "en zh ja ko de fr ru pt es it".split(),
    "english chinese japanese korean german french russian portuguese spanish italian".split(),
))


def hub_cache() -> Path:
    # Honor the same normally configured HF cache used by `hf download`.
    return Path(os.environ.get("HF_HUB_CACHE") or os.environ.get("HUGGINGFACE_HUB_CACHE")
                or str(Path(os.environ.get("HF_HOME") or str(Path.home() / ".cache/huggingface")) / "hub"))


def validate_snapshot(path: Path, key: str) -> Path:
    config = json.loads((path / "config.json").read_text())
    expected_type = "base" if key.endswith("Base") else "custom_voice"
    expected_size = "0b6" if key.startswith("0.6") else "1b7"
    if config.get("tts_model_type") != expected_type or config.get("tts_model_size") != expected_size:
        raise ValueError(f"模型类型/尺寸不匹配：需要 {key}")
    files = [path / "config.json", path / "tokenizer_config.json", path / "vocab.json",
             path / "merges.txt", path / "speech_tokenizer/config.json"]
    index = path / "model.safetensors.index.json"
    if index.exists():
        names = set(json.loads(index.read_text())["weight_map"].values())
        if any(Path(n).name != n for n in names):
            raise ValueError("Invalid model weight path")
        files += [path / n for n in names]
    else:
        files += [path / "model.safetensors"]
    codec_files = list((path / "speech_tokenizer").glob("*.safetensors"))
    if not codec_files:
        raise ValueError("缺少 speech_tokenizer 权重；下载尚未完成")
    files += codec_files
    for file in files:
        if not file.is_file() or file.stat().st_size == 0:
            raise ValueError(f"模型文件缺失/未下载完整：{file.name}")
    return path.resolve()


def cached_snapshot(key: str) -> Path:
    repo_root = hub_cache() / ("models--" + REPOS[key].replace("/", "--"))
    ref = repo_root / "refs/main"
    if not ref.is_file():
        raise FileNotFoundError(f"未缓存 {key}。请先显式下载；本服务不会自动下载模型。")
    revision = ref.read_text().strip()
    if len(revision) != 40 or any(c not in "0123456789abcdef" for c in revision):
        raise ValueError("Invalid HF cache revision")
    return validate_snapshot(repo_root / "snapshots" / revision, key)


def model_status():
    result = {}
    for key, repo in REPOS.items():
        try:
            cached_snapshot(key)
            result[key] = {"cached": True, "repo": repo}
        except (OSError, ValueError, KeyError) as error:
            result[key] = {"cached": False, "repo": repo, "reason": str(error)}
    return result


class SpeakerInjectedView:
    """Read-through view; no mutation of CustomVoice or its preset embedding table."""
    def __init__(self, model, embedding):
        self._model = model
        self._embedding = embedding
        self.speaker_encoder = True  # select reference branch of upstream input assembly
        self.injections = 0

    def __getattr__(self, name):
        return getattr(self._model, name)

    def extract_speaker_embedding(self, audio, sr=24000):
        self.injections += 1
        return self._embedding

    def _prepare_generation_inputs(self, text, language="auto", speaker=None, instruct=None, **kwargs):
        # The pinned implementation concatenates this vector with the codec
        # prefix and prepends the separate instruct text embedding.
        return type(self._model)._prepare_generation_inputs(
            self, text=text, language=language, speaker=None,
            ref_audio=True, instruct=instruct,
        )


def verify_source(module_file):
    module_file = Path(module_file)
    content = module_file.read_bytes()
    blob = b"blob " + str(len(content)).encode() + b"\0" + content
    if hashlib.sha1(blob).hexdigest() != "cd3af7e7ed967866e98b00ba0decbbc092d769f9":
        raise RuntimeError("mlx-audio 内部接口版本不匹配。请重新运行 INSTALL_VOICE_BRIDGE.command；拒绝猜测注入位置。")


def verify_contract(model):
    verify_source(inspect.getfile(type(model)))
    if model.config.tts_model_type != "custom_voice" or model.config.tts_model_size != "1b7":
        raise ValueError("文字情绪桥需要 MLX 1.7B CustomVoice；0.6B 不支持此模式。")


class MlxCloneEngine:
    def __init__(self, directory: Path):
        self.directory = directory
        self.model = None
        self.model_key = None

    def unload(self):
        self.model = None
        self.model_key = None
        gc.collect()
        try:
            import mlx.core as mx
            mx.clear_cache()
        except ImportError:
            pass

    def load(self, key, snapshot):
        if self.model_key == (key, str(snapshot)):
            return self.model
        self.unload()
        # Separate process, deliberately offline. `load` receives a validated
        # local snapshot, never a remote repo ID.
        os.environ["HF_HUB_OFFLINE"] = "1"
        os.environ["TRANSFORMERS_OFFLINE"] = "1"
        from mlx_audio.tts.utils import load
        model = load(str(snapshot))
        if model.tokenizer is None or model.speech_tokenizer is None:
            raise ValueError("文本/语音 tokenizer 未加载，请检查缓存是否完整。")
        self.model, self.model_key = model, (key, str(snapshot))
        return model

    def synthesize(self, reference: bytes, text: str, language: str, instruct: str, seed: int | None):
        import io
        import numpy as np
        import soundfile as sf
        import mlx.core as mx
        from scipy.signal import resample_poly
        from math import gcd

        base_path = cached_snapshot("1.7B-Base")
        cv_path = cached_snapshot("1.7B-CustomVoice")
        audio, sr = sf.read(io.BytesIO(reference), dtype="float32", always_2d=True)
        # One clean sample, bounded duration; never synthesize a replacement
        # identity if audio is missing, corrupt, empty or silent.
        if not 3 * sr <= len(audio) <= 60 * sr:
            raise ValueError("参考样本需要 3–60 秒；请选择一个干净的 Voicebox 样本。")
        audio = audio.mean(axis=1)
        if not np.isfinite(audio).all() or np.max(np.abs(audio)) < 0.0001:
            raise ValueError("参考样本为空、静音或含无效采样。")
        if sr != 24000:
            divisor = gcd(sr, 24000)
            audio = resample_poly(audio, 24000 // divisor, sr // divisor).astype("float32")
        fingerprint = hashlib.sha256(reference + str(base_path).encode() + b"mlx-speaker-v1").hexdigest()
        self.directory.mkdir(parents=True, exist_ok=True)
        embed_path = self.directory / (fingerprint + ".npy")
        if embed_path.exists():
            vector = np.load(embed_path, allow_pickle=False)
        else:
            base = self.load("1.7B-Base", base_path)
            if base.speaker_encoder is None:
                raise ValueError("Base 模型没有 speaker encoder。")
            vector = np.array(base.extract_speaker_embedding(mx.array(audio)))
            del base
            self.unload()
            if vector.shape != (1, 2048) or not np.isfinite(vector).all():
                raise ValueError("无效的 1.7B 声纹维度/数值")
            temp = embed_path.with_suffix(".tmp")
            with temp.open("wb") as output:
                np.save(output, vector, allow_pickle=False)
            temp.replace(embed_path)
        model = self.load("1.7B-CustomVoice", cv_path)
        verify_contract(model)
        if vector.shape != (1, model.config.talker_config.hidden_size) or not np.isfinite(vector).all():
            raise ValueError("缓存声纹尺寸与 CustomVoice 不匹配；禁止跨尺寸复用。")
        if seed is not None:
            np.random.seed(seed)
            mx.random.seed(seed)
        view = SpeakerInjectedView(model, mx.array(vector))
        chunks = []
        for result in type(model)._generate_with_instruct(
            view, text=text, speaker=None, language=language, instruct=instruct or None,
            temperature=0.9, max_tokens=1536, top_k=50, top_p=1.0,
            repetition_penalty=1.05, verbose=False, stream=False,
        ):
            if result.token_count >= 1536:
                raise RuntimeError("达到生成长度上限，可能未说完；请拆短台词。")
            chunks.append(np.array(result.audio))
        if view.injections != 1 or not chunks:
            raise RuntimeError("声纹注入未执行或没有生成音频；拒绝返回预设音色。")
        output = np.concatenate(chunks)
        if not output.size or not np.isfinite(output).all():
            raise RuntimeError("模型生成了空/无效音频。")
        wav = io.BytesIO()
        sf.write(wav, output, model.sample_rate, format="WAV", subtype="PCM_16")
        return wav.getvalue(), {"speaker_fingerprint": fingerprint, "injection_count": view.injections}
