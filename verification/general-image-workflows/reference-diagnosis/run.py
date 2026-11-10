"""Replay the actual failed input with one explicit diagnostic variant."""
import json
import pathlib
import sys
import time
import urllib.parse
import urllib.request

root = pathlib.Path(__file__).parent
base = json.loads((pathlib.Path.home() / 'Library/Application Support/FrameDock Desktop/storage/state/comfyui_store.json').read_text())['state']['baseUrl']
variant = sys.argv[1]
graph = json.loads((root.parent / 'zimage-shape-fixed-submitted.json').read_text())
if variant == 'style-off':
    for node in ['11', '12']:
        graph[node]['inputs']['switch'] = 'Off'
elif variant == 'base-50':
    for node in ['11', '12', '9']:
        graph[node]['inputs']['switch'] = 'Off'
    graph['6']['inputs'].update(steps=50, cfg=4)
elif variant != 'baseline':
    raise ValueError(variant)
graph['10']['inputs']['filename_prefix'] = 'FrameDock/ZImage/diagnosis/' + variant
(root / f'{variant}-submitted.json').write_text(json.dumps(graph, ensure_ascii=False, indent=2))
request = urllib.request.Request(base + '/prompt', data=json.dumps({'prompt': graph, 'client_id': 'framedock-reference-diagnosis'}).encode(), headers={'Content-Type': 'application/json'})
with urllib.request.urlopen(request, timeout=30) as response:
    receipt = json.load(response)
(root / f'{variant}-receipt.json').write_text(json.dumps(receipt, indent=2))
print('QUEUED', variant, receipt['prompt_id'], flush=True)
while True:
    with urllib.request.urlopen(base + '/history/' + receipt['prompt_id'], timeout=30) as response:
        history = json.load(response).get(receipt['prompt_id'])
    if history:
        break
    time.sleep(3)
for _, message in history['status']['messages']:
    if isinstance(message, dict):
        message.pop('current_inputs', None)
        message.pop('current_outputs', None)
(root / f'{variant}-history.json').write_text(json.dumps(history, ensure_ascii=False, indent=2))
assert history['status']['status_str'] == 'success', history['status']
output = history['outputs']['10']['images'][0]
with urllib.request.urlopen(base + '/view?' + urllib.parse.urlencode(output), timeout=30) as response:
    (root / f'{variant}.png').write_bytes(response.read())
print('RENDERED; VISUAL REVIEW REQUIRED', variant, root / f'{variant}.png', flush=True)
