import io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
content = open('src/App.vue', encoding='utf-8').read()

# Find keywordBlocklistPlc for zh-CN
idx = content.find('keywordBlocklistPlc')
print(repr(content[idx:idx+120]))
print('---')
idx3 = content.find('recvLangConfig')
print('recvLangConfig at:', idx3)
print(repr(content[idx3:idx3+80]))
