import json, sys, numpy as np, urllib.request
from datetime import datetime, timezone
rows=json.load(open(sys.argv[1])); C=json.load(open(sys.argv[2]))
EP=datetime(2000,1,1,tzinfo=timezone.utc).timestamp()
obs={round((datetime.strptime(a,"%Y/%m/%d %H:%M:%S").replace(tzinfo=timezone.utc).timestamp()-EP)/3600):v for a,v in rows if a>="2025/01/01"}
u="https://archive-api.open-meteo.com/v1/archive?latitude=43.395&longitude=-1.682&start_date=2025-01-01&end_date=2026-06-30&hourly=pressure_msl&timezone=GMT"
d=json.load(urllib.request.urlopen(u,timeout=120))
P={round((datetime.fromisoformat(tm).replace(tzinfo=timezone.utc).timestamp()-EP)/3600):p for tm,p in zip(d['hourly']['time'],d['hourly']['pressure_msl']) if p is not None}
def tide(h):
    s=C['z0']+C['trend_m_per_year']*h/8766
    for n,w,a,ph in C['cons']: s+=a*np.cos(np.deg2rad(w*h-ph))
    return s
ks=sorted(k for k in obs if k in P)
h=np.array(ks,float); o=np.array([obs[k] for k in ks]); p=np.array([P[k] for k in ks]); pr=tide(h)
r=o-pr; ib=(1013.25-p)*0.01
print("n",len(ks))
print("RMS marée seule   : %.3f m"%np.sqrt(np.mean(r**2)))
print("RMS + baromètre   : %.3f m"%np.sqrt(np.mean((r-ib)**2)))
k=np.polyfit(ib,r,1); print("régression résidu = %.2f*IB + %.3f"%tuple(k))
print("RMS + baro ajusté : %.3f m"%np.sqrt(np.mean((r-np.polyval(k,ib))**2)))
big=np.abs(ib)>0.15
print("jours de forte dépression/anticyclone (|IB|>15cm, n=%d): RMS %.3f -> %.3f"%(big.sum(),np.sqrt(np.mean(r[big]**2)),np.sqrt(np.mean((r-ib)[big]**2))))
