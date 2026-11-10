import io
import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
import wave
import zipfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from engine import SpeakerInjectedView, cached_snapshot, validate_snapshot, verify_contract
from server import Bridge, ThreadingHTTPServer, handler_for, local_url, sample_from_export, validate_request


def wav(seconds=3):
    result = io.BytesIO()
    with wave.open(result, 'wb') as f:
        f.setnchannels(1); f.setsampwidth(2); f.setframerate(24000)
        f.writeframes(b'\x01\x01' * (24000 * seconds))
    return result.getvalue()


def archive(samples):
    result = io.BytesIO()
    with zipfile.ZipFile(result, 'w') as z:
        z.writestr('samples.json', json.dumps({k:'transcript' for k in samples}))
        for name, data in samples.items(): z.writestr('samples/' + name, data)
    return result.getvalue()


REQUEST = dict(profile_id='clone-1', text='Hello', model_size='1.7B', language='en', instruct='Sad', seed=42)


class ContractTests(unittest.TestCase):
    def test_injection_view_forces_reference_branch_and_never_selects_preset(self):
        class Model:
            def _prepare_generation_inputs(self, **kwargs):
                self.forwarded = kwargs
                return self.extract_speaker_embedding(kwargs['ref_audio'])
        model=Model(); vector=object(); view=SpeakerInjectedView(model,vector)
        self.assertIs(view._prepare_generation_inputs('hello',speaker='ryan',instruct='Sad'),vector)
        self.assertEqual(view.injections,1)
        self.assertIsNone(view.forwarded['speaker'])
        self.assertEqual(view.forwarded['instruct'],'Sad')
        self.assertFalse(hasattr(model,'forwarded'))

    def test_modified_upstream_is_rejected(self):
        class Model: pass
        with self.assertRaisesRegex(RuntimeError,'版本'): verify_contract(Model())

    def test_sample_selection_deterministic_without_extraction(self):
        name,data=sample_from_export(archive({'a.wav':wav(3),'b.wav':wav(4),'too-short.wav':wav(1)}))
        self.assertEqual(name,'b.wav');self.assertEqual(data,wav(4))

    def test_path_traversal_and_invalid_audio_not_accepted(self):
        for samples in ({'../../outside.wav':wav()},{'x.wav':b'broken'},{}):
            with self.assertRaises(ValueError): sample_from_export(archive(samples))

    def test_duplicates_are_rejected(self):
        content=io.BytesIO()
        import warnings
        with warnings.catch_warnings():
            warnings.simplefilter('ignore')
            with zipfile.ZipFile(content,'w') as z:
                z.writestr('samples.json','{}');z.writestr('samples.json','{}')
        with self.assertRaises(ValueError): sample_from_export(content.getvalue())

    def test_invalid_request_matrix(self):
        for extra in ({'model_size':'0.6B'},{'profile_id':'../ryan'},{'seed':True},{'seed':-1},
                      {'seed':1.5},{'language':'unknown'},{'text':''},{'instruct':'x'*2001}, {'preset_speaker':'ryan'}):
            with self.subTest(extra=extra),self.assertRaises(ValueError): validate_request({**REQUEST,**extra})
        self.assertEqual(validate_request(REQUEST)['language'],'english')

    def test_local_urls_only(self):
        for url in ('https://127.0.0.1:9','http://example.com','http://u:p@localhost:9','http://localhost:9/path'):
            with self.assertRaises(ValueError): local_url(url)
        self.assertEqual(local_url('http://localhost:17493/'),'http://localhost:17493')

    def test_model_cache_completeness_and_size(self):
        with tempfile.TemporaryDirectory() as directory:
            p=Path(directory)
            (p/'config.json').write_text(json.dumps({'tts_model_type':'base','tts_model_size':'0b6'}))
            with self.assertRaises(ValueError): validate_snapshot(p,'1.7B-Base')
            with self.assertRaises(ValueError): validate_snapshot(p,'0.6B-Base')
            (p/'speech_tokenizer').mkdir()
            for name in ('tokenizer_config.json','vocab.json','merges.txt','model.safetensors','speech_tokenizer/config.json','speech_tokenizer/model.safetensors'):
                (p/name).write_bytes(b'x')
            self.assertEqual(validate_snapshot(p,'0.6B-Base'),p.resolve())
            (p/'model.safetensors').unlink()
            with self.assertRaises(ValueError): validate_snapshot(p,'0.6B-Base')

    def test_missing_cache_never_invokes_downloader(self):
        with tempfile.TemporaryDirectory() as directory, patch('engine.hub_cache',return_value=Path(directory)):
            with self.assertRaises(FileNotFoundError): cached_snapshot('1.7B-Base')


class FlowTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.calls=[]
        class Engine:
            def synthesize(inner,*args):
                self.calls.append(args); return wav(),{'injection_count':1}
        self.bridge=Bridge('http://127.0.0.1:17493',Path(self.temp.name),engine=Engine())
        self.bridge.health=lambda:{'ready':True}

    def tearDown(self): self.temp.cleanup()

    def test_voicebox_profile_to_engine_to_wav(self):
        routes=[]
        def get(url):
            routes.append(url)
            return archive({'reference.wav':wav()}) if url.endswith('/export') else json.dumps({'id':'clone-1','voice_type':'cloned'}).encode()
        with patch('server.get_local',side_effect=get): audio,meta=self.bridge.synthesize(REQUEST)
        self.assertEqual(audio,wav());self.assertEqual(meta['profile_id'],'clone-1')
        self.assertEqual(self.calls[0],(wav(),'Hello','english','Sad',42))
        self.assertEqual(len(routes),2)

    def test_presets_missing_samples_and_wrong_profile_fail_without_fallback(self):
        for profile in ({'id':'clone-1','voice_type':'preset'},{'id':'other','voice_type':'cloned'}):
            with patch('server.get_local',return_value=json.dumps(profile).encode()),self.assertRaises(ValueError):
                self.bridge.synthesize(REQUEST)
        self.assertEqual(self.calls,[]);self.assertFalse(self.bridge.lock.locked())

    def test_busy_and_unready_never_download_or_fallback(self):
        self.bridge.lock.acquire()
        with self.assertRaises(BlockingIOError): self.bridge.synthesize(REQUEST)
        self.bridge.lock.release();self.bridge.health=lambda:{'ready':False}
        with patch('server.get_local',side_effect=AssertionError('no fetch')):
            with self.assertRaises(RuntimeError):self.bridge.synthesize(REQUEST)
        self.assertFalse(self.bridge.lock.locked());self.assertEqual(self.calls,[])

    def test_http_security_and_wav_contract(self):
        self.bridge.synthesize=lambda data:(wav(),{'profile_id':data['profile_id'],'injection_count':1})
        server=ThreadingHTTPServer(('127.0.0.1',0),handler_for(self.bridge))
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        url=f'http://127.0.0.1:{server.server_port}'
        opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
        try:
            for headers in ({'Origin':'https://evil.example'}, {'Origin':'null'}, {'Host':'evil.example'}):
                with self.assertRaises(urllib.error.HTTPError) as error:opener.open(urllib.request.Request(url+'/health',headers=headers))
                self.assertEqual(error.exception.code,403)
            data=json.dumps(REQUEST).encode()
            with self.assertRaises(urllib.error.HTTPError):opener.open(urllib.request.Request(url+'/synthesize',data=data,headers={'Content-Type':'application/json'}))
            response=opener.open(urllib.request.Request(url+'/synthesize',data=data,headers={'Origin':'http://127.0.0.1:8765','Content-Type':'application/json','X-ReplayLab-Bridge':'1'}))
            self.assertEqual(response.headers['X-ReplayLab-Profile'],'clone-1')
            self.assertEqual(float(response.headers['X-ReplayLab-Duration']),3)
            self.assertEqual(response.headers['X-ReplayLab-Injected'],'1');self.assertEqual(response.read(),wav())
            self.assertEqual(response.headers['Access-Control-Allow-Origin'],'http://127.0.0.1:8765')
        finally:
            server.shutdown();server.server_close();thread.join()


if __name__=='__main__':unittest.main()
