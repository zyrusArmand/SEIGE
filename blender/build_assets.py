"""
Bat Siege - procedural asset builder for Blender 4.2 LTS (works on 4.0+).

Builds every 3D model in the game from code and exports each one as a .glb
that Three.js (or any glTF engine) can load.

RUN IT (from the project root):
    blender -b -P blender/build_assets.py -- --out assets/models
Options:
    --only block_stone_body,bat_player     build just these assets
    --preview                              also render a PNG of each asset to assets/previews
    --seed 7                               change the random variation

On a Mac the Blender binary is usually:
    /Applications/Blender.app/Contents/MacOS/Blender

CONVENTIONS (the game code depends on these):
    1 Blender unit = 1 game unit (meter).
    Blender is Z-up; the glTF exporter converts to Y-up automatically.
    "Front" of every model faces Blender -Y, which becomes +Z in Three.js.
    Block pieces have their origin at bottom-center.
    Grid cell = 1.5, block footprint = 1.3, one block level = 0.8 tall.
    Castle floor top sits at height 0.24 above the castle_frame origin.
    Empties named TorchSocket_* mark flame positions so the game can add glow + flicker.
    Animated assets (bats, moth) export one looping clip covering the whole scene timeline.
"""
import bpy
import bmesh
import math
import os
import random
import sys
from mathutils import Matrix, Vector

# ---------------------------------------------------------------- arguments
ARGV = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def _arg(flag, default=None):
    if flag in ARGV:
        i = ARGV.index(flag)
        return ARGV[i + 1] if i + 1 < len(ARGV) else True
    return default


HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(_arg("--out", os.path.join(HERE, "..", "assets", "models")))
PREVIEW_DIR = os.path.abspath(os.path.join(OUT, "..", "previews"))
ONLY = _arg("--only")
ONLY = set(ONLY.split(",")) if isinstance(ONLY, str) else None
PREVIEW = "--preview" in ARGV
random.seed(int(_arg("--seed", 7)))
os.makedirs(OUT, exist_ok=True)

# ---------------------------------------------------------------- dimensions
CELL = 1.5     # grid cell spacing
BW = 1.3       # block footprint
LH = 0.8       # height of one block level
FLOOR = 0.24   # castle floor top height

# ---------------------------------------------------------------- materials


def srgb_to_lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_rgb(h):
    h = h.lstrip("#")
    return tuple(srgb_to_lin(int(h[i:i + 2], 16) / 255.0) for i in (0, 2, 4))


MATS = {}


def mat(name, hexc, rough=0.85, metal=0.0, emit=None, emit_strength=0.0, alpha=1.0, double=False):
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes.get("Principled BSDF")
    r, g, b = hex_rgb(hexc)
    p.inputs["Base Color"].default_value = (r, g, b, 1.0)
    p.inputs["Roughness"].default_value = rough
    p.inputs["Metallic"].default_value = metal
    if emit:
        er, eg, eb = hex_rgb(emit)
        key = "Emission Color" if "Emission Color" in p.inputs else "Emission"
        p.inputs[key].default_value = (er, eg, eb, 1.0)
        p.inputs["Emission Strength"].default_value = emit_strength
    if alpha < 1.0:
        p.inputs["Alpha"].default_value = alpha
        for attr, val in (("blend_method", "BLEND"), ("surface_render_method", "BLENDED")):
            try:
                setattr(m, attr, val)
            except Exception:
                pass
    m.use_backface_culling = not double
    m.diffuse_color = (r, g, b, alpha)
    MATS[name] = m
    return m


# Palette sampled from the concept art (see docs/ART_GUIDE.md)
STONE = [mat("stone_light", "#bdb8ae"), mat("stone_mid", "#a29d94"), mat("stone_dark", "#8a857d")]
MORTAR = mat("mortar", "#4a4844", rough=1.0)
SLAB = mat("slab", "#8f8b84")
FLOOR_MATS = [mat("floor_a", "#7d7a74"), mat("floor_b", "#6d6a65"), mat("floor_c", "#86827b")]
SOCKET = mat("socket", "#231d1a", rough=1.0)
WOODS = [mat("wood_a", "#d97a2b"), mat("wood_b", "#c4682a"), mat("wood_c", "#e58e40")]
WOOD_DARK = mat("wood_dark", "#5a3216")
IRON = mat("iron", "#50545c", rough=0.5, metal=0.6)
ROOF = [mat("roof_a", "#8f4a22"), mat("roof_b", "#a9572a"), mat("roof_c", "#7c3d1b")]
BONES = [mat("bone_a", "#efe6cf", rough=0.6), mat("bone_b", "#e3d7b8", rough=0.6), mat("bone_c", "#d6c8a3", rough=0.6)]
BONE_WHITE = mat("bone_white", "#f6f0e0", rough=0.5)
FLAME = mat("flame", "#ffb347", emit="#ff9a2e", emit_strength=6.0)
EMBER = mat("ember", "#ff7a2e", emit="#ff5a1a", emit_strength=3.0)
STICK = mat("stick", "#3a2616")
ROCK = mat("rock", "#8d929b", rough=0.95)
ROCK_DARK = mat("rock_dark", "#5c5f63", rough=1.0)
PINE = [mat("pine_a", "#17402a"), mat("pine_b", "#11331f"), mat("pine_c", "#1d4a31")]
TRUNK = mat("trunk", "#3a2616")
GRASS = mat("grass", "#2e5a2e")
MUD = mat("mud", "#2c3b2a", rough=1.0)
WATER = mat("water", "#1f7fa0", rough=0.1, emit="#3fd8ff", emit_strength=0.6)
MOON_REFL = mat("moon_reflection", "#fbf6e8", emit="#fff6dc", emit_strength=3.0)
GHOST = mat("ghost", "#c8b8ff", rough=0.4, emit="#7a5cff", emit_strength=1.2, alpha=0.92, double=True)
GHOST_FACE = mat("ghost_face", "#1d1240", rough=1.0)
MOTH_WING = mat("moth_wing", "#ffb347", rough=0.6, emit="#ff9a2e", emit_strength=1.5, double=True)
MOTH_PATCH = mat("moth_patch", "#ffe0a0", emit="#ffd080", emit_strength=1.0, double=True)
MOTH_SPOT = mat("moth_spot", "#8a3d12", double=True)
MOTH_BODY = mat("moth_body", "#6b3412")
TERMITE = mat("termite", "#d9452b", emit="#7a1206", emit_strength=0.6)
TERMITE_HEAD = mat("termite_head", "#9a2a16")
CLUMP = mat("clump", "#5a3418")
FANG = mat("fang", "#f4efe2", rough=0.4)

# ---------------------------------------------------------------- mesh builder


class Builder:
    """Collects many primitives into one bmesh, then becomes one object."""

    def __init__(self):
        self.bm = bmesh.new()
        self.mats = []

    def mi(self, m):
        if m not in self.mats:
            self.mats.append(m)
        return self.mats.index(m)

    def _assign(self, verts, m, smooth=False):
        idx = self.mi(m)
        faces = {f for v in verts for f in v.link_faces}
        for f in faces:
            f.material_index = idx
            f.smooth = smooth
        return faces

    @staticmethod
    def _matrix(loc, rot=None, scale=(1, 1, 1)):
        M = Matrix.Translation(Vector(loc))
        if rot is not None:
            M = M @ rot
        return M @ Matrix.Diagonal((scale[0], scale[1], scale[2], 1.0))

    def box(self, size, loc, m, bevel=0.0, rot=None, smooth=False, out=None):
        """Box. With `out` (a world direction), only the face pointing that way is bevelled and the
        opposite (hidden) face is deleted - used for wall bricks to keep the triangle count low."""
        M = self._matrix(loc, rot, size)
        verts = bmesh.ops.create_cube(self.bm, size=1.0, matrix=M)["verts"]
        faces = self._assign(verts, m, smooth)
        bevel = min(bevel, min(size) * 0.3)
        hidden = None
        if out is not None:
            out = Vector(out)
            for f in faces:
                f.normal_update()
            front = max(faces, key=lambda f: f.normal.dot(out))
            hidden = min(faces, key=lambda f: f.normal.dot(out))
            edges = list(front.edges)
        else:
            edges = list({e for v in verts for e in v.link_edges})
        if bevel > 0.0005:
            bmesh.ops.bevel(self.bm, geom=edges, offset=bevel, segments=1, affect="EDGES", clamp_overlap=True)
        if hidden is not None and hidden.is_valid:
            bmesh.ops.delete(self.bm, geom=[hidden], context="FACES_ONLY")
        return verts

    def cone(self, r1, r2, depth, loc, m, seg=8, rot=None, smooth=False, caps=True, scale=(1, 1, 1)):
        M = self._matrix(loc, rot, scale)
        verts = bmesh.ops.create_cone(self.bm, cap_ends=caps, cap_tris=False, segments=seg,
                                      radius1=r1, radius2=max(r2, 0.0), depth=depth, matrix=M)["verts"]
        if r2 <= 0.0:
            bmesh.ops.remove_doubles(self.bm, verts=verts, dist=1e-4)
            verts = [v for v in verts if v.is_valid]
        self._assign(verts, m, smooth)
        return verts

    def cyl_between(self, a, b, r, m, seg=6, r2=None):
        a, b = Vector(a), Vector(b)
        d = b - a
        rot = Vector((0, 0, 1)).rotation_difference(d.normalized()).to_matrix().to_4x4()
        return self.cone(r, r if r2 is None else r2, d.length, (a + b) / 2, m, seg=seg, rot=rot, smooth=True)

    def sphere(self, r, loc, m, seg=14, rings=9, scale=(1, 1, 1), smooth=True, rot=None):
        M = self._matrix(loc, rot, scale)
        verts = bmesh.ops.create_uvsphere(self.bm, u_segments=seg, v_segments=rings, radius=r, matrix=M)["verts"]
        self._assign(verts, m, smooth)
        return verts

    def ico(self, r, loc, m, sub=1, scale=(1, 1, 1), jitter=0.0, smooth=False):
        M = self._matrix(loc, None, scale)
        verts = bmesh.ops.create_icosphere(self.bm, subdivisions=sub, radius=r, matrix=M)["verts"]
        if jitter:
            c = Vector(loc)
            for v in verts:
                v.co = c + (v.co - c) * (1.0 + random.uniform(-jitter, jitter))
        self._assign(verts, m, smooth)
        return verts

    def poly(self, pts, m, z=0.0, smooth=False):
        """Flat n-gon in the XY plane at height z, normal facing +Z."""
        area = sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts)))
        if area < 0:
            pts = list(reversed(pts))
        vs = [self.bm.verts.new((p[0], p[1], z)) for p in pts]
        f = self.bm.faces.new(vs)
        f.material_index = self.mi(m)
        f.smooth = smooth
        return f

    def tri_prism(self, length, width, height, loc, m):
        """Triangular prism along X: triangle in YZ (base width, apex height)."""
        x, y, z = loc
        a = [(x - length / 2, y - width / 2, z), (x - length / 2, y + width / 2, z), (x - length / 2, y, z + height)]
        b = [(x + length / 2, p[1], p[2]) for p in a]
        va = [self.bm.verts.new(p) for p in a]
        vb = [self.bm.verts.new(p) for p in b]
        faces = [self.bm.faces.new(va), self.bm.faces.new(list(reversed(vb)))]
        for i in range(3):
            j = (i + 1) % 3
            faces.append(self.bm.faces.new((va[i], va[j], vb[j], vb[i])))
        bmesh.ops.recalc_face_normals(self.bm, faces=faces)
        idx = self.mi(m)
        for f in faces:
            f.material_index = idx
        return faces

    def obj(self, name, parent=None, loc=(0, 0, 0)):
        me = bpy.data.meshes.new(name)
        self.bm.normal_update()
        self.bm.to_mesh(me)
        self.bm.free()
        for m in self.mats:
            me.materials.append(m)
        o = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(o)
        o.location = loc
        if parent is not None:
            o.parent = parent
        return o


def empty(name, loc, parent=None):
    e = bpy.data.objects.new(name, None)
    e.empty_display_size = 0.1
    bpy.context.scene.collection.objects.link(e)
    e.location = loc
    if parent is not None:
        e.parent = parent
    return e


# ---------------------------------------------------------------- shared pieces


def brick_shell(B, w, d, h, z0, mats, mortar, cx=0.0, cy=0.0, bh=0.16, bl=0.34,
                depth=0.035, gap=0.022, bevel=0.012, skip=None, faces=("front", "back", "left", "right")):
    """A box whose four sides are covered in individual bevelled bricks."""
    B.box((w - 2 * depth + 0.004, d - 2 * depth + 0.004, h), (cx, cy, z0 + h / 2), mortar)
    courses = max(1, round(h / bh))
    bh = h / courses
    sides = {
        "front": (w, (0.0, -d / 2 + depth / 2), "x"),
        "back": (w, (0.0, d / 2 - depth / 2), "x"),
        "left": (d - 2 * depth, (-w / 2 + depth / 2, 0.0), "y"),
        "right": (d - 2 * depth, (w / 2 - depth / 2, 0.0), "y"),
    }
    for i in range(courses):
        zc = z0 + i * bh + bh / 2
        for name in faces:
            L, (ox, oy), axis = sides[name]
            off = bl / 2 if (i + (1 if axis == "y" else 0)) % 2 else 0.0
            s = -L / 2 - off
            while s < L / 2 - 0.01:
                a, e = max(s, -L / 2), min(s + bl, L / 2)
                mid = (a + e) / 2
                if e - a > 0.06 and not (skip and skip(name, mid, zc)):
                    ln = e - a - gap
                    m = random.choice(mats)
                    dj = depth + random.uniform(-0.006, 0.01)
                    if axis == "x":
                        B.box((ln, dj, bh - gap), (cx + ox + mid, cy + oy, zc), m, bevel, out=(0, 1 if oy > 0 else -1, 0))
                    else:
                        B.box((dj, ln, bh - gap), (cx + ox, cy + oy + mid, zc), m, bevel, out=(1 if ox > 0 else -1, 0, 0))
                s += bl


def merlon(B, x, y, z, size=0.3, height=0.28, mats=STONE):
    B.box((size, size, height), (x, y, z + height / 2), random.choice(mats), 0.02)
    B.box((size + 0.04, size + 0.04, 0.05), (x, y, z + height + 0.025), SLAB, 0.012)


def add_torch(B, x, y, z, out_dir=Vector((0, -1, 0))):
    """Wall torch: iron bracket, stick, flame. Returns flame world position."""
    o = Vector((x, y, z))
    B.box((0.08, 0.04, 0.12), o, IRON, 0.008)
    tip = o + out_dir * 0.14 + Vector((0, 0, 0.14))
    B.cyl_between(o + out_dir * 0.02, tip, 0.022, STICK, seg=6)
    B.cone(0.05, 0.035, 0.05, tip + Vector((0, 0, 0.02)), IRON, seg=8)
    B.cone(0.045, 0.0, 0.16, tip + Vector((0, 0, 0.12)), FLAME, seg=8, smooth=True)
    B.ico(0.04, tip + Vector((0, 0, 0.06)), EMBER, sub=1, smooth=True)
    return tip + Vector((0, 0, 0.1))


def quad_pts(p0, c, p1, n=5):
    pts = []
    for i in range(1, n + 1):
        t = i / n
        x = (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * c[0] + t * t * p1[0]
        y = (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * c[1] + t * t * p1[1]
        pts.append((x, y))
    return pts


# ---------------------------------------------------------------- castle kit
# Every block shares one castle style (brick walls + battlements) in three materials.
# The game picks the piece by where the block sits: corner -> tower cap, edge -> wall cap,
# inside -> keep cap, front-middle squares -> gate body. Wall caps face -Y (= +Z in game);
# the game rotates them to face outward.

BONE_MORTAR = mat("bone_mortar", "#6e6250", rough=1.0)
SLATE = [mat("slate_a", "#5d6573"), mat("slate_b", "#4f5664"), mat("slate_c", "#687183")]
RUNE = mat("rune", "#b9a2ff", emit="#8a63ff", emit_strength=4.0)

KITS = {
    "stone": dict(bricks=STONE, mortar=MORTAR, slab=SLAB, trim=STONE, bh=0.16, bl=0.34, bevel=0.012),
    "wood": dict(bricks=WOODS, mortar=WOOD_DARK, slab=WOOD_DARK, trim=[WOOD_DARK], bh=0.123, bl=0.5, bevel=0.01),
    "bone": dict(bricks=BONES, mortar=BONE_MORTAR, slab=BONES[2], trim=BONES, bh=0.185, bl=0.42, bevel=0.028),
}


def kit_body(kind, gate=False):
    K = KITS[kind]
    B = Builder()
    h = LH - 0.06
    skip = (lambda f, m, z: f == "front" and abs(m) < 0.3 and z < 0.66) if gate else None
    brick_shell(B, BW, BW, h, 0.0, K["bricks"], K["mortar"], bh=K["bh"], bl=K["bl"], bevel=K["bevel"], skip=skip)
    if kind == "wood":   # dark corner posts frame the plank courses
        for sx in (-1, 1):
            for sy in (-1, 1):
                B.box((0.1, 0.1, h + 0.02), (sx * (BW / 2 - 0.03), sy * (BW / 2 - 0.03), (h + 0.02) / 2), WOOD_DARK, 0.015)
    B.box((BW + 0.03, BW + 0.03, 0.06), (0, 0, LH - 0.03), K["slab"], 0.015)
    sockets = []
    if gate:
        y = -BW / 2 + 0.012
        B.box((0.42, 0.03, 0.42), (0, y, 0.21), SOCKET)
        B.cone(0.21, 0.21, 0.03, (0, y, 0.42), SOCKET, seg=14, rot=Matrix.Rotation(math.pi / 2, 4, "X"))
        # portcullis: iron bars (stone), wooden door (wood), rib bones (bone)
        bar_mat = {"stone": IRON, "wood": WOOD_DARK, "bone": BONE_WHITE}[kind]
        for k in range(5):
            x = -0.16 + k * 0.08
            top = 0.42 + math.sqrt(max(0.0, 0.2 ** 2 - x * x))
            if kind == "wood":
                B.box((0.075, 0.02, top - 0.02), (x, y - 0.012, (top - 0.02) / 2), random.choice(WOODS), 0.006)
            else:
                B.box((0.022, 0.022, top - 0.02), (x, y - 0.015, (top - 0.02) / 2), bar_mat, 0.004)
        if kind != "wood":
            for z in (0.16, 0.34):
                B.box((0.36, 0.022, 0.022), (0, y - 0.02, z), bar_mat, 0.004)
        else:
            B.box((0.36, 0.024, 0.04), (0, y - 0.025, 0.22), IRON, 0.005)
        trim = K["trim"]
        for k in range(7):
            a = math.pi * k / 6
            B.box((0.12, 0.07, 0.1), (math.cos(a) * 0.27, y - 0.02, 0.42 + math.sin(a) * 0.27), random.choice(trim), 0.012,
                  rot=Matrix.Rotation(a + math.pi / 2, 4, "Y"))
        for sx in (-1, 1):
            for k in range(3):
                B.box((0.1, 0.07, 0.12), (sx * 0.27, y - 0.02, 0.07 + k * 0.13), random.choice(trim), 0.012)
        if kind == "bone":   # skull keystone
            B.sphere(0.075, (0, y - 0.07, 0.7), BONE_WHITE, seg=10, rings=7, scale=(1, 0.7, 0.95))
            for sx in (-1, 1):
                B.sphere(0.02, (sx * 0.028, y - 0.12, 0.71), SOCKET, seg=6, rings=5)
        for sx in (-1, 1):
            sockets.append(add_torch(B, sx * 0.47, -BW / 2 - 0.02, 0.4))
    o = B.obj("%sBody%s" % (kind.title(), "Gate" if gate else ""))
    for i, p in enumerate(sockets):
        empty("TorchSocket_%d" % i, p, o)
    return False


def kit_merlon(B, kind, x, y, z, face, s=0.27, h=0.27):
    """One battlement tooth. `face` = outward direction (unit vector in XY)."""
    face = Vector((face[0], face[1], 0)).normalized()
    if kind == "stone":
        merlon(B, x, y, z, size=s, height=h)
    elif kind == "wood":   # pointed palisade stake
        B.box((s * 0.85, s * 0.85, h * 0.7), (x, y, z + h * 0.35), random.choice(WOODS), 0.012)
        B.cone(s * 0.6, 0.0, h * 0.5, (x, y, z + h * 0.7 + h * 0.25), random.choice(WOODS), seg=4,
               rot=Matrix.Rotation(math.pi / 4, 4, "Z"))
        B.box((s * 0.9, s * 0.9, 0.035), (x, y, z + h * 0.32), IRON, 0.006)
    else:   # tiny skull looking outward
        c = Vector((x, y, z + h * 0.58))
        B.sphere(s * 0.52, c, BONE_WHITE, seg=10, rings=7, scale=(1, 1, 0.92))
        B.box((s * 0.55, s * 0.55, h * 0.3), (x, y, z + h * 0.16), BONES[1], 0.02)
        side = Vector((-face.y, face.x, 0))
        for k in (-1, 1):
            p = c + face * s * 0.44 + side * k * s * 0.2 + Vector((0, 0, s * 0.04))
            B.sphere(s * 0.13, p, SOCKET, seg=6, rings=5)


def kit_ring(B, kind, z, n_per_side=3, inset=0.47, s=0.27, h=0.27):
    pts = []
    for i in range(n_per_side):
        t = -inset + i * (2 * inset / (n_per_side - 1))
        pts += [(t, -inset, (0, -1)), (t, inset, (0, 1))]
        if 0 < i < n_per_side - 1:
            pts += [(-inset, t, (-1, 0)), (inset, t, (1, 0))]
    for x, y, f in pts:
        kit_merlon(B, kind, x, y, z, f, s, h)


def kit_cap(kind, shape):
    K = KITS[kind]
    B = Builder()
    B.box((BW - 0.08, BW - 0.08, 0.05), (0, 0, 0.025), K["slab"] if kind != "stone" else FLOOR_MATS[1])
    if shape == "keep":
        kit_ring(B, kind, 0.0)
    elif shape == "wall":
        for i in range(4):   # battlements along the outward (front) edge
            kit_merlon(B, kind, -0.48 + i * 0.32, -0.48, 0.0, (0, -1))
        B.box((BW - 0.06, 0.1, 0.12), (0, 0.55, 0.06), random.choice(K["bricks"]), 0.015)   # low inner parapet
    else:   # corner tower: bigger battlement ring + a roof in the middle
        B.box((BW - 0.04, BW - 0.04, 0.12), (0, 0, 0.06), K["slab"] if kind != "stone" else SLAB, 0.02)
        kit_ring(B, kind, 0.12, n_per_side=3, s=0.3, h=0.3)
        if kind == "stone":
            B.box((0.5, 0.5, 0.25), (0, 0, 0.24), random.choice(STONE), 0.02)
            B.cone(0.42, 0.0, 0.62, (0, 0, 0.67), random.choice(SLATE), seg=4, rot=Matrix.Rotation(math.pi / 4, 4, "Z"))
        elif kind == "wood":
            B.box((0.5, 0.5, 0.22), (0, 0, 0.23), WOOD_DARK, 0.02)
            B.cone(0.48, 0.0, 0.6, (0, 0, 0.64), random.choice(ROOF), seg=4, rot=Matrix.Rotation(math.pi / 4, 4, "Z"))
        else:
            v = B.sphere(0.32, (0, 0, 0.16), BONES[0], seg=16, rings=10)
            bmesh.ops.delete(B.bm, geom=[q for q in v if q.co.z < 0.16 - 1e-4], context="VERTS")
            for sx in (-1, 1):
                B.cyl_between((sx * 0.22, 0, 0.3), (sx * 0.42, 0, 0.72), 0.06, BONES[2], seg=8, r2=0.0)
            B.sphere(0.06, (0, 0, 0.5), BONE_WHITE, seg=8, rings=6)
    B.obj("%sCap%s" % (kind.title(), shape.title()))
    return False


def turret_base():
    """Squat stone base with iron bands and glowing ghost runes (one block level)."""
    B = Builder()
    h = LH - 0.06
    brick_shell(B, BW, BW, h, 0.0, [mat("tstone_a", "#7f7b86"), mat("tstone_b", "#6e6a76"), mat("tstone_c", "#8a8692")],
                MORTAR, bh=0.15, bl=0.3)
    for z in (0.12, h - 0.12):
        for side in range(4):
            a = side * math.pi / 2
            d = Vector((math.sin(a), -math.cos(a), 0)) * (BW / 2 + 0.006)
            size = (BW + 0.02, 0.025, 0.05) if side % 2 == 0 else (0.025, BW + 0.02, 0.05)
            B.box(size, (d.x, d.y, z), IRON, 0.006)
    for side in range(4):   # rune on each face
        a = side * math.pi / 2
        d = Vector((math.sin(a), -math.cos(a), 0)) * (BW / 2 + 0.012)
        size = (0.16, 0.012, 0.16) if side % 2 == 0 else (0.012, 0.16, 0.16)
        B.box(size, (d.x, d.y, h / 2), RUNE, 0.0, rot=Matrix.Rotation(math.pi / 4, 4, "Y" if side % 2 == 0 else "X"))
    B.box((BW + 0.03, BW + 0.03, 0.06), (0, 0, LH - 0.03), SLAB, 0.015)
    B.obj("TurretBase")
    return False


def turret_head():
    """Rotating cannon the ghost sits in. Origin = pivot; front (-Y) = barrel direction."""
    B = Builder()
    B.cone(0.56, 0.52, 0.12, (0, 0, 0.06), IRON, seg=20)                 # turntable
    B.cone(0.5, 0.5, 0.04, (0, 0, 0.14), mat("brass", "#b08a4a", rough=0.45, metal=0.7), seg=20)
    for sx in (-1, 1):                                                    # cheeks holding the barrel
        B.box((0.09, 0.42, 0.34), (sx * 0.22, -0.05, 0.32), IRON, 0.02)
    pitch = Matrix.Rotation(-0.35, 4, "X")                                # barrel raised for a lobbing shot
    base = Vector((0, -0.02, 0.36))
    tip = base + (pitch @ Vector((0, -0.85, 0, 0))).to_3d()
    B.cyl_between(base + (pitch @ Vector((0, 0.25, 0, 0))).to_3d(), tip, 0.14, IRON, seg=14, r2=0.11)
    for t in (0.35, 0.7):
        p = base.lerp(tip, t)
        B.cyl_between(p - (tip - base).normalized() * 0.03, p + (tip - base).normalized() * 0.03, 0.155, RUNE, seg=14)
    B.cyl_between(tip - (tip - base).normalized() * 0.06, tip, 0.15, mat("brass2", "#c79a52", rough=0.4, metal=0.7), seg=14)
    B.box((0.36, 0.28, 0.12), (0, 0.28, 0.2), WOOD_DARK, 0.02)            # ghost's seat
    B.box((0.36, 0.06, 0.28), (0, 0.42, 0.3), WOOD_DARK, 0.02)
    o = B.obj("TurretHead")
    empty("GhostSeat", (0, 0.28, 0.27), o)
    empty("Muzzle", tip, o)
    return False


def castle_frame():
    """Flat stone platform: one smooth tile per grid square, a low curb around the edge."""
    B = Builder()
    GW, GD = 6 * CELL, 3 * CELL
    pad = 0.3
    B.box((GW + 2 * pad, GD + 2 * pad, 0.16), (0, 0, 0.08), MORTAR, 0.03)
    for c in range(6):
        for r in range(3):
            cx, cy = -GW / 2 + CELL / 2 + c * CELL, -GD / 2 + CELL / 2 + r * CELL
            B.box((CELL - 0.06, CELL - 0.06, 0.08), (cx, cy, 0.2), random.choice(FLOOR_MATS), 0.02)
    # curb stones around the edge, slightly above the tiles
    for sy in (-1, 1):
        x = -GW / 2 - pad
        while x < GW / 2 + pad - 0.05:
            L = min(random.uniform(0.45, 0.75), GW / 2 + pad - x)
            B.box((L - 0.03, pad - 0.04, 0.16), (x + L / 2, sy * (GD / 2 + pad / 2), 0.2), random.choice(STONE), 0.02)
            x += L
    for sx in (-1, 1):
        y = -GD / 2
        while y < GD / 2 - 0.05:
            L = min(random.uniform(0.45, 0.75), GD / 2 - y)
            B.box((pad - 0.04, L - 0.03, 0.16), (sx * (GW / 2 + pad / 2), y + L / 2, 0.2), random.choice(STONE), 0.02)
            y += L
    o = B.obj("CastleFrame")
    empty("GridOrigin", (0, 0, FLOOR), o)
    return False


# ---------------------------------------------------------------- creatures


# ---------------------------------------------------------------- rigged bats
# Bats are skinned meshes on a real skeleton (shoulder/elbow/wrist/thumb/4 fingers per wing,
# head, ears, legs). The game animates the bones in code (src/render/batRig.js) so the flap
# speed, folding, banking and stun reactions follow the gameplay.

BAT_PALETTES = {
    "player": dict(fur="#5b4d8c", fur_dark="#43376f", fur_light="#8d7cbf", wing="#56337a", wing_light="#6c4394",
                   bone="#382a54", vein="#f07a30", ear_in="#e2a0bf", snout="#e0a2b4", nose="#3a2030",
                   eye="#ffa31a", pupil="#160c10", brow="#251d3c", claw="#2a2230"),
    "rival": dict(fur="#8f674a", fur_dark="#6b4b35", fur_light="#d4b08a", wing="#7c4430", wing_light="#95543c",
                  bone="#56311f", vein="#f39040", ear_in="#ebb9a0", snout="#e0a89a", nose="#3a2016",
                  eye="#ff8a1a", pupil="#160c08", brow="#3a2412", claw="#2a1c14"),
}
BAT_BONES = ["root", "body", "head", "ear_L", "ear_R",
             "upperarm_L", "forearm_L", "hand_L", "thumb_L", "d2_L", "d3_L", "d4_L", "d5_L", "leg_L", "foot_L",
             "upperarm_R", "forearm_R", "hand_R", "thumb_R", "d2_R", "d3_R", "d4_R", "d5_R", "leg_R", "foot_R"]


class Paint:
    """A color + which of the 3 bat materials it belongs to (fur / wing / glow)."""
    def __init__(self, hexc, kind="fur"):
        self.lin = hex_rgb(hexc)
        self.kind = kind


def bat_layout(side):
    """Wing + leg joint positions for one side (side=+1 is the bat's left, Blender +X). Front is -Y."""
    K = 0.82
    def P(x, y, z=0.06):
        return Vector((side * x * K, y * K, z))
    j = dict(
        S=Vector((side * 0.17, -0.06, 0.06)),
        E=P(0.62, 0.16), W=P(1.02, -0.16), T=P(1.1, -0.34, 0.08),
        D2=P(1.66, -0.34), D3=P(2.05, -0.1), D4=P(1.66, 0.52), D5=P(1.12, 0.7),
        H=Vector((side * 0.11, 0.2, -0.1)), A=Vector((side * 0.17, 0.42, -0.26)),
    )
    j["FT"] = j["A"] + Vector((0, 0.03, -0.09))
    return j


def make_armature(name):
    arm_data = bpy.data.armatures.new(name + "_rig")
    arm = bpy.data.objects.new("Rig_" + name, arm_data)
    bpy.context.scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm_data.edit_bones

    def bone(n, h, t, parent=None):
        b = eb.new(n)
        b.head, b.tail, b.roll = Vector(h), Vector(t), 0.0
        if parent:
            b.parent = eb[parent]
            b.use_connect = False
    bone("root", (0, 0, -0.1), (0, 0, 0.1))
    bone("body", (0, 0.2, -0.02), (0, -0.12, 0.06), "root")
    bone("head", (0, -0.1, 0.12), (0, -0.28, 0.36), "body")
    for side, sfx in ((1, "_L"), (-1, "_R")):
        j = bat_layout(side)
        bone("ear" + sfx, (side * 0.15, -0.16, 0.34), (side * 0.3, -0.14, 0.86), "head")
        bone("upperarm" + sfx, j["S"], j["E"], "body")
        bone("forearm" + sfx, j["E"], j["W"], "upperarm" + sfx)
        bone("hand" + sfx, j["W"], j["W"] + Vector((side * 0.06, 0, 0)), "forearm" + sfx)
        for d in ("T", "D2", "D3", "D4", "D5"):
            bone(("thumb" if d == "T" else d.lower()) + sfx, j["W"], j[d], "hand" + sfx)
        bone("leg" + sfx, j["H"], j["A"], "body")
        bone("foot" + sfx, j["A"], j["FT"], "leg" + sfx)
    bpy.ops.object.mode_set(mode="OBJECT")
    return arm


def seg_dist(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / max(ab.length_squared, 1e-9)))
    return (a + ab * t - p).length


def bat(name):
    pal = BAT_PALETTES[name]
    C = {k: Paint(v) for k, v in pal.items()}
    for k in ("wing", "wing_light", "vein"):
        C[k] = Paint(pal[k], "wing")
    C["bone_w"] = Paint(pal["bone"], "wing")
    C["eye"] = Paint(pal["eye"], "glow")
    C["glint"] = Paint("#fff6e0", "glow")
    C["fang"] = Paint("#f4efe2")
    arm = make_armature(name)
    B = Builder()
    # create custom-data layers BEFORE adding geometry: adding a layer later invalidates vertex refs
    B.bm.verts.layers.deform.verify()
    B.bm.loops.layers.color.new("Col")
    weights = []   # (verts, {bone: w}) or (verts, None) = auto from distance

    def rig(verts, bone):
        weights.append((list(verts), {bone: 1.0}))
        return verts

    def auto(verts):
        weights.append((list(verts), None))
        return verts

    def orient(d):
        return Vector((0, 0, 1)).rotation_difference(Vector(d).normalized()).to_matrix().to_4x4()

    # -------- body + fluffy chest
    Hc = Vector((0, -0.2, 0.2))
    rig(B.sphere(0.25, (0, 0.06, -0.03), C["fur"], seg=16, rings=10, scale=(0.95, 1.18, 0.92)), "body")
    rig(B.sphere(0.17, (0, -0.1, -0.07), C["fur_light"], seg=14, rings=9, scale=(1.05, 0.75, 1.1)), "body")
    for i in range(16):  # fur tufts on chest (light) and back (dark)
        a = random.uniform(0, math.tau)
        if i < 8:
            d = Vector((math.cos(a) * 0.7, -0.75, math.sin(a) * 0.6 - 0.35)).normalized()
            base, col, r = Vector((0, -0.1, -0.07)) + d * 0.13, C["fur_light"], 0.05
        else:
            d = Vector((math.cos(a) * 0.45, random.uniform(0.8, 1.2), abs(math.sin(a)) * 0.35 + 0.25)).normalized()  # lies back
            base, col, r = Vector((0, 0.08, -0.03)) + Vector((d.x * 0.22, d.y * 0.27, d.z * 0.2)), random.choice([C["fur"], C["fur_dark"]]), 0.055
        rig(B.cone(r, 0.0, 0.12, base + d * 0.03, col, seg=5, rot=orient(d)), "body")

    # -------- head
    rig(B.sphere(0.27, Hc, C["fur"], seg=20, rings=14, scale=(1.08, 0.95, 0.95)), "head")
    for i in range(26):  # fluffy head + cheek tufts
        if i < 18:
            d = Vector((random.uniform(-0.8, 0.8), random.uniform(0.4, 1.2), random.uniform(0.3, 0.9))).normalized()
            col = random.choice([C["fur"], C["fur_dark"], C["fur"]])
        else:
            sx = 1 if i % 2 else -1
            d = Vector((sx * random.uniform(0.7, 1), random.uniform(-0.6, 0.1), random.uniform(-0.7, -0.2))).normalized()
            col = C["fur_light"] if random.random() < 0.6 else C["fur"]
        base = Hc + Vector((d.x * 0.27, d.y * 0.24, d.z * 0.24))
        rig(B.cone(0.055, 0.0, 0.13, base + d * 0.03, col, seg=5, rot=orient(d)), "head")
    # face
    rig(B.sphere(0.13, (0, -0.37, 0.13), C["fur_light"], seg=14, rings=9, scale=(1.35, 0.7, 0.85)), "head")   # muzzle
    rig(B.sphere(0.07, (0, -0.47, 0.16), C["snout"], seg=12, rings=8, scale=(1.3, 0.75, 0.8)), "head")
    rig(B.sphere(0.03, (0, -0.52, 0.18), C["nose"], seg=8, rings=6, scale=(1.5, 0.6, 0.8)), "head")
    rig(B.sphere(0.07, (0, -0.44, 0.06), C["nose"], seg=12, rings=7, scale=(1.5, 0.35, 0.45)), "head")    # grin
    for sx in (-1, 1):
        rig(B.cone(0.022, 0.0, 0.07, (sx * 0.05, -0.475, 0.035), C["fang"], seg=6, rot=Matrix.Rotation(math.pi + 0.2, 4, "X")), "head")
        rig(B.sphere(0.078, (sx * 0.115, -0.39, 0.27), C["eye"], seg=14, rings=10, scale=(1, 0.6, 1.08)), "head")
        rig(B.sphere(0.036, (sx * 0.118, -0.432, 0.262), C["pupil"], seg=10, rings=7, scale=(0.9, 0.45, 1.25)), "head")
        rig(B.sphere(0.016, (sx * 0.095, -0.44, 0.3), C["glint"], seg=6, rings=4), "head")
        brow_rot = Matrix.Rotation(-sx * 0.42, 4, "Y") @ Matrix.Rotation(0.25, 4, "X")
        rig(B.box((0.15, 0.05, 0.04), (sx * 0.12, -0.4, 0.37), C["brow"], 0.015, rot=brow_rot), "head")
        # ears: tall, flattened, pink inside
        ear = "ear_L" if sx > 0 else "ear_R"
        er = Matrix.Rotation(-sx * 0.3, 4, "Y") @ Matrix.Rotation(-0.1, 4, "X")
        rig(B.cone(0.19, 0.015, 0.58, Vector((sx * 0.21, -0.15, 0.6)), C["fur"], seg=14, rot=er, scale=(1, 0.42, 1), smooth=True), ear)
        inner_off = er @ Vector((0, -0.045, 0))
        rig(B.cone(0.135, 0.008, 0.46, Vector((sx * 0.21, -0.15, 0.58)) + inner_off.to_3d(), C["ear_in"], seg=12, rot=er, scale=(1, 0.3, 1), smooth=True), ear)
        for k in range(3):
            d = Vector((sx * 0.6, -0.4, 0.7 + k * 0.1)).normalized()
            rig(B.cone(0.04, 0.0, 0.1, Vector((sx * (0.13 + k * 0.03), -0.22, 0.38)), C["fur_light"], seg=5, rot=orient(d)), ear)

    # -------- arms, fingers, legs (rigid on their bones)
    for side, sfx in ((1, "_L"), (-1, "_R")):
        j = bat_layout(side)
        rig(B.sphere(0.08, j["S"], C["fur"], seg=10, rings=7), "upperarm" + sfx)
        rig(B.cyl_between(j["S"], j["E"], 0.05, C["bone"], seg=8, r2=0.035), "upperarm" + sfx)
        rig(B.sphere(0.04, j["E"], C["bone"], seg=8, rings=6), "forearm" + sfx)
        rig(B.cyl_between(j["E"], j["W"], 0.036, C["bone"], seg=8, r2=0.026), "forearm" + sfx)
        rig(B.sphere(0.034, j["W"], C["bone"], seg=8, rings=6), "hand" + sfx)
        rig(B.cyl_between(j["W"], j["T"], 0.02, C["bone"], seg=6), "thumb" + sfx)
        rig(B.cone(0.02, 0.0, 0.07, j["T"] + Vector((0, -0.025, 0)), C["claw"], seg=6, rot=Matrix.Rotation(math.pi / 2 + 0.3, 4, "X")), "thumb" + sfx)
        for d in ("D2", "D3", "D4", "D5"):
            mid = j["W"].lerp(j[d], 0.55)
            rig(B.cyl_between(j["W"], mid, 0.017, C["bone"], seg=6, r2=0.013), d.lower() + sfx)
            rig(B.cyl_between(mid, j[d], 0.013, C["bone"], seg=5, r2=0.006), d.lower() + sfx)
            rig(B.sphere(0.018, mid, C["bone"], seg=6, rings=5), d.lower() + sfx)
        rig(B.cyl_between(j["H"], j["A"], 0.035, C["fur_dark"], seg=7, r2=0.025), "leg" + sfx)
        for k in (-1, 0, 1):   # curled toe claws
            tip = j["FT"] + Vector((k * 0.03, -0.04, -0.02))
            rig(B.cyl_between(j["A"], j["FT"] + Vector((k * 0.025, 0, 0)), 0.014, C["fur_dark"], seg=5), "foot" + sfx)
            rig(B.cyl_between(j["FT"] + Vector((k * 0.025, 0, 0)), tip, 0.011, C["claw"], seg=5, r2=0.002), "foot" + sfx)

        # -------- wing membrane panels (skinned by distance to the bones)
        def ring_grid(Pfun, nu, nv, paint_fn, fan=False):
            rows = []
            for iu in range(nu + 1):
                u = iu / nu
                if fan and iu == 0:
                    rows.append([B.bm.verts.new(Pfun(0.0, 0.5))] * (nv + 1))
                    continue
                rows.append([B.bm.verts.new(Pfun(u, iv / nv)) for iv in range(nv + 1)])
            vs = []
            for iu in range(nu):
                for iv in range(nv):
                    a, b, c, d = rows[iu][iv], rows[iu][iv + 1], rows[iu + 1][iv + 1], rows[iu + 1][iv]
                    quad = [a, b, c, d] if not (fan and iu == 0) else [a, c, d]
                    try:
                        f = B.bm.faces.new(quad)
                    except ValueError:
                        continue
                    f.material_index = B.mi(paint_fn((iu + 0.5) / nu, (iv + 0.5) / nv))
                    f.smooth = True
            for r in rows:
                vs.extend(r)
            auto(set(vs))

        def membrane_paint(u, v):
            return C["wing_light"] if (u * 7 + v * 3 + random.random() * 2) % 3 < 0.9 else C["wing"]

        W = j["W"]
        panels = [("D2", "D3", 0.03), ("D3", "D4", 0.2), ("D4", "D5", 0.15)]
        for a_, b_, depth in panels:
            ta, tb = j[a_], j[b_]
            mid = (ta + tb) / 2
            inward = (W - mid).normalized()

            def Pf(u, v, ta=ta, tb=tb, inward=inward, depth=depth):
                q = ta.lerp(tb, v) + inward * depth * math.sin(math.pi * v)
                return W.lerp(q, u)
            ring_grid(Pf, 6, 5, membrane_paint, fan=True)
            for vv in (0.35, 0.68):   # orange veins as thin ribbons on both faces
                vein_ribbon(B, lambda u, vv=vv, Pf=Pf: Pf(u, vv + 0.08 * math.sin(u * 7)), 0.15, 0.9, C["vein"], auto)
        # plagiopatagium: finger 5 -> arm -> body -> ankle
        S_, E_, A_, D5 = j["S"], j["E"], j["A"], j["D5"]

        def arm_line(v):
            return W.lerp(E_, v * 2) if v < 0.5 else E_.lerp(S_ + Vector((0, 0.06, -0.02)), (v - 0.5) * 2)

        def trail(v):
            m = D5.lerp(A_, v)
            inward = (E_ - (D5 + A_) / 2).normalized()
            return m + inward * 0.17 * math.sin(math.pi * v)

        def Pplag(u, v):
            return arm_line(v).lerp(trail(v), u)
        ring_grid(Pplag, 5, 7, membrane_paint)
        for vv in (0.25, 0.5, 0.75):
            vein_ribbon(B, lambda u, vv=vv: Pplag(u, vv + 0.05 * math.sin(u * 6)), 0.08, 0.85, C["vein"], auto)
        # propatagium: leading edge membrane in front of the elbow
        def Pprop(u, v):
            lead = S_.lerp(W, v) + Vector((0, -0.07 * math.sin(math.pi * v), 0.01))
            armp = S_.lerp(E_, v * 2) if v < 0.5 else E_.lerp(W, (v - 0.5) * 2)
            return lead.lerp(armp, u)
        ring_grid(Pprop, 3, 6, lambda u, v: C["wing"])

    # -------- finalize: vertex colors, 3 materials, skin weights
    finalize_bat(B, weights, arm, name)
    return False   # rigged, but animated in game code (no baked clip)


def vein_ribbon(B, curve, u0, u1, paint, auto, n=8, w=0.011):
    for zoff in (0.004, -0.004):
        pts = [curve(u0 + (u1 - u0) * i / n) + Vector((0, 0, zoff)) for i in range(n + 1)]
        vs, prev = [], None
        for i, p in enumerate(pts):
            t = pts[min(i + 1, n)] - pts[max(i - 1, 0)]
            side = t.cross(Vector((0, 0, 1))).normalized() * w * (1 - 0.6 * i / n)
            pair = (B.bm.verts.new(p + side), B.bm.verts.new(p - side))
            if prev:
                quad = [prev[0], pair[0], pair[1], prev[1]] if zoff > 0 else [prev[1], pair[1], pair[0], prev[0]]
                f = B.bm.faces.new(quad)
                f.material_index = B.mi(paint)
            vs += pair
            prev = pair
        auto(vs)


def make_bat_material(name, kind):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    p = nt.nodes.get("Principled BSDF")
    ca = nt.nodes.new("ShaderNodeVertexColor")
    ca.layer_name = "Col"
    nt.links.new(ca.outputs["Color"], p.inputs["Base Color"])
    p.inputs["Roughness"].default_value = 0.8 if kind != "glow" else 0.3
    if kind == "glow":
        key = "Emission Color" if "Emission Color" in p.inputs else "Emission"
        nt.links.new(ca.outputs["Color"], p.inputs[key])
        p.inputs["Emission Strength"].default_value = 3.0
    m.use_backface_culling = kind != "wing"
    return m


def finalize_bat(B, weights, arm, name):
    bm = B.bm
    # bone segments for automatic membrane weights
    pose_pts = {b.name: (b.head_local.copy(), b.tail_local.copy()) for b in arm.data.bones}
    cand = [n for n in BAT_BONES if n.split("_")[0] in ("upperarm", "forearm", "d2", "d3", "d4", "d5", "leg", "body")]
    deform = bm.verts.layers.deform.verify()
    idx = {n: i for i, n in enumerate(BAT_BONES)}
    for verts, w in weights:
        for v in verts:
            if not v.is_valid:
                continue
            if w is None:
                scores = []
                for n in cand:
                    if n.endswith("_L") and v.co.x < -0.05 or n.endswith("_R") and v.co.x > 0.05:
                        continue
                    h, t = pose_pts[n]
                    d = seg_dist(v.co, h, t)
                    if n == "body":
                        d += 0.12
                    scores.append((1.0 / (d + 0.02) ** 4, n))
                scores.sort(reverse=True)
                scores = scores[:3]
                tot = sum(s for s, _ in scores)
                w = {n: s / tot for s, n in scores}
            for n, val in w.items():
                v[deform][idx[n]] = val
    # colors + material kinds
    col = bm.loops.layers.color.get("Col")
    kinds = ["fur", "wing", "glow"]
    for f in bm.faces:
        paint = B.mats[f.material_index]
        for l in f.loops:
            l[col] = (*paint.lin, 1.0)
        f.material_index = kinds.index(paint.kind)
    me = bpy.data.meshes.new("Bat_" + name)
    o = bpy.data.objects.new("Bat_" + name, me)
    bpy.context.scene.collection.objects.link(o)
    for n in BAT_BONES:   # groups must exist before writing the mesh, or the weights are dropped
        o.vertex_groups.new(name=n)
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    for k in kinds:
        me.materials.append(make_bat_material("bat_" + k, k))
    o.parent = arm
    mod = o.modifiers.new("Armature", "ARMATURE")
    mod.object = arm
    bpy.context.view_layer.update()   # builds the armature's pose bones (needed for skin export)
    print("[bat-siege] rig bones:", len(arm.pose.bones) if arm.pose else 0)
    return o


def pose_bat_preview(arm, phase):
    """Rough flap pose for the preview renders only (the game has its own animation)."""
    from mathutils import Quaternion
    c, s = math.cos(phase * math.tau), math.sin(phase * math.tau)
    fold = max(0.0, -s)
    for side, sfx in ((1, "_L"), (-1, "_R")):
        def rot(bn, axis, ang):
            pb = arm.pose.bones[bn]
            pb.rotation_mode = "QUATERNION"
            R = arm.data.bones[bn].matrix_local.to_quaternion()
            pb.rotation_quaternion = pb.rotation_quaternion @ Quaternion(R.inverted() @ Vector(axis), ang)
        rot("upperarm" + sfx, (0, 1, 0), -side * (0.15 + 0.75 * c))
        rot("upperarm" + sfx, (0, 0, 1), side * (fold * 0.35))
        rot("forearm" + sfx, (0, 0, 1), side * fold * 0.9)
        rot("hand" + sfx, (0, 0, 1), side * fold * 0.8)
        for d, k in (("d2", 0.5), ("d3", 0.5), ("d4", 0.25)):
            rot(d + sfx, (0, 0, 1), side * fold * k)
    bpy.context.view_layer.update()


def ghost():
    B = Builder()
    seg = 28
    hem = B.cone(0.39, 0.34, 0.46, (0, 0, 0.23), GHOST, seg=seg, caps=False, smooth=True)
    for v in hem:
        if v.co.z < 0.02:
            a = math.atan2(v.co.y, v.co.x)
            v.co.z += math.sin(a * 7) * 0.07
    top = B.sphere(0.34, (0, 0, 0.46), GHOST, seg=seg, rings=14)
    bmesh.ops.delete(B.bm, geom=[v for v in top if v.co.z < 0.46 - 1e-4], context="VERTS")
    bmesh.ops.remove_doubles(B.bm, verts=list(B.bm.verts), dist=0.004)
    for sx in (-1, 1):
        B.sphere(0.075, (sx * 0.13, -0.315, 0.52), GHOST_FACE, seg=10, rings=8, scale=(1, 0.45, 1.4))
        B.sphere(0.09, (sx * 0.36, -0.05, 0.3), GHOST, seg=10, rings=8, scale=(0.7, 0.7, 1.1))
    B.sphere(0.055, (0, -0.33, 0.38), GHOST_FACE, seg=10, rings=8, scale=(1, 0.45, 1.3))
    B.obj("Ghost")
    return False


def moth():
    B = Builder()
    B.sphere(0.035, (0, 0.03, 0), MOTH_BODY, seg=10, rings=7, scale=(0.9, 1.9, 0.9))
    B.sphere(0.028, (0, -0.045, 0.005), MOTH_BODY, seg=8, rings=6)
    for sx in (-1, 1):
        B.cyl_between((sx * 0.01, -0.06, 0.01), (sx * 0.06, -0.13, 0.04), 0.004, MOTH_BODY, seg=4)
    body = B.obj("Moth")
    shape = []
    for i in range(16):
        a = i / 16 * math.pi * 2
        r = 0.11 + 0.035 * math.cos(2 * a)
        shape.append((0.12 + math.cos(a) * r * 1.1, math.sin(a) * r * 0.8 + (0.025 if math.sin(a) > 0 else 0)))
    wings = []
    for side in (1, -1):
        W = Builder()
        W.poly([(side * x, y) for x, y in shape], MOTH_WING, z=0.0)
        W.poly([(side * (0.14 + math.cos(i / 10 * 6.283) * 0.045), -0.02 + math.sin(i / 10 * 6.283) * 0.03) for i in range(10)],
               MOTH_PATCH, z=0.002)
        W.poly([(side * (0.16 + math.cos(i / 8 * 6.283) * 0.018), -0.025 + math.sin(i / 8 * 6.283) * 0.018) for i in range(8)],
               MOTH_SPOT, z=0.004)
        wo = W.obj(("WingL" if side > 0 else "WingR"), parent=body, loc=(side * 0.02, 0.0, 0.01))
        wo.rotation_mode = "XYZ"
        wings.append((wo, side))
    scn = bpy.context.scene
    scn.frame_start, scn.frame_end = 1, 5
    for f, a in ((1, -0.9), (3, 0.55), (5, -0.9)):
        for wo, side in wings:
            wo.rotation_euler = (0.0, a * side, 0.0)
            wo.keyframe_insert("rotation_euler", frame=f)
    return True


def termite_into(B, origin=Vector((0, 0, 0)), yaw=0.0, s=1.0):
    R = Matrix.Rotation(yaw, 3, "Z")

    def P(x, y, z):
        return origin + (R @ Vector((x, y, z))) * s
    B.sphere(0.05 * s, P(0, 0.065, 0.04), TERMITE, seg=10, rings=7, scale=(0.8, 1.4, 0.7))
    B.sphere(0.03 * s, P(0, -0.005, 0.045), TERMITE, seg=8, rings=6)
    B.sphere(0.036 * s, P(0, -0.055, 0.05), TERMITE_HEAD, seg=8, rings=6)
    for k, yy in enumerate((-0.03, 0.0, 0.03)):
        for sx in (-1, 1):
            B.cyl_between(P(sx * 0.02, yy, 0.04), P(sx * 0.075, yy + (k - 1) * 0.03, 0.0), 0.006 * s, TERMITE_HEAD, seg=4)
    for sx in (-1, 1):
        B.cyl_between(P(sx * 0.012, -0.08, 0.06), P(sx * 0.05, -0.14, 0.09), 0.004 * s, TERMITE_HEAD, seg=4)


def termite():
    B = Builder()
    termite_into(B)
    B.obj("Termite")
    return False


def termite_clump():
    B = Builder()
    B.ico(0.22, (0, 0, 0), CLUMP, sub=1, jitter=0.18)
    for i in range(9):
        th, ph = random.uniform(0, math.pi * 2), random.uniform(0.2, 2.6)
        d = Vector((math.sin(ph) * math.cos(th), math.sin(ph) * math.sin(th), math.cos(ph)))
        termite_into(B, d * 0.22, yaw=random.uniform(0, 6.28), s=0.9)
    B.obj("TermiteClump")
    return False


def rock():
    B = Builder()
    B.ico(0.3, (0, 0, 0), ROCK, sub=2, jitter=0.13)
    B.obj("Rock")
    return False


def rock_scatter():
    B = Builder()
    for i in range(3):
        B.ico(random.uniform(0.12, 0.22), (random.uniform(-0.25, 0.25), random.uniform(-0.25, 0.25), 0.06),
              random.choice([ROCK, ROCK_DARK]), sub=1, jitter=0.25, scale=(1, 1, 0.6))
    B.obj("RockScatter")
    return False


def torch():
    B = Builder()
    p = add_torch(B, 0, 0, 0.3)
    o = B.obj("Torch")
    empty("TorchSocket_0", p, o)
    return False


# ---------------------------------------------------------------- environment


def tree_pine(tall=True):
    B = Builder()
    B.cone(0.16, 0.12, 0.7, (0, 0, 0.35), TRUNK, seg=6)
    tiers = [(1.0, 1.3, 0.95), (0.8, 1.15, 1.7), (0.55, 1.0, 2.35)] if tall else [(1.05, 1.1, 0.8), (0.72, 1.0, 1.45)]
    for r, h, z in tiers:
        v = B.cone(r, 0.0, h, (0, 0, z), random.choice(PINE), seg=7)
        for vv in v:
            if vv.co.z < z:
                vv.co.x += random.uniform(-0.06, 0.06)
                vv.co.y += random.uniform(-0.06, 0.06)
                vv.co.z += random.uniform(-0.05, 0.05)
    B.obj("TreePine" + ("A" if tall else "B"))
    return False


def bush():
    B = Builder()
    for i in range(4):
        B.ico(random.uniform(0.35, 0.5), (random.uniform(-0.3, 0.3), random.uniform(-0.3, 0.3), random.uniform(0.3, 0.45)),
              random.choice(PINE), sub=1, jitter=0.12)
    B.obj("Bush")
    return False


def grass_tuft():
    B = Builder()
    for i in range(6):
        a = i / 6 * math.pi * 2 + random.uniform(-0.3, 0.3)
        base = Vector((math.cos(a) * 0.05, math.sin(a) * 0.05, 0))
        tip = base + Vector((math.cos(a) * 0.12, math.sin(a) * 0.12, random.uniform(0.28, 0.42)))
        B.cyl_between(base, tip, 0.03, GRASS, seg=3, r2=0.0)
    B.obj("GrassTuft")
    return False


def pond():
    B = Builder()
    ring, water = [], []
    for i in range(48):
        a = i / 48 * math.pi * 2
        r = 1.75 * (1 + 0.13 * math.sin(a * 3 + 1) + 0.06 * math.sin(a * 5))
        x, y = math.cos(a) * r * 1.25, math.sin(a) * r * 0.85
        water.append((x, y))
        ring.append((x * 1.13, y * 1.16))
    B.poly(ring, MUD, z=0.01)
    B.poly(water, WATER, z=0.03)
    for i in range(26):
        a = i / 26 * math.pi * 2 + random.uniform(-0.08, 0.08)
        r = 1.75 * (1 + 0.13 * math.sin(a * 3 + 1) + 0.06 * math.sin(a * 5))
        B.ico(random.uniform(0.1, 0.2), (math.cos(a) * r * 1.28, math.sin(a) * r * 0.9, 0.04),
              random.choice([ROCK_DARK, ROCK]), sub=1, jitter=0.2, scale=(1, 1, 0.5))
    o = B.obj("Pond")
    M = Builder()
    M.poly([(math.cos(i / 32 * 6.283) * 0.52, math.sin(i / 32 * 6.283) * 0.52) for i in range(32)], MOON_REFL, z=0.0)
    M.obj("MoonReflection", parent=o, loc=(0.45, 0.1, 0.045))
    return False


# ---------------------------------------------------------------- export + preview


def clear():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for me in list(bpy.data.meshes):
        if me.users == 0:
            bpy.data.meshes.remove(me)
    for a in list(bpy.data.actions):
        bpy.data.actions.remove(a)
    scn = bpy.context.scene
    scn.frame_start, scn.frame_end = 1, 1


def export(name, animated):
    objs = list(bpy.context.scene.objects)
    for o in objs:
        o.select_set(True)
    if objs:
        bpy.context.view_layer.objects.active = objs[0]
    bpy.context.scene.name = name
    path = os.path.join(OUT, name + ".glb")
    base = dict(filepath=path, export_format="GLB", use_selection=True, export_apply=True,
                export_yup=True, export_animations=animated)
    attempts = [dict(base, export_animation_mode="SCENE"), base] if animated else [base]
    if any(o.type == "ARMATURE" for o in objs):   # rigged bats: keep skin + vertex colors
        base["export_apply"] = False   # applying modifiers would bake away the armature skin
        attempts = [dict(base, export_skins=True, export_vertex_color="ACTIVE"), dict(base, export_skins=True)]
    for kw in attempts:
        try:
            bpy.ops.export_scene.gltf(**kw)
            print("[bat-siege] exported", path)
            return
        except TypeError as err:
            print("[bat-siege] retrying export without an option:", err)
    raise RuntimeError("glTF export failed for " + name)


def preview(name):
    os.makedirs(PREVIEW_DIR, exist_ok=True)
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not meshes:
        return
    pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    center, size = (lo + hi) / 2, max((hi - lo).length, 0.3)
    cam_data = bpy.data.cameras.new("PreviewCam")
    cam_data.lens = 50
    cam = bpy.data.objects.new("PreviewCam", cam_data)
    bpy.context.scene.collection.objects.link(cam)
    rigged = any(o.type == "ARMATURE" for o in bpy.context.scene.objects)
    cam.location = center + (Vector((size * 0.35, -size * 0.95, size * 0.75)) if rigged else Vector((size * 0.9, -size * 1.5, size * 1.1)))
    cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()
    sun_data = bpy.data.lights.new("PreviewSun", "SUN")
    sun_data.energy = 4.5 if rigged else 3.0
    sun_data.color = hex_rgb("#c4d2ff")
    sun = bpy.data.objects.new("PreviewSun", sun_data)
    sun.rotation_euler = (math.radians(50), math.radians(10), math.radians(30))
    bpy.context.scene.collection.objects.link(sun)
    scn = bpy.context.scene
    scn.camera = cam
    if scn.world is None:
        scn.world = bpy.data.worlds.new("World")
    scn.world.use_nodes = True
    bg = scn.world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs[0].default_value = (*hex_rgb("#1a2a44"), 1.0)
        bg.inputs[1].default_value = 1.6 if rigged else 0.8
    scn.render.engine = "CYCLES"
    scn.cycles.samples = 24
    scn.cycles.device = "CPU"
    scn.render.resolution_x = scn.render.resolution_y = 512
    scn.render.filepath = os.path.join(PREVIEW_DIR, name + ".png")
    bpy.ops.render.render(write_still=True)
    print("[bat-siege] preview", scn.render.filepath)
    rigs = [o for o in scn.objects if o.type == "ARMATURE"]
    if rigs:   # extra renders of flap poses to check the skinning
        for tag, phase in (("_downstroke", 0.0), ("_mid", 0.25), ("_upstroke", 0.75)):
            for pb in rigs[0].pose.bones:
                pb.rotation_mode = "QUATERNION"
                pb.rotation_quaternion = (1, 0, 0, 0)
            pose_bat_preview(rigs[0], phase)
            scn.render.filepath = os.path.join(PREVIEW_DIR, name + tag + ".png")
            bpy.ops.render.render(write_still=True)


ASSETS = {
    "block_stone_body": lambda: kit_body("stone"),
    "block_stone_gate": lambda: kit_body("stone", True),
    "block_stone_cap_keep": lambda: kit_cap("stone", "keep"),
    "block_stone_cap_wall": lambda: kit_cap("stone", "wall"),
    "block_stone_cap_corner": lambda: kit_cap("stone", "corner"),
    "block_wood_body": lambda: kit_body("wood"),
    "block_wood_gate": lambda: kit_body("wood", True),
    "block_wood_cap_keep": lambda: kit_cap("wood", "keep"),
    "block_wood_cap_wall": lambda: kit_cap("wood", "wall"),
    "block_wood_cap_corner": lambda: kit_cap("wood", "corner"),
    "block_bone_body": lambda: kit_body("bone"),
    "block_bone_gate": lambda: kit_body("bone", True),
    "block_bone_cap_keep": lambda: kit_cap("bone", "keep"),
    "block_bone_cap_wall": lambda: kit_cap("bone", "wall"),
    "block_bone_cap_corner": lambda: kit_cap("bone", "corner"),
    "turret_base": turret_base,
    "turret_head": turret_head,
    "castle_frame": castle_frame,
    "bat_player": lambda: bat("player"),
    "bat_rival": lambda: bat("rival"),
    "ghost": ghost,
    "moth": moth,
    "rock": rock,
    "rock_scatter": rock_scatter,
    "termite": termite,
    "termite_clump": termite_clump,
    "tree_pine_a": lambda: tree_pine(True),
    "tree_pine_b": lambda: tree_pine(False),
    "bush": bush,
    "grass_tuft": grass_tuft,
    "pond": pond,
}


def main():
    failed = []
    for name, build in ASSETS.items():
        if ONLY and name not in ONLY:
            continue
        clear()
        try:
            animated = bool(build())
            export(name, animated)
            if PREVIEW:
                preview(name)
        except Exception as err:
            import traceback
            traceback.print_exc()
            failed.append(name)
            print("[bat-siege] FAILED", name, err)
    print("[bat-siege] done.", "Failed: " + ", ".join(failed) if failed else "All assets built.")
    if failed:
        sys.exit(1)


main()
