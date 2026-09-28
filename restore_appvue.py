import subprocess, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

# Get the file content from git as raw bytes
result = subprocess.run(['git', 'show', 'f92ce86:src/App.vue'], capture_output=True)
raw = result.stdout

print(f'Git raw bytes: {len(raw)}')
print(f'BOM: {raw[:3].hex()}')
print(f'Replacement chars in git: {raw.count(bytes([0xef,0xbf,0xbd]))}')

# Write to file as-is (git stores UTF-8 without BOM)
with open('src/App.vue', 'wb') as f:
    f.write(raw)

print('Written! Verifying...')
with open('src/App.vue', 'rb') as f:
    check = f.read()
print(f'File size: {len(check)}')
print(f'Replacement chars in file: {check.count(bytes([0xef,0xbf,0xbd]))}')

# Verify it reads as valid utf-8
text = check.decode('utf-8')
print(f'Valid UTF-8, chars: {len(text)}')
print('First 100 chars:', repr(text[:100]))
