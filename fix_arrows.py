import io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

with open('src/App.vue', 'rb') as f:
    raw = f.read()

# The corrupted character \ufffd (replacement char in utf-8 is EF BF BD)
# followed by </span> -- this is the broken acc-arrow content
# Replace EF BF BD 3C 2F 73 70 61 6E with E2 80 BA 3C 2F 73 70 61 6E
# (› = E2 80 BA, </span = 3C 2F 73 70 61 6E)

broken = b'\xef\xbf\xbd</span>'
fixed  = '›</span>'.encode('utf-8')

count = raw.count(broken)
print(f"Found {count} corrupted acc-arrow spans")

raw_fixed = raw.replace(broken, fixed)

with open('src/App.vue', 'wb') as f:
    f.write(raw_fixed)

print("Done!")
