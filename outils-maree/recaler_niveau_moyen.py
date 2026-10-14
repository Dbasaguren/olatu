import json, sys, numpy as np
from datetime import datetime, timezone
rows=json.load(open(sys.argv[1])); C=json.load(open(sys.argv[2]))
EP=datetime(2000,1,1,tzinfo=timezone.utc).timestamp()
r=[( (datetime.strptime(a,"%Y/%m/%d %H:%M:%S").replace(tzinfo=timezone.utc).timestamp()-EP)/3600, v) for a,v in rows if a>="2024/07/01"]
h=np.array([x for x,_ in r]); o=np.array([v for _,v in r])
pr=C['z0']+C['trend_m_per_year']*h/8766+sum(a*np.cos(np.deg2rad(w*h-ph)) for n,w,a,ph in C['cons'])
off=float(np.mean(o-pr)); print("décalage niveau moyen récent: %+.3f m (n=%d)"%(off,len(h)))
# niveau moyen récent recalé : on fige la tendance à partir de la moyenne des 2 dernières années
C['z0']=round(C['z0']+off,4); C['note_z0']="z0 recale sur le niveau moyen observe 07/2024-2026"
json.dump(C,open(sys.argv[2],'w'),ensure_ascii=False)
print("z0 =",C['z0'])
