import sys
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

with open('src/App.vue', 'r', encoding='utf-8', errors='replace') as f:
    lines = f.readlines()

print(f"Total lines: {len(lines)}")

new_lines = []
for i, line in enumerate(lines):
    # Remove the stray wrapper closing div
    if 'chat wrapper v-show' in line:
        print(f"Removing line {i+1}: {line.rstrip()}")
        continue
    new_lines.append(line)

print(f"New line count: {len(new_lines)}")

with open('src/App.vue', 'w', encoding='utf-8', newline='') as f:
    f.writelines(new_lines)

print("Done!")
