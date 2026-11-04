// A scene (src/render/scene.js) on its way to a child process of the rasterizer pool. Its pictures are data URIs, often the same
// one at many places (nails, tiles of a texture); the message carries each once, and the image nodes their index.

/** @returns {{tree: object, hrefs: string[]}} a copy of `scene` whose image nodes have `href` as an index into `hrefs` */
export function packScene(scene) {
  const hrefs = [];
  const index = new Map();
  const pack = (node) => {
    if (Array.isArray(node)) return node.map(pack);
    if (node === null || typeof node !== "object") return node;
    const copy = { ...node };
    if (node.type === "image" && typeof node.href === "string") {
      let i = index.get(node.href);
      if (i === undefined) { i = hrefs.push(node.href) - 1; index.set(node.href, i); }
      copy.href = i;
    }
    if (node.children) copy.children = pack(node.children);
    return copy;
  };
  return { tree: pack(scene), hrefs };
}

/** The scene of `packScene`, in place: image nodes get their `href` back. */
export function unpackScene({ tree, hrefs }) {
  const unpack = (node) => {
    if (Array.isArray(node)) { node.forEach(unpack); return; }
    if (node === null || typeof node !== "object") return;
    if (node.type === "image" && typeof node.href === "number") node.href = hrefs[node.href];
    if (node.children) unpack(node.children);
  };
  unpack(tree);
  return tree;
}
