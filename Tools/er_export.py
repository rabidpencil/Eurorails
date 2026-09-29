"""
er_export.py - build the Eurorails data files from the game's own map asset.

    python er_export.py <MapDataSO .bin or parsed .json> [save.json] [outdir]

Input : the 'games/europe/maps/map' MapDataSO (resources.assets path_id 19462),
        either the raw .bin or the .json written by parse_mapdataso.py.
        Optional: a checkpoint save, used only for the rule set and a cost self-test.
Output (same layout as the Empire Builder repo):
    Map/er-map.json            full clean board: nodes, crossings, rivers, cities, ports, connections
    Map/er-cities.json         the 60 cities in the EB cities format  {cities:[{cell,name,type,loads,key}]}
    Cards/er-demand-cards.json EB card format  {"1":[{city,payout,load},...], ...}
    Cards/er-event-cards.json  22 event cards with their affected mileposts / river
    Tools/er-plan-graph.json   planner graph (EB format + extensions, see 'note' inside)
    Tools/er-rules.json        rule constants
Coordinates are the game's own (x, y): rows are horizontal, y increases northward,
odd rows are shifted half a step east.
"""
import json, os, sys, unicodedata
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

NODE_TYPES = {0: "ocean", 1: "clear", 2: "mountain", 3: "alpine", 4: "small", 5: "medium",
              6: "major", 7: "ferryport", 8: "chunnelport", 9: "keycity"}
WATER_TYPES = {0: "river", 1: "lake", 2: "inlet"}
WATER_COST = {0: 2, 1: 3, 2: 3}                      # MapNodeData.GetWaterCrossingCost
TERRAIN_COST = {1: 1, 2: 2, 3: 5}                    # Node.GetBuildCost fallthrough
EDGE_NORMAL, EDGE_FERRY, EDGE_CHUNNEL, EDGE_MAJOR = 0, 1, 2, 3


def norm(s):  # identical to core.js norm()
    s = unicodedata.normalize("NFKD", s)
    s = "".join(ch for ch in s if not unicodedata.combining(ch)).lower()
    return "".join(ch for ch in s if ch.isalnum())


def neighbours(x, y):
    s = 1 if y % 2 else -1                          # odd rows shifted east
    return [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1), (x + s, y + 1), (x + s, y - 1)]


def load_map(path):
    if path.endswith(".json"):
        return json.load(open(path, encoding="utf-8"))
    from parse_mapdataso import parse
    return parse(open(path, "rb").read())


def main():
    src = sys.argv[1]
    save = json.load(open(sys.argv[2], encoding="utf-8")) if len(sys.argv) > 2 and sys.argv[2] != "-" else None
    out = sys.argv[3] if len(sys.argv) > 3 else "."
    for d in ("Map", "Cards", "Tools"):
        os.makedirs(os.path.join(out, d), exist_ok=True)
    M = load_map(src)

    N = {(n["x"], n["y"]): n for n in M["Nodes"]}
    res = {r["GUID"]: r for r in M["Resources"]}
    rivers = {r["GUID"]: r["Name"] for r in M["Rivers"]}
    cg = {c["GUID"]: c for c in M["Cities"]}
    mk = lambda r: (r["x"], r["y"])

    # ---------- ports & connections ----------
    port_route = {}                                   # port cell -> route
    connections = []
    for r in M["ConnectionRoutes"]:
        a, b = cg[r["City1GUID"]], cg[r["City2GUID"]]
        kind = "chunnel" if r["Type"] == 1 else "ferry"
        connections.append({"kind": kind, "a": a["Name"], "b": b["Name"],
                            "a_cell": list(mk(a["MainNode"])), "b_cell": list(mk(b["MainNode"])),
                            "cost": r["Cost"], "movement_cost": r["MovementCost"],
                            "allowed_connections": r["AllowedConnections"]})
        port_route[mk(a["MainNode"])] = port_route[mk(b["MainNode"])] = (r, kind)

    # ---------- cities ----------
    real_cities, ports, city_cells = [], [], {}
    for c in M["Cities"]:
        cell = mk(c["MainNode"])
        t = N[cell]["Type"]
        if t in (7, 8):
            ports.append({"name": c["Name"], "cell": list(cell), "kind": NODE_TYPES[t]})
            continue
        foot = sorted({mk(m) for m in c["MapData"]})
        entry = {"cell": list(cell), "name": c["Name"], "type": NODE_TYPES[t],
                 "loads": sorted(res[g]["Name"].lower() for g in c["Resources"]), "key": norm(c["Name"])}
        if foot:
            entry["footprint"] = [list(k) for k in foot]
        if c["IsAlsoConnectionPort"]:
            entry["also_port"] = True
        real_cities.append(entry)
        for k in [cell] + foot:
            city_cells[k] = (c, cell, t)
    assert len({c["key"] for c in real_cities}) == len(real_cities), "duplicate city keys"

    # ---------- node build cost (cost of building INTO the node), mirrors Node.GetBuildCost ----------
    def node_cost(k):
        if k in port_route:
            return port_route[k][0]["Cost"]            # connection cost replaces everything
        if k in city_cells:
            _, _, t = city_cells[k]
            return 5 if t == 6 else 3                  # major 5; small/medium/keycity 3
        return TERRAIN_COST.get(N[k]["Type"], 1)

    def water(dst, src):                              # the game only checks the destination's list
        for w in N[dst]["WaterCrossings"]:
            if mk(w["AdjacentNode"]) == src:
                return w
        return None

    land = [k for k, n in N.items() if n["Type"] != 0]
    land.sort(key=lambda k: (k[1], k[0]))
    IX = {k: i for i, k in enumerate(land)}

    edges, crossings, asym, port_water = [], [], [], []
    for k in land:
        for k2 in neighbours(*k):
            if k2 not in IX or IX[k2] < IX[k]:
                continue
            w1, w2 = water(k2, k), water(k, k2)
            if (w1 is None) != (w2 is None):
                asym.append([list(k), list(k2)])
            w = w1 or w2
            same_major = (k in city_cells and k2 in city_cells and city_cells[k][1] == city_cells[k2][1]
                          and city_cells[k][2] == 6)
            if same_major:
                edges.append([IX[k], IX[k2], -5, EDGE_MAJOR])   # pre-built: 5 - 5 = 0 either way
                continue
            s = WATER_COST[w["Type"]] if w else 0
            if s and (k in port_route or k2 in port_route):
                port_water.append([list(k), list(k2)])        # connection cost ignores water on entry
            edges.append([IX[k], IX[k2], s, EDGE_NORMAL])
            if w:
                crossings.append([k[0], k[1], k2[0], k2[1], WATER_TYPES[w["Type"]], rivers.get(w["RiverGUID"], "")])
    for r in M["ConnectionRoutes"]:
        a, b = mk(cg[r["City1GUID"]]["MainNode"]), mk(cg[r["City2GUID"]]["MainNode"])
        # entering the first port pays the whole route; crossing to the other end is free
        edges.append([IX[a], IX[b], -r["Cost"], EDGE_CHUNNEL if r["Type"] == 1 else EDGE_FERRY])

    cost = [node_cost(k) for k in land]
    maxy = max(k[1] for k in land)
    xy = [[round(k[0] + 0.5 * (k[1] % 2), 3), round((maxy - k[1]) * 0.8725, 4)] for k in land]
    city_map = {c["key"]: IX[tuple(c["cell"])] for c in real_cities}
    graph = {
        "cells": [list(k) for k in land], "cost": cost, "edges": edges, "city": city_map, "xy": xy,
        "majors": {c["key"]: [IX[tuple(c["cell"])]] + [IX[tuple(f)] for f in c.get("footprint", [])]
                   for c in real_cities if c["type"] == "major"},
        "ports": [{"name": p["name"], "kind": p["kind"], "node": IX[tuple(p["cell"])]} for p in ports],
        "note": ("Undirected edges [u,v,surcharge,kind]. Building into v costs cost[v]+surcharge (same as the EB graph). "
                 "kind 0 normal, 1 ferry, 2 chunnel, 3 inside a major city. Ferry/chunnel and major-internal edges carry a "
                 "negative surcharge that cancels cost[v], so they cost 0 to cross after paying to enter. Movement is 1 per "
                 "edge EXCEPT ferries (stop at the port, next turn start from the far port at half speed) and the chunnel "
                 "(movement_cost from er-map connections). cells are game (x,y); xy is a drawing position, y down."),
    }

    # ---------- cards ----------
    cards = {}
    for c in M["DemandCards"]:
        cards[str(c["publisherCardID"])] = [
            {"city": cg[d["CityGUID"]]["Name"], "payout": d["Value"], "load": res[d["ResourceGUID"]]["Name"].lower()}
            for d in (c["Demand1"], c["Demand2"], c["Demand3"])]
    etypes = {t["GUID"]: t["Name"] for t in M["EventImpactTypes"]}
    flags = ["DisableMovement", "HalfMovement", "DisableFerryCrossing", "DisableBuilding",
             "DisablePickup", "DisableDelivery", "LoadLoss", "TurnLoss"]
    events = []
    for e in M["EventCards"]:
        imp = e["Impacts"]
        nodes = sorted({mk(i["ImpactNode"]) for i in imp if not i["RiverGUID"]})
        rv = sorted({rivers[i["RiverGUID"]] for i in imp if i["RiverGUID"]})
        events.append({
            "number": e["publisherCardID"], "name": e["Name"], "description": e["Description"].replace("\r", ""),
            "duration": ["permanent", "temporary", "one_turn", "one_player"][e["Duration"]],
            "types": sorted({etypes.get(i["EventImpactTypeGuid"], "?") for i in imp}),
            "effects": [f for f in flags if any(i[f] for i in imp)],
            "rivers": rv, "cells": [list(k) for k in nodes]})

    # ---------- full map file ----------
    er_map = {
        "source": "Empire Builder - Europe (Steam), resources.assets MapDataSO 'games/europe/maps/map'",
        "frame": "game (x,y); y increases north; odd rows shifted +0.5 east; row spacing 0.8725 of column spacing",
        "nodes": [{"cell": list(k), "type": NODE_TYPES[N[k]["Type"]]} for k in land],
        "crossings": crossings,
        "one_sided_crossings": asym,
        "rivers": sorted(rivers.values()),
        "cities": real_cities, "ports": ports, "connections": connections,
        "goods": [{"name": r["Name"].lower(), "chips": r["QuantityAllowed"]} for r in M["Resources"]],
    }

    rules = {
        "from_save_ruleset": save["RuleSet"] if save else None,
        "build_cost": {"clear": 1, "mountain": 2, "alpine": 5, "small": 3, "medium": 3, "major_entry": 5,
                       "inside_major": 0, "river": 2, "lake": 3, "inlet": 3,
                       "ferry_or_chunnel": "route cost, paid on entering either port; replaces terrain and water"},
        "locomotives": {"0": {"speed": 9}, "1": {"speed": 12}, "2": {"speed": 9}, "3": {"speed": 12},
                        "upgrade_speed": {"0": 1, "2": 3},
                        "half_speed": "(speed+1)//2",
                        "note": "speeds from Locomotive.get_Speed; capacities not yet read from game data "
                                "(standard rules: 0 Freight 2 loads, 1 Fast Freight 2, 2 Heavy Freight 3, 3 Superfreight 3)"},
        "movement": {"per_milepost": 1, "event_half_rate": 2, "event_blocked": 1000},
        "source": "Assembly-CSharp.dll: Node.GetBuildCost, MapNodeData.GetWaterCrossingCost, Node.GetMovementCost, Locomotive",
    }

    W = lambda p, o: json.dump(o, open(os.path.join(out, p), "w", encoding="utf-8"), ensure_ascii=False,
                               indent=None if p.endswith("graph.json") else 1,
                               separators=(",", ":") if p.endswith("graph.json") else None)
    W("Map/er-map.json", er_map)
    W("Map/er-cities.json", {"frame": er_map["frame"], "cities": real_cities})
    W("Cards/er-demand-cards.json", cards)
    W("Cards/er-event-cards.json", events)
    W("Tools/er-plan-graph.json", graph)
    W("Tools/er-rules.json", rules)

    # ---------- report ----------
    tc = Counter(NODE_TYPES[N[k]["Type"]] for k in land)
    print(f"land nodes {len(land)} {dict(tc)}")
    print(f"edges {len(edges)}  (crossings {len(crossings)}, one-sided {len(asym)}, water next to a port {len(port_water)})")
    print(f"cities {len(real_cities)} (majors {sum(c['type']=='major' for c in real_cities)}), ports {len(ports)}, "
          f"connections {len(connections)}, cards {len(cards)}, events {len(events)}")

    # connectivity: every city reachable from Paris
    adj = {i: [] for i in range(len(land))}
    for u, v, s, kd in edges:
        adj[u].append(v); adj[v].append(u)
    seen, st = {city_map["paris"]}, [city_map["paris"]]
    while st:
        u = st.pop()
        for v in adj[u]:
            if v not in seen:
                seen.add(v); st.append(v)
    print("cities unreachable from Paris:", [k for k, i in city_map.items() if i not in seen] or "none")

    # self-test: price the track in the save with the graph's own weights
    if save:
        emap = {}
        for u, v, s, kd in edges:
            emap[(u, v)] = emap[(v, u)] = s
        tot = 0
        for seg in save["Track"]:
            a, b = IX[mk(seg["MapNodeData1"])], IX[mk(seg["MapNodeData2"])]
            tot += cost[b] + emap[(a, b)]
        spent = next((s["Value"]["IntValue"] for s in save["PlayerStats"]["Stats"] if s["StatType"] == 0), None)
        print(f"save self-test: graph prices the saved track at {tot}; save stat 0 (money spent) is {spent}")


if __name__ == "__main__":
    main()
