import io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

with open('src/App.vue', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Add secTranslation/secFilter/secAppearance to zh-CN bundle
old_zh = '''    keywordBlocklistPlc: "每行一个关键词，例如：\\nis offline\\n離開該區域",
  },'''
new_zh = '''    keywordBlocklistPlc: "每行一个关键词，例如：\\nis offline\\n離開該區域",
    secTranslation: "翻译参数",
    secFilter: "过滤规则",
    secAppearance: "界面外观",
  },'''

if old_zh in content:
    content = content.replace(old_zh, new_zh)
    print("zh-CN keys added")
else:
    print("ERROR: zh-CN pattern not found")

# 2. Add secTranslation/secFilter/secAppearance to en-US bundle
old_en = '''    keywordBlocklistPlc: "One keyword per line, e.g.:\\nis offline\\n離開該區域",
  }'''
new_en = '''    keywordBlocklistPlc: "One keyword per line, e.g.:\\nis offline\\n離開該區域",
    secTranslation: "Translation",
    secFilter: "Filters",
    secAppearance: "Appearance",
  }'''

if old_en in content:
    content = content.replace(old_en, new_en)
    print("en-US keys added")
else:
    print("ERROR: en-US pattern not found")

# 3. Fix the translate accordion header (remove fragile .split())
old_translate_header = '''              <span>{{ i18n.recvLangConfig.split('，')[0] || 'Translation' }}</span>'''
new_translate_header = '''              <span>{{ i18n.secTranslation }}</span>'''

if old_translate_header in content:
    content = content.replace(old_translate_header, new_translate_header)
    print("translate header fixed")
else:
    print("ERROR: translate header not found")

# 4. Fix filter accordion header
old_filter_header = '''              <span>{{ i18n.nearbyWhitelistLabel }}</span>'''
new_filter_header = '''              <span>{{ i18n.secFilter }}</span>'''

if old_filter_header in content:
    content = content.replace(old_filter_header, new_filter_header)
    print("filter header fixed")
else:
    print("ERROR: filter header not found")

# 5. Fix appearance accordion header
old_appear_header = '''              <span>{{ i18n.uiLangLabel }} &amp; {{ i18n.windowOpacityLabel }}</span>'''
new_appear_header = '''              <span>{{ i18n.secAppearance }}</span>'''

if old_appear_header in content:
    content = content.replace(old_appear_header, new_appear_header)
    print("appearance header fixed")
else:
    print("ERROR: appearance header not found")

with open('src/App.vue', 'w', encoding='utf-8', newline='\r\n') as f:
    f.write(content)

print("All done!")
