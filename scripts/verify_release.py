"""Independent stdlib ZIP verification; reads only explicitly named project artifacts."""
import hashlib
import json
import pathlib
import zipfile

root = pathlib.Path(__file__).resolve().parents[1]
releases = root / 'releases'
files = ['evidence-anchor-0.1.0.zip', 'evidence-anchor-demo-vault-0.1.0.zip']
checksums = dict(line.split('  ', 1)[::-1] for line in (releases / 'SHA256SUMS.txt').read_text().splitlines())
results = []
for filename in files:
    artifact = releases / filename
    digest = hashlib.sha256(artifact.read_bytes()).hexdigest()
    assert digest == checksums[filename]
    with zipfile.ZipFile(artifact) as archive:
        assert archive.testzip() is None, 'ZIP CRC mismatch'
        assert len(archive.namelist()) == len(set(archive.namelist()))
        for name in archive.namelist():
            path = pathlib.PurePosixPath(name)
            assert not path.is_absolute() and '..' not in path.parts and '\\' not in name
            assert '.private.' not in name and 'privateinventory' not in name and 'node_modules' not in name
        base = ('evidence-anchor/' if filename == files[0] else
                'evidence-anchor-demo/.obsidian/plugins/evidence-anchor/')
        assert archive.read(base + 'main.js') == (root / 'main.js').read_bytes()
        manifest = json.loads(archive.read(base + 'manifest.json'))
        assert manifest['id'] == 'evidence-anchor' and manifest['version'] == '0.1.0'
        if filename == files[1]:
            store = json.loads(archive.read(base + 'data.json'))
            assert store['schema'] == 1 and len(store['anchors']) == 1
            assert store['anchors'][0]['quote'] == 'The measured value is 42 ± 2 units.'
        results.append({'artifact': filename, 'sha256': digest, 'entries': len(archive.namelist()),
                        'crc': 'pass', 'paths': 'safe', 'packagedPluginMatchesBuild': True})
report = {'command': 'python scripts/verify_release.py', 'results': results,
          'scope': 'Independent ZIP CRC, path safety, SHA-256, manifest and bundled-plugin equality; not an Obsidian host test.'}
(releases / 'package-verification.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
