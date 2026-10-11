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


# ---------------------------------------------------------------- blocks


def block_stone_body(arch=False):
    B = Builder()
    h = LH - 0.06
    skip = (lambda f, m, z: f == "front" and abs(m) < 0.3 and z < 0.66) if arch else None
    brick_shell(B, BW, BW, h, 0.0, STONE, MORTAR, skip=skip)
    B.box((BW + 0.03, BW + 0.03, 0.06), (0, 0, LH - 0.03), SLAB, 0.015)
    sockets = []
    if arch:
        y = -BW / 2 + 0.012
        B.box((0.42, 0.03, 0.42), (0, y, 0.21), SOCKET)
        B.cone(0.21, 0.21, 0.03, (0, y, 0.42), SOCKET, seg=14, rot=Matrix.Rotation(math.pi / 2, 4, "X"))
        for k in range(7):
            a = math.pi * k / 6
            B.box((0.12, 0.07, 0.1), (math.cos(a) * 0.27, y - 0.02, 0.42 + math.sin(a) * 0.27),
                  random.choice(STONE), 0.012, rot=Matrix.Rotation(a + math.pi / 2, 4, "Y"))
        for sx in (-1, 1):
            for k in range(3):
                B.box((0.1, 0.07, 0.12), (sx * 0.27, y - 0.02, 0.07 + k * 0.13), random.choice(STONE), 0.012)
        for sx in (-1, 1):
            sockets.append(add_torch(B, sx * 0.47, -BW / 2 - 0.02, 0.4))
    o = B.obj("StoneBody" + ("Arch" if arch else ""))
    for i, p in enumerate(sockets):
        empty("TorchSocket_%d" % i, p, o)
    return False


def block_stone_cap():
    B = Builder()
    B.box((BW - 0.1, BW - 0.1, 0.04), (0, 0, 0.02), FLOOR_MATS[1])
    for x, y in [(-1, -1), (1, -1), (-1, 1), (1, 1), (0, -1), (0, 1), (-1, 0), (1, 0)]:
        merlon(B, x * 0.48, y * 0.48, 0.0)
    B.obj("StoneCap")
    return False


def block_wood_body():
    B = Builder()
    h = LH - 0.06
    B.box((BW - 0.1, BW - 0.1, h), (0, 0, h / 2), WOOD_DARK)
    n = 6
    for side, (L, ox, oy, axis) in {
        "front": (BW - 0.16, 0, -BW / 2 + 0.04, "x"), "back": (BW - 0.16, 0, BW / 2 - 0.04, "x"),
        "left": (BW - 0.16, -BW / 2 + 0.04, 0, "y"), "right": (BW - 0.16, BW / 2 - 0.04, 0, "y"),
    }.items():
        pw = L / n
        for k in range(n):
            c = -L / 2 + pw / 2 + k * pw
            ph = h - random.uniform(0.0, 0.04)
            t = 0.06 + random.uniform(-0.01, 0.012)
            m = random.choice(WOODS)
            if axis == "x":
                B.box((pw - 0.014, t, ph), (ox + c, oy, ph / 2), m, 0.01)
            else:
                B.box((t, pw - 0.014, ph), (ox, oy + c, ph / 2), m, 0.01)
    for sx in (-1, 1):
        for sy in (-1, 1):
            B.box((0.13, 0.13, h + 0.02), (sx * (BW / 2 - 0.05), sy * (BW / 2 - 0.05), (h + 0.02) / 2), WOOD_DARK, 0.018)
    for z in (0.17, h - 0.17):
        for side in ("front", "back", "left", "right"):
            if side in ("front", "back"):
                y = (-1 if side == "front" else 1) * (BW / 2 + 0.005)
                B.box((BW - 0.1, 0.03, 0.06), (0, y, z), IRON, 0.008)
                for k in range(5):
                    B.box((0.035, 0.03, 0.035), (-0.48 + k * 0.24, y + (-0.015 if side == "front" else 0.015), z), IRON, 0.006)
            else:
                x = (-1 if side == "left" else 1) * (BW / 2 + 0.005)
                B.box((0.03, BW - 0.1, 0.06), (x, 0, z), IRON, 0.008)
    for k in range(5):
        B.box((BW - 0.04, (BW - 0.04) / 5 - 0.015, 0.06), (0, -BW / 2 + 0.02 + (BW - 0.04) / 10 + k * (BW - 0.04) / 5, LH - 0.03),
              random.choice(WOODS), 0.01)
    B.obj("WoodBody")
    return False


def block_wood_cap():
    B = Builder()
    ph = 0.55
    d = BW + 0.18
    w = BW + 0.14
    B.tri_prism(BW - 0.08, BW - 0.08, ph - 0.05, (0, 0, 0), WOODS[1])
    for gx in (-1, 1):
        x = gx * (BW / 2 - 0.035)
        for k in range(4):
            z = 0.06 + k * 0.11
            half = (BW - 0.08) / 2 * (1 - z / (ph - 0.05))
            if half > 0.05:
                B.box((0.03, half * 2 - 0.02, 0.09), (x + gx * 0.012, 0, z), random.choice(WOODS), 0.008)
    slope = math.atan2(ph, d / 2)
    L = math.hypot(ph, d / 2)
    rows, cols = 5, 6
    for side in (-1, 1):
        rot = Matrix.Rotation(-side * slope, 4, "X")
        nrm = Vector((0, side * math.sin(slope), math.cos(slope)))
        for r in range(rows):
            t = (r + 0.5) / rows
            y = side * (d / 2) * (1 - t)
            z = ph * t
            off = (w / cols / 2) if r % 2 else 0.0
            for c in range(cols + 1):
                x = -w / 2 + c * (w / cols) - off + w / cols / 2
                a, b = max(x - w / cols / 2, -w / 2), min(x + w / cols / 2, w / 2)
                if b - a < 0.05:
                    continue
                p = Vector(((a + b) / 2, y, z)) + nrm * (0.03 + 0.012 * (rows - r))
                B.box((b - a - 0.015, L / rows * 1.25, 0.045), p, random.choice(ROOF), 0.01, rot=rot)
    B.box((w + 0.06, 0.13, 0.09), (0, 0, ph + 0.06), ROOF[2], 0.02)
    B.obj("WoodCap")
    return False


def block_bone_body():
    B = Builder()
    h = LH - 0.06
    brick_shell(B, BW, BW, h, 0.0, BONES, MORTAR, bh=0.185, bl=0.42, bevel=0.03, depth=0.04)
    B.box((BW + 0.03, BW + 0.03, 0.06), (0, 0, LH - 0.03), BONES[2], 0.02)
    fy = -BW / 2 - 0.02
    for ang in (0.62, -0.62):
        rot = Matrix.Rotation(math.pi / 2 + ang, 4, "Y")
        B.cone(0.03, 0.03, 0.5, (0, fy - 0.01, 0.36), BONE_WHITE, seg=8, rot=rot, smooth=True)
        dx, dz = math.cos(ang) * 0.25, -math.sin(ang) * 0.25
        for s in (-1, 1):
            for k in (-0.03, 0.03):
                B.sphere(0.04, (s * dx + k * math.sin(ang), fy - 0.01, 0.36 + s * dz + k * math.cos(ang)), BONE_WHITE, seg=8, rings=6)
    B.sphere(0.16, (0, fy - 0.06, 0.44), BONE_WHITE, scale=(1, 0.55, 0.92))
    B.box((0.16, 0.08, 0.08), (0, fy - 0.07, 0.31), BONE_WHITE, 0.025)
    for sx in (-1, 1):
        B.sphere(0.045, (sx * 0.06, fy - 0.135, 0.45), SOCKET, seg=10, rings=7, scale=(1, 0.5, 1.15))
    B.cone(0.025, 0.0, 0.045, (0, fy - 0.145, 0.385), SOCKET, seg=3, rot=Matrix.Rotation(math.pi, 4, "X"))
    for k in range(3):
        B.box((0.025, 0.02, 0.035), (-0.035 + k * 0.035, fy - 0.11, 0.305), SOCKET)
    B.obj("BoneBody")
    return False


def block_bone_cap():
    B = Builder()
    B.box((BW - 0.02, BW - 0.02, 0.08), (0, 0, 0.04), BONES[1], 0.02)
    verts = B.sphere(0.48, (0, 0, 0.08), BONES[0], seg=20, rings=12)
    bmesh.ops.delete(B.bm, geom=[v for v in verts if v.co.z < 0.08 - 1e-4], context="VERTS")
    for k in range(6):
        a = k / 6 * math.pi * 2
        B.box((0.06, 0.06, 0.06), (math.cos(a) * 0.44, math.sin(a) * 0.44, 0.13), BONE_WHITE, 0.015)
    for sx in (-1, 1):
        for sy in (-1, 1):
            base = Vector((sx * 0.52, sy * 0.52, 0.08))
            tip = base + Vector((sx * 0.12, sy * 0.12, 0.42))
            B.cyl_between(base, tip, 0.075, BONES[2], seg=8, r2=0.0)
    B.sphere(0.07, (0, 0, 0.58), BONE_WHITE, seg=10, rings=7)
    B.obj("BoneCap")
    return False


# ---------------------------------------------------------------- castle frame


def castle_frame():
    B = Builder()
    GW, GD = 6 * CELL, 3 * CELL
    t = 0.34
    B.box((GW + 2 * t + 0.6, GD + 2 * t + 0.6, 0.16), (0, 0, 0.08), MORTAR, 0.03)
    for c in range(6):
        for r in range(3):
            cx, cy = -GW / 2 + CELL / 2 + c * CELL, -GD / 2 + CELL / 2 + r * CELL
            for i in (-1, 1):
                for j in (-1, 1):
                    hh = 0.08 + random.uniform(0.0, 0.012)
                    B.box((CELL / 2 - 0.05, CELL / 2 - 0.05, hh), (cx + i * CELL / 4, cy + j * CELL / 4, 0.16 + hh / 2),
                          random.choice(FLOOR_MATS), 0.014)
    wh = 0.5
    inner_x, inner_y = GW / 2 + 0.06, GD / 2 + 0.06
    for sy in (-1, 1):
        brick_shell(B, GW + 0.12, t, wh, 0.16, STONE, MORTAR, cx=0, cy=sy * (inner_y + t / 2), bh=0.17)
        B.box((GW + 0.16, t + 0.06, 0.07), (0, sy * (inner_y + t / 2), 0.16 + wh + 0.035), SLAB, 0.015)
    for sx in (-1, 1):
        brick_shell(B, t, GD + 0.12, wh, 0.16, STONE, MORTAR, cx=sx * (inner_x + t / 2), cy=0, bh=0.17)
        B.box((t + 0.06, GD + 0.16, 0.07), (sx * (inner_x + t / 2), 0, 0.16 + wh + 0.035), SLAB, 0.015)
    sockets = []
    ts, th = 0.95, 1.45
    for sx in (-1, 1):
        for sy in (-1, 1):
            cx, cy = sx * (inner_x + t / 2), sy * (inner_y + t / 2)
            brick_shell(B, ts, ts, th, 0.16, STONE, MORTAR, cx=cx, cy=cy, bh=0.18, bl=0.3)
            B.box((ts + 0.08, ts + 0.08, 0.07), (cx, cy, 0.16 + th + 0.035), SLAB, 0.015)
            for mx, my in [(-1, -1), (1, -1), (-1, 1), (1, 1)]:
                merlon(B, cx + mx * 0.34, cy + my * 0.34, 0.16 + th + 0.07, size=0.26, height=0.26)
            B.box((0.08, 0.03, 0.26), (cx, cy - ts / 2 - 0.004, 0.16 + th * 0.62), SOCKET)
            sockets.append(add_torch(B, cx, cy - ts / 2 - 0.02, 0.16 + 0.55))
    o = B.obj("CastleFrame")
    for i, p in enumerate(sockets):
        empty("TorchSocket_%d" % i, p, o)
    empty("GridOrigin", (0, 0, FLOOR), o)
    return False


# ---------------------------------------------------------------- creatures


def wing_points():
    lead = [(0.0, -0.10), (0.5, -0.31), (1.05, -0.36), (1.36, -0.13)]
    trail = []
    trail += quad_pts((1.36, -0.13), (1.13, 0.02), (1.05, 0.28))
    trail += quad_pts((1.05, 0.28), (0.88, 0.12), (0.72, 0.30))
    trail += quad_pts((0.72, 0.30), (0.55, 0.12), (0.38, 0.28))
    trail += quad_pts((0.38, 0.28), (0.24, 0.10), (0.0, 0.16))
    return lead + trail


def bat(name, body_hex, wing_hex, eye_hex):
    BODY = mat(name + "_body", body_hex, rough=0.75)
    WING = mat(name + "_wing", wing_hex, rough=0.85, double=True)
    EYE = mat(name + "_eye", eye_hex, emit=eye_hex, emit_strength=5.0)
    INNER = mat(name + "_inner", wing_hex, rough=0.9)
    B = Builder()
    # chubby fuzzy torso + big round head (chibi proportions like the concept art)
    B.sphere(0.25, (0, 0.04, -0.02), BODY, scale=(1, 1.2, 0.9))
    B.sphere(0.27, (0, -0.26, 0.13), BODY, seg=18, rings=12)
    for k in range(7):  # fur tuft ring on the chest
        a = k / 7 * math.pi * 2
        B.cone(0.05, 0.0, 0.09, (math.cos(a) * 0.17, -0.06 + math.sin(a) * 0.12, 0.12), BODY, seg=5,
               rot=Matrix.Rotation(0.5, 4, "X"))
    for sx in (-1, 1):
        ear_rot = Matrix.Rotation(-sx * 0.38, 4, "Y") @ Matrix.Rotation(0.12, 4, "X")
        B.cone(0.1, 0.0, 0.3, (sx * 0.15, -0.22, 0.47), BODY, seg=8, rot=ear_rot)
        B.cone(0.06, 0.0, 0.2, (sx * 0.15, -0.255, 0.45), INNER, seg=6, rot=ear_rot, scale=(1, 0.5, 1))
        B.sphere(0.072, (sx * 0.1, -0.49, 0.17), EYE, seg=12, rings=8, scale=(1, 0.6, 1.15))
        B.sphere(0.022, (sx * 0.11, -0.535, 0.2), FANG, seg=6, rings=4)  # eye glint
        B.cone(0.022, 0.0, 0.075, (sx * 0.045, -0.49, 0.02), FANG, seg=5, rot=Matrix.Rotation(math.pi + 0.25, 4, "X"))
        B.sphere(0.045, (sx * 0.1, 0.17, -0.2), BODY, seg=8, rings=6)
        B.cone(0.012, 0.0, 0.06, (sx * 0.1, 0.19, -0.26), FANG, seg=4, rot=Matrix.Rotation(math.pi, 4, "X"))
    B.sphere(0.035, (0, -0.52, 0.08), INNER, seg=8, rings=6, scale=(1.3, 0.7, 0.8))  # snout
    body = B.obj("Bat_" + name)
    pts = wing_points()
    wings = []
    for side in (1, -1):
        W = Builder()
        P = [(side * x, y) for x, y in pts]
        W.poly(P, WING, z=0.0, smooth=True)
        bone_tips = [(1.36, -0.13), (1.05, 0.28), (0.72, 0.30), (0.38, 0.28)]
        W.cyl_between((0, -0.08, 0.01), (side * 1.05, -0.36, 0.01), 0.018, BODY, seg=5)
        for tx, ty in bone_tips:
            W.cyl_between((side * 1.0, -0.33, 0.01), (side * tx, ty, 0.01), 0.011, BODY, seg=4)
        W.sphere(0.03, (side * 1.04, -0.36, 0.015), BODY, seg=6, rings=5)
        wo = W.obj(("WingL_" if side > 0 else "WingR_") + name, parent=body, loc=(side * 0.16, -0.02, 0.05))
        wo.rotation_mode = "XYZ"
        wings.append((wo, side))
    scn = bpy.context.scene
    scn.frame_start, scn.frame_end = 1, 17
    for f, a in ((1, -0.6), (5, 0.1), (9, 0.65), (13, 0.1), (17, -0.6)):
        for wo, side in wings:
            wo.rotation_euler = (0.0, a * side, 0.0)
            wo.keyframe_insert("rotation_euler", frame=f)
    return True


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
    cam.location = center + Vector((size * 0.9, -size * 1.5, size * 1.1))
    cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()
    sun_data = bpy.data.lights.new("PreviewSun", "SUN")
    sun_data.energy = 3.0
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
        bg.inputs[1].default_value = 0.8
    scn.render.engine = "CYCLES"
    scn.cycles.samples = 24
    scn.cycles.device = "CPU"
    scn.render.resolution_x = scn.render.resolution_y = 512
    scn.render.filepath = os.path.join(PREVIEW_DIR, name + ".png")
    bpy.ops.render.render(write_still=True)
    print("[bat-siege] preview", scn.render.filepath)


ASSETS = {
    "block_stone_body": lambda: block_stone_body(False),
    "block_stone_body_arch": lambda: block_stone_body(True),
    "block_stone_cap": block_stone_cap,
    "block_wood_body": block_wood_body,
    "block_wood_cap": block_wood_cap,
    "block_bone_body": block_bone_body,
    "block_bone_cap": block_bone_cap,
    "castle_frame": castle_frame,
    "bat_player": lambda: bat("player", "#2b2233", "#3b2d4b", "#ffb340"),
    "bat_rival": lambda: bat("rival", "#3a1c1a", "#4d2420", "#ff4a3a"),
    "ghost": ghost,
    "moth": moth,
    "rock": rock,
    "rock_scatter": rock_scatter,
    "termite": termite,
    "termite_clump": termite_clump,
    "torch": torch,
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
