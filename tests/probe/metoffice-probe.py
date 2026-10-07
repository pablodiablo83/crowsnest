# Prints the parts of the Met Office inshore waters page the parser must handle (run in CI: the dev sandbox cannot reach it).
import re, urllib.request
U = 'https://weather.metoffice.gov.uk/specialist-forecasts/coast-and-sea/inshore-waters-forecast'
body = urllib.request.urlopen(urllib.request.Request(U, headers={'User-Agent': 'Mozilla/5.0 (CrowsNest personal marine dashboard)'}), timeout=20).read().decode('utf-8', 'replace')
def show(label, pat, n=3500):
  m = re.search(pat, body, re.S)
  print('=' * 30, label, '=' * 30); print(m.group(0)[:n] if m else 'NOT FOUND')
show('TIMES + GENERAL SITUATION', r'<div[^>]*id="sea-area-time".{0,4000}')
show('AREA 14', r'<section aria-labelledby="area14".*?</section>')
show('SHETLAND 60NM', r'<section[^>]*>\s*<h2[^>]*>For Coastal areas up to 60.*?</section>')
show('CHANNEL ISLANDS', r'<section aria-labelledby="area19".*?</section>')
print('sections:', len(re.findall(r'<section aria-labelledby="area', body)), 'warning cards:', body.count('marine-card warning'))
