import subprocess, sys, io, json, re
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

OLD = '1.0.10'
NEW = '1.0.11'

# 1. package.json
with open('package.json', 'rb') as f:
    raw = f.read()
content = raw.decode('utf-8')
content = content.replace(f'"version": "{OLD}"', f'"version": "{NEW}"')
with open('package.json', 'wb') as f:
    f.write(content.encode('utf-8'))
print('package.json done')

# 2. src-tauri/tauri.conf.json
with open('src-tauri/tauri.conf.json', 'rb') as f:
    raw = f.read()
content = raw.decode('utf-8')
content = content.replace(f'"version": "{OLD}"', f'"version": "{NEW}"')
with open('src-tauri/tauri.conf.json', 'wb') as f:
    f.write(content.encode('utf-8'))
print('tauri.conf.json done')

# 3. src-tauri/Cargo.toml
with open('src-tauri/Cargo.toml', 'rb') as f:
    raw = f.read()
content = raw.decode('utf-8')
content = content.replace(f'version = "{OLD}"', f'version = "{NEW}"', 1)
with open('src-tauri/Cargo.toml', 'wb') as f:
    f.write(content.encode('utf-8'))
print('Cargo.toml done')

print(f'All bumped to {NEW}!')
