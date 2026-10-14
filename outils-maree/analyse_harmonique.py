import json, sys, numpy as np
from datetime import datetime, timezone
rows = json.load(open(sys.argv[1]))
EPOCH = datetime(2000,1,1,tzinfo=timezone.utc).timestamp()
t = np.array([(datetime.strptime(a,"%Y/%m/%d %H:%M:%S").replace(tzinfo=timezone.utc).timestamp()-EPOCH)/3600 for a,_ in rows])
z = np.array([v for _,v in rows])
# Vitesses angulaires des arguments de Doodson (deg/h) : tau, s, h, p, N', p1
R = np.array([14.4920521, 0.5490165, 0.0410686, 0.0046418, 0.0022064, 0.0000020])
BASE = {
 "Sa":(0,0,1,0,0,-1),"Ssa":(0,0,2,0,0,0),"Mm":(0,1,0,-1,0,0),"Msf":(0,2,-2,0,0,0),"Mf":(0,2,0,0,0,0),
 "2Q1":(1,-3,0,2,0,0),"sig1":(1,-3,2,0,0,0),"Q1":(1,-2,0,1,0,0),"rho1":(1,-2,2,-1,0,0),"O1":(1,-1,0,0,0,0),
 "NO1":(1,0,0,1,0,0),"pi1":(1,1,-3,0,0,1),"P1":(1,1,-2,0,0,0),"S1":(1,1,-1,0,0,1),"K1":(1,1,0,0,0,0),
 "psi1":(1,1,1,0,0,-1),"phi1":(1,1,2,0,0,0),"J1":(1,2,0,-1,0,0),"OO1":(1,3,0,0,0,0),
 "eps2":(2,-3,2,1,0,0),"2N2":(2,-2,0,2,0,0),"mu2":(2,-2,2,0,0,0),"N2":(2,-1,0,1,0,0),"nu2":(2,-1,2,-1,0,0),
 "M2":(2,0,0,0,0,0),"lam2":(2,1,-2,1,0,0),"L2":(2,1,0,-1,0,0),"T2":(2,2,-3,0,0,1),"S2":(2,2,-2,0,0,0),
 "R2":(2,2,-1,0,0,-1),"K2":(2,2,0,0,0,0),"eta2":(2,3,0,-1,0,0),"2SM2":(2,4,-4,0,0,0),"MSN2":(2,3,-2,-1,0,0),
 "MO3":(3,-1,0,0,0,0),"M3":(3,0,0,0,0,0),"SO3":(3,1,-2,0,0,0),"MK3":(3,1,0,0,0,0),"SK3":(3,3,-2,0,0,0),
 "MN4":(4,-1,0,1,0,0),"M4":(4,0,0,0,0,0),"SN4":(4,1,-2,1,0,0),"MS4":(4,2,-2,0,0,0),"MK4":(4,2,0,0,0,0),"S4":(4,4,-4,0,0,0),
 "2MN6":(6,-1,0,1,0,0),"M6":(6,0,0,0,0,0),"MSN6":(6,1,-2,1,0,0),"2MS6":(6,2,-2,0,0,0),"2MK6":(6,2,0,0,0,0),"2SM6":(6,4,-4,0,0,0),
 "3MN8":(8,-1,0,1,0,0),"M8":(8,0,0,0,0,0),"3MS8":(8,2,-2,0,0,0),
}
# Satellites nodaux (cycle de 18,6 ans) ajustés explicitement : pas besoin de facteurs nodaux approchés
NODAL = ["Mm","Mf","Q1","O1","K1","J1","OO1","2N2","mu2","N2","nu2","M2","L2","K2","MO3","MK3","MN4","M4","MS4","MK4","2MN6","M6","2MS6"]
CONS = {}
for k,d in BASE.items():
    CONS[k]=d
    if k in NODAL:
        for e in (-1,1):
            dd=list(d); dd[4]+=e; CONS[f"{k}{'+' if e>0 else '-'}N"]=tuple(dd)
names = list(CONS); w = np.array([np.dot(CONS[n],R) for n in names])  # deg/h

def design(tt):
    cols=[np.ones_like(tt), tt/8766.0]
    for om in w:
        a=np.deg2rad(om)*tt; cols+= [np.cos(a), np.sin(a)]
    return np.column_stack(cols)

def fit(mask):
    A=design(t[mask]); x,*_=np.linalg.lstsq(A,z[mask],rcond=None); return x
def predict(x,tt): return design(tt)@x

yr = 2000+t/8766
test = yr>=2025
x = fit(~test)
res = z[test]-predict(x,t[test])
print("Validation 2025-2026 (non utilisées pour l'ajustement): RMS obs - prédiction = %.3f m, 95%% < %.3f m" % (np.sqrt(np.mean(res**2)), np.percentile(np.abs(res),95)))
# Comparaison des pleines/basses mers prédites et observées (sur données horaires, interpolation parabolique)
def ext(tt,zz):
    out=[]
    for i in range(1,len(zz)-1):
        if tt[i+1]-tt[i-1]!=2: continue
        a,b,c=zz[i-1],zz[i],zz[i+1]
        if (b>a and b>=c) or (b<a and b<=c):
            den=a-2*b+c; o=0.5*(a-c)/den if den else 0
            out.append((tt[i]+o, b-0.25*(a-c)*o, b>a))
    return out
tt=t[test]; fine=np.arange(tt[0],tt[-1],1/60)
pz=predict(x,fine)
pe=[]
for i in range(1,len(pz)-1):
    if (pz[i]>pz[i-1] and pz[i]>=pz[i+1]) or (pz[i]<pz[i-1] and pz[i]<=pz[i+1]): pe.append((fine[i],pz[i],pz[i]>pz[i-1]))
oe=ext(tt,z[test]); pe=np.array(pe); dt=[];dh=[]
for (ot,oh,hi) in oe:
    j=np.argmin(np.abs(pe[:,0]-ot))
    if abs(pe[j,0]-ot)<2 and bool(pe[j,2])==hi: dt.append((pe[j,0]-ot)*60); dh.append(pe[j,1]-oh)
dt=np.array(dt); dh=np.array(dh)
print("PM/BM comparées: %d ; écart heure médian %.0f min, 80%% < %.0f min ; écart hauteur médian %.2f m, 80%% < %.2f m" % (len(dt), np.median(np.abs(dt)), np.percentile(np.abs(dt),80), np.median(np.abs(dh)), np.percentile(np.abs(dh),80)))
# Ajustement final sur toutes les données
x = fit(np.ones_like(t,bool))
amp = np.hypot(x[2::2],x[3::2]); ph = np.rad2deg(np.arctan2(x[3::2],x[2::2]))%360
order=np.argsort(-amp)
print("Z0 (2000) = %.3f m, tendance = %.1f mm/an" % (x[0], x[1]*1000))
for i in order[:12]: print(f"  {names[i]:8s} {w[i]:10.6f} deg/h  A={amp[i]:.4f} m  phi={ph[i]:.1f}")
keep=[i for i in order if amp[i]>=0.002]
out={"station":"Socoa (Saint-Jean-de-Luz), SHOM id 95","source":"REFMAR / data.shom.fr, Licence Ouverte 2.0 - DOI 10.17183/REFMAR","datum":"zero hydrographique","epoch":"2000-01-01T00:00Z (heures, UTC)",
     "z0":round(float(x[0]),4),"trend_m_per_year":round(float(x[1]),5),
     "cons":[[names[i],round(float(w[i]),7),round(float(amp[i]),4),round(float(ph[i]),2)] for i in keep]}
json.dump(out,open(sys.argv[2],"w"),ensure_ascii=False)
print("constituants retenus:",len(keep))
