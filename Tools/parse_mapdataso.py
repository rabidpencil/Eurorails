"""Parse raw MapDataSO bytes (Unity 2022.3 serialization) using the class layout from Assembly-CSharp."""
import struct, json, sys

class R:
    def __init__(s, b): s.b, s.p = b, 0
    def align(s): s.p = (s.p + 3) & ~3
    def i32(s): v = struct.unpack_from('<i', s.b, s.p)[0]; s.p += 4; return v
    def i64(s): v = struct.unpack_from('<q', s.b, s.p)[0]; s.p += 8; return v
    def f32(s): v = struct.unpack_from('<f', s.b, s.p)[0]; s.p += 4; return v
    def boolean(s): v = s.b[s.p]; assert v in (0, 1), (s.p, v); s.p += 1; s.align(); return bool(v)
    def string(s):
        n = s.i32(); assert 0 <= n < 100000, (s.p, n)
        v = s.b[s.p:s.p + n].decode('utf-8'); s.p += n; s.align(); return v
    def lst(s, fn):
        n = s.i32(); assert 0 <= n < 200000, (s.p, n)
        out = [fn(s) for _ in range(n)]; s.align(); return out
    def pptr(s): return (s.i32(), s.i64())

def ref(r): return {"x": r.i32(), "y": r.i32()}
def water(r): return {"AdjacentNode": ref(r), "Type": r.i32(), "RiverGUID": r.string()}
def node(r): return {"Type": r.i32(), "x": r.i32(), "y": r.i32(), "WaterCrossings": r.lst(water)}
def river(r): return {"GUID": r.string(), "Name": r.string()}
def resource(r): return {"GUID": r.string(), "Name": r.string(), "Type": r.i32(), "QuantityAllowed": r.i32()}
def demand(r): return {"CityGUID": r.string(), "ResourceGUID": r.string(), "Value": r.i32()}
def dcard(r): return {"guid": r.string(), "Demand1": demand(r), "Demand2": demand(r), "Demand3": demand(r), "publisherCardID": r.i32()}
def impact(r): return {"GUID": r.string(), "EventImpactTypeGuid": r.string(), "ImpactNode": ref(r), "RiverGUID": r.string(),
                       **{k: r.boolean() for k in ["DisableMovement", "HalfMovement", "DisableFerryCrossing", "DisableBuilding",
                                                   "DisablePickup", "DisableDelivery", "LoadLoss", "TurnLoss"]}}
def ecard(r): return {"guid": r.string(), "publisherCardID": r.i32(), "Name": r.string(), "SafeName": r.string(),
                      "Description": r.string(), "HoverText": r.string(), "Duration": r.i32(), "Impacts": r.lst(impact)}
def etype(r): return {"GUID": r.string(), "Name": r.string(), "SafeName": r.string()}
def city(r): return {"GUID": r.string(), "Name": r.string(), "NameOffsetX": r.f32(), "NameOffsetY": r.f32(),
                     "ShowCityName": r.boolean(), "KeyCityInverted": r.boolean(), "Resources": r.lst(lambda r: r.string()),
                     "MapData": r.lst(ref), "MainNode": ref(r), "IsAlsoConnectionPort": r.boolean()}
def route(r): return {"City1GUID": r.string(), "City2GUID": r.string(), "Cost": r.i32(), "CostPositionOffset": r.f32(),
                      "AllowedConnections": r.i32(), "MovementCost": r.i32(), "Type": r.i32()}

def parse(b):
    r = R(b)
    hdr = {"m_GameObject": r.pptr(), "m_Enabled": r.boolean(), "m_Script": r.pptr(), "m_Name": r.string()}
    d = {"_header": hdr, "SchemaVersion": r.i32()}
    for name, fn in [("Nodes", node), ("Rivers", river), ("Resources", resource), ("DemandCards", dcard),
                     ("EventCards", ecard), ("EventImpactTypes", etype), ("Cities", city), ("ConnectionRoutes", route)]:
        start = r.p
        d[name] = r.lst(fn)
        print(f"  {name}: {len(d[name])} items, bytes {start}-{r.p}", file=sys.stderr)
    d["_trailing_bytes"] = len(b) - r.p
    return d

if __name__ == "__main__":
    for path in sys.argv[1:]:
        print(path, file=sys.stderr)
        d = parse(open(path, "rb").read())
        print("  name:", d["_header"]["m_Name"], "schema:", d["SchemaVersion"], "trailing:", d["_trailing_bytes"], file=sys.stderr)
        json.dump(d, open(path.rsplit(".", 1)[0] + ".json", "w"), indent=1, ensure_ascii=False)
