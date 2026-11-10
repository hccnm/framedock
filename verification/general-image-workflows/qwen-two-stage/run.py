"""Run the configured Qwen workflow directly; never write canvas state."""
import json
import pathlib
import sys
import time
import urllib.parse
import urllib.request

root = pathlib.Path(__file__).parent
stage = sys.argv[1]
base = json.loads((pathlib.Path.home() / 'Library/Application Support/FrameDock Desktop/storage/state/comfyui_store.json').read_text())['state']['baseUrl']
graph = json.loads((root / (stage + '-workflow.json')).read_text())
request = urllib.request.Request(base + '/prompt', data=json.dumps({'prompt': graph, 'client_id': 'framedock-qwen-two-stage-direct'}).encode(), headers={'Content-Type': 'application/json'})
receipt = json.load(urllib.request.urlopen(request, timeout=30))
(root / (stage + '-receipt.json')).write_text(json.dumps(receipt, indent=2))
print('QUEUED', receipt['prompt_id'], flush=True)
while True:
    history = json.load(urllib.request.urlopen(base + '/history/' + receipt['prompt_id'], timeout=30)).get(receipt['prompt_id'])
    if history:
        break
    time.sleep(3)
(root / (stage + '-history.json')).write_text(json.dumps(history, ensure_ascii=False, indent=2))
assert history['status']['status_str'] == 'success', history['status']
for result in history['outputs'].values():
    for media in result.get('images', []):
        (root / (stage + '.png')).write_bytes(urllib.request.urlopen(base + '/view?' + urllib.parse.urlencode(media), timeout=30).read())
        print('OUTPUT', json.dumps(media), flush=True)
print('VISUAL_REVIEW_REQUIRED', str(root / (stage + '.png')), flush=True)
