import json, sys, os, urllib.request, calendar
from concurrent.futures import ThreadPoolExecutor
out = sys.argv[1]; SID = sys.argv[2]
def get(ym):
    y, m = ym
    last = calendar.monthrange(y, m)[1]
    u = f"https://services.data.shom.fr/maregraphie/observation/json/{SID}?sources=4&dtStart={y}-{m:02d}-01T00:00:00Z&dtEnd={y}-{m:02d}-{last}T23:59:59Z"
    for _ in range(3):
        try:
            d = json.load(urllib.request.urlopen(u, timeout=60))['data']
            return ym, [(r['timestamp'], r['value']) for r in d]
        except Exception as e:
            err = e
    return ym, None
months = [(y, m) for y in range(2000, 2027) for m in range(1, 13)]
allrows, missing = [], []
with ThreadPoolExecutor(6) as ex:
    for ym, rows in ex.map(get, months):
        if rows is None: missing.append(ym)
        else: allrows += rows
allrows = sorted(set(allrows))
json.dump(allrows, open(out, 'w'))
from collections import Counter
c = Counter(t[:4] for t, _ in allrows)
print('total', len(allrows), 'failed', missing)
print(' '.join(f"{y}:{c.get(str(y),0)}" for y in range(2000, 2027)))
