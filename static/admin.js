/* ============================================================
   Blog admin — composes/edits posts and commits them to the repo
   via the GitHub Contents API. The GitHub token IS the credential:
   it lives only in sessionStorage (this tab), never in the code.

   Target repo is fixed below. Every write is committed to BOTH
   branches in REPO_BRANCHES so they stay in sync: digital-ocean
   (auto-deploys the live site) and main-without-cal (staging).
   Reads for the admin UI come from PRIMARY_BRANCH.
   ============================================================ */

const REPO_OWNER = "SkVitosha";
const REPO_NAME = "WebSite";
// Every publish/edit is committed to all of these branches.
const REPO_BRANCHES = ["digital-ocean", "main-without-cal"]; //"digital-ocean"
// The admin UI reads the post list / posts from this one (they stay in sync).
const PRIMARY_BRANCH = REPO_BRANCHES[0];
const GH_API = "https://api.github.com";

/* ---------------- Session / config ---------------- */
function getConfig() {
  try {
    return JSON.parse(sessionStorage.getItem("blogAdmin") || "null");
  } catch (e) {
    return null;
  }
}
function setConfig(cfg) {
  sessionStorage.setItem("blogAdmin", JSON.stringify(cfg));
}
function clearConfig() {
  sessionStorage.removeItem("blogAdmin");
}
function authorSuffix() {
  const c = getConfig();
  return c && c.name ? " (by " + c.name + ")" : "";
}

/* ---------------- Encoding helpers ---------------- */
function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}
function base64ToUtf8(b64) {
  const bin = atob(String(b64).replace(/\s/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

/* ---------------- Rich-text sanitising ----------------
   Paragraphs are authored in a small WYSIWYG editor (bold/italic/underline,
   lists, super/subscript). Keep only that whitelist of tags and drop every
   attribute before the HTML is committed, so nothing unsafe is ever stored.
   (Mirrors sanitizeBlockHtml in static/blog.js — keep the two in sync.) */
function sanitizeBlockHtml(html) {
  const ALLOWED = {
    B: 1,
    STRONG: 1,
    I: 1,
    EM: 1,
    U: 1,
    SUP: 1,
    SUB: 1,
    UL: 1,
    OL: 1,
    LI: 1,
    BR: 1,
    P: 1,
    DIV: 1,
  };
  const root = document.createElement("div");
  root.innerHTML = String(html == null ? "" : html);
  (function walk(node) {
    const children = Array.prototype.slice.call(node.childNodes);
    children.forEach(function (child) {
      if (child.nodeType === 1) {
        const tag = child.tagName;
        if (tag === "SCRIPT" || tag === "STYLE") {
          node.removeChild(child);
          return;
        }
        walk(child);
        if (ALLOWED[tag]) {
          while (child.attributes.length) {
            child.removeAttribute(child.attributes[0].name);
          }
        } else {
          while (child.firstChild) node.insertBefore(child.firstChild, child);
          node.removeChild(child);
        }
      } else if (child.nodeType === 8) {
        node.removeChild(child);
      }
    });
  })(root);
  return root.innerHTML;
}
// Does the sanitised HTML actually carry any visible text/content?
function richHtmlIsEmpty(html) {
  const root = document.createElement("div");
  root.innerHTML = String(html == null ? "" : html);
  if (root.querySelector("img, ul, ol, li")) return false;
  return root.textContent.replace(/ /g, " ").trim() === "";
}

/* ---------------- Slug (Cyrillic -> latin) ---------------- */
const TRANSLIT = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ж: "zh",
  з: "z",
  и: "i",
  й: "y",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "h",
  ц: "ts",
  ч: "ch",
  ш: "sh",
  щ: "sht",
  ъ: "a",
  ь: "y",
  ю: "yu",
  я: "ya",
};
function slugify(text) {
  return (
    String(text)
      .toLowerCase()
      .split("")
      .map(function (ch) {
        return Object.prototype.hasOwnProperty.call(TRANSLIT, ch)
          ? TRANSLIT[ch]
          : ch;
      })
      .join("")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "post"
  );
}

/* ---------------- GitHub API ---------------- */
function encodePath(p) {
  return p.split("/").map(encodeURIComponent).join("/");
}
async function gh(method, path, body) {
  const cfg = getConfig();
  const res = await fetch(GH_API + path, {
    method: method,
    headers: {
      Authorization: "token " + cfg.token,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res;
}
async function getFile(path) {
  return await getFileFrom(path, PRIMARY_BRANCH);
}
async function getFileFrom(path, branch) {
  const res = await gh(
    "GET",
    "/repos/" +
      REPO_OWNER +
      "/" +
      REPO_NAME +
      "/contents/" +
      encodePath(path) +
      "?ref=" +
      encodeURIComponent(branch),
  );
  if (res.status === 404) return null;
  if (!res.ok)
    throw new Error("GET " + path + "@" + branch + " → " + res.status);
  return await res.json();
}
// Parse a GitHub API response as JSON, throwing a readable error on failure.
async function ghJson(method, path, body) {
  const res = await gh(method, path, body);
  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.json()).message || "";
    } catch (e) {}
    throw new Error(
      method +
        " " +
        path +
        " → " +
        res.status +
        (detail ? " (" + detail + ")" : ""),
    );
  }
  return await res.json();
}

/* ---- Single-commit writes (Git Data API) ----
   Commit a whole set of file changes as ONE commit per branch: create a
   blob per file, build a tree on top of the branch's current tree, then a
   commit, then move the branch. A post's cover + block images + JSON +
   index land together → exactly one redeploy, and never a half-written
   state (the branch only moves once everything is staged).
   ops entries: {path, contentBase64}  add / update
              | {path, delete:true}    remove */
async function commitAllToBranch(branch, ops, message) {
  const repo = "/repos/" + REPO_OWNER + "/" + REPO_NAME;

  // Current head of the branch and the tree it points at.
  const ref = await ghJson("GET", repo + "/git/ref/heads/" + branch);
  const headSha = ref.object.sha;
  const headCommit = await ghJson("GET", repo + "/git/commits/" + headSha);
  const baseTreeSha = headCommit.tree.sha;

  // When deleting, learn which paths actually exist — asking Git to remove
  // a path that isn't in the tree would fail the whole commit.
  let existing = null;
  if (
    ops.some(function (o) {
      return o.delete;
    })
  ) {
    const full = await ghJson(
      "GET",
      repo + "/git/trees/" + baseTreeSha + "?recursive=1",
    );
    existing = {};
    (full.tree || []).forEach(function (t) {
      if (t.type === "blob") existing[t.path] = true;
    });
  }

  // Build the tree entries, uploading a blob for each add/update.
  const tree = [];
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (op.delete) {
      if (existing && existing[op.path]) {
        tree.push({ path: op.path, mode: "100644", type: "blob", sha: null });
      }
    } else {
      const blob = await ghJson("POST", repo + "/git/blobs", {
        content: op.contentBase64,
        encoding: "base64",
      });
      tree.push({
        path: op.path,
        mode: "100644",
        type: "blob",
        sha: blob.sha,
      });
    }
  }
  if (tree.length === 0) return; // nothing to change on this branch

  const newTree = await ghJson("POST", repo + "/git/trees", {
    base_tree: baseTreeSha,
    tree: tree,
  });
  const commit = await ghJson("POST", repo + "/git/commits", {
    message: message,
    tree: newTree.sha,
    parents: [headSha],
  });
  await ghJson("PATCH", repo + "/git/refs/heads/" + branch, {
    sha: commit.sha,
  });
}

// Apply the same batched commit to every target branch.
async function commitAllEverywhere(ops, message) {
  for (let i = 0; i < REPO_BRANCHES.length; i++) {
    await commitAllToBranch(REPO_BRANCHES[i], ops, message);
  }
}

/* Verify the token can push to the repo. */
async function verifyLogin() {
  const res = await gh("GET", "/repos/" + REPO_OWNER + "/" + REPO_NAME);
  if (!res.ok) {
    throw new Error(
      res.status === 401
        ? "Невалиден токен."
        : "Няма достъп до " +
            REPO_OWNER +
            "/" +
            REPO_NAME +
            " (" +
            res.status +
            ").",
    );
  }
  const data = await res.json();
  if (!data.permissions || !data.permissions.push) {
    throw new Error("Токенът няма права за запис (Contents: Read and write).");
  }
}

/* ---------------- Reads for the admin UI ---------------- */
async function fetchIndex() {
  const idx = await getFile("blog/index.json");
  if (!idx) return [];
  return JSON.parse(base64ToUtf8(idx.content));
}
async function fetchPost(slug) {
  const f = await getFile("blog/posts/" + slug + ".json");
  if (!f) throw new Error("Публикацията не е намерена.");
  return JSON.parse(base64ToUtf8(f.content));
}

/* ---------------- Image prep (no network) ----------------
   Read an image file into a base64 blob + its committed path. The actual
   upload happens later, inside the single batched commit. */
async function prepareImage(file, slug, tag) {
  const rawExt = (file.name.split(".").pop() || "jpg").toLowerCase();
  const ext = rawExt.replace(/[^a-z0-9]/g, "") || "jpg";
  // Timestamp keeps names unique, so re-uploads on edit never collide.
  const path =
    "blog/images/" +
    slug +
    "-" +
    tag +
    "-" +
    Date.now().toString(36) +
    "." +
    ext;
  const buf = await file.arrayBuffer();
  return { path: path, contentBase64: arrayBufferToBase64(buf) };
}

/* Build the ordered blocks, preparing (but not yet committing) any newly
   picked images. Returns the blocks plus the image file ops to include in
   the batched commit.
   Each raw block: {type:'paragraph', html}
                 | {type:'image', file?:File, existingSrc?:string, alt} */
async function buildBlocks(rawBlocks, slug, say) {
  const blocks = [];
  const imageOps = [];
  let imgN = 1;
  for (let i = 0; i < rawBlocks.length; i++) {
    const b = rawBlocks[i];
    if (b.type === "paragraph") {
      blocks.push({ type: "paragraph", html: sanitizeBlockHtml(b.html) });
    } else if (b.type === "image") {
      if (b.file) {
        say("Подготовка на снимка " + imgN + "…");
        const op = await prepareImage(b.file, slug, imgN);
        blocks.push({ type: "image", src: op.path, alt: b.alt || "" });
        imageOps.push(op);
      } else if (b.existingSrc) {
        blocks.push({ type: "image", src: b.existingSrc, alt: b.alt || "" });
      }
      imgN++;
    }
  }
  return { blocks: blocks, imageOps: imageOps };
}

/* ---------------- Create ---------------- */
async function publishPost(data, onProgress) {
  const say = onProgress || function () {};

  say("Проверка на съществуващите публикации…");
  let index = await fetchIndex();
  const existing = {};
  index.forEach(function (p) {
    existing[p.slug] = true;
  });

  const base = data.date + "-" + slugify(data.title);
  let slug = base;
  let n = 2;
  while (existing[slug]) {
    slug = base + "-" + n;
    n++;
  }

  say("Подготовка на файловете…");
  const coverOp = await prepareImage(data.coverFile, slug, "cover");
  const built = await buildBlocks(data.blocks, slug, say);

  const postObj = {
    title: data.title,
    date: data.date,
    cover: coverOp.path,
    blocks: built.blocks,
  };
  index.push({
    slug: slug,
    title: data.title,
    date: data.date,
    cover: coverOp.path,
  });

  // Cover + block images + post JSON + index — all in one commit.
  const ops = [coverOp].concat(built.imageOps);
  ops.push({
    path: "blog/posts/" + slug + ".json",
    contentBase64: utf8ToBase64(JSON.stringify(postObj, null, 4)),
  });
  ops.push({
    path: "blog/index.json",
    contentBase64: utf8ToBase64(JSON.stringify(index, null, 4)),
  });

  say("Публикуване…");
  await commitAllEverywhere(
    ops,
    "Add blog post: " + data.title + authorSuffix(),
  );

  return slug;
}

/* ---------------- Edit (keeps the same slug/URL) ---------------- */
async function updatePost(slug, data, onProgress) {
  const say = onProgress || function () {};

  say("Подготовка на файловете…");
  const ops = [];

  // Cover: upload a new one only if the user picked a file; else keep existing.
  let coverPath;
  if (data.coverFile) {
    const coverOp = await prepareImage(data.coverFile, slug, "cover");
    coverPath = coverOp.path;
    ops.push(coverOp);
  } else {
    coverPath = data.existingCover;
  }

  const built = await buildBlocks(data.blocks, slug, say);
  for (let i = 0; i < built.imageOps.length; i++) ops.push(built.imageOps[i]);

  const postObj = {
    title: data.title,
    date: data.date,
    cover: coverPath,
    blocks: built.blocks,
  };
  ops.push({
    path: "blog/posts/" + slug + ".json",
    contentBase64: utf8ToBase64(JSON.stringify(postObj, null, 4)),
  });

  let index = await fetchIndex();
  let found = false;
  index = index.map(function (p) {
    if (p.slug === slug) {
      found = true;
      return {
        slug: slug,
        title: data.title,
        date: data.date,
        cover: coverPath,
      };
    }
    return p;
  });
  if (!found) {
    index.push({
      slug: slug,
      title: data.title,
      date: data.date,
      cover: coverPath,
    });
  }
  ops.push({
    path: "blog/index.json",
    contentBase64: utf8ToBase64(JSON.stringify(index, null, 4)),
  });

  say("Записване на промените…");
  await commitAllEverywhere(
    ops,
    "Edit blog post: " + data.title + authorSuffix(),
  );

  return slug;
}

/* ---------------- Delete (post + its images, one commit per branch) ---------------- */
async function deletePost(slug, onProgress) {
  const say = onProgress || function () {};

  // Read the post first to learn which images belong to it.
  say("Зареждане на публикацията…");
  let imagePaths = [];
  try {
    const post = await fetchPost(slug);
    if (post.cover && post.cover.indexOf("blog/images/") === 0)
      imagePaths.push(post.cover);
    (post.blocks || []).forEach(function (b) {
      if (b.type === "image" && b.src && b.src.indexOf("blog/images/") === 0)
        imagePaths.push(b.src);
    });
  } catch (e) {
    // Post file missing already — still clean up the index below.
  }

  say("Обновяване на списъка…");
  let index = await fetchIndex();
  index = index.filter(function (p) {
    return p.slug !== slug;
  });

  // Rewrite the index + remove the post file and its images — all together.
  const ops = [
    {
      path: "blog/index.json",
      contentBase64: utf8ToBase64(JSON.stringify(index, null, 4)),
    },
    { path: "blog/posts/" + slug + ".json", delete: true },
  ];
  for (let i = 0; i < imagePaths.length; i++) {
    ops.push({ path: imagePaths[i], delete: true });
  }

  say("Изтриване…");
  await commitAllEverywhere(ops, "Delete blog post: " + slug + authorSuffix());
}
