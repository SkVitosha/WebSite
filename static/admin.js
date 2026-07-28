/* ============================================================
   Blog admin — composes/edits posts and commits them to the repo
   via the GitHub Contents API. The GitHub token IS the credential:
   it lives only in sessionStorage (this tab), never in the code.

   Target repo + deploy branch are fixed below: the digital-ocean
   branch auto-deploys the live site.
   ============================================================ */

const REPO_OWNER = "SkVitosha";
const REPO_NAME = "WebSite";
const REPO_BRANCH = "digital-ocean";
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

/* ---------------- Slug (Cyrillic -> latin) ---------------- */
const TRANSLIT = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ж: "zh", з: "z",
  и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p",
  р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch",
  ш: "sh", щ: "sht", ъ: "a", ь: "y", ю: "yu", я: "ya",
};
function slugify(text) {
  return (
    String(text)
      .toLowerCase()
      .split("")
      .map(function (ch) {
        return Object.prototype.hasOwnProperty.call(TRANSLIT, ch) ? TRANSLIT[ch] : ch;
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
  const res = await gh(
    "GET",
    "/repos/" + REPO_OWNER + "/" + REPO_NAME + "/contents/" +
      encodePath(path) + "?ref=" + encodeURIComponent(REPO_BRANCH)
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("GET " + path + " → " + res.status);
  return await res.json();
}
async function putFile(path, base64, message, sha) {
  const body = { message: message, content: base64, branch: REPO_BRANCH };
  if (sha) body.sha = sha;
  const res = await gh(
    "PUT",
    "/repos/" + REPO_OWNER + "/" + REPO_NAME + "/contents/" + encodePath(path),
    body
  );
  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json()).message || ""; } catch (e) {}
    throw new Error("Записът в " + path + " се провали (" + res.status + "). " + detail);
  }
  return await res.json();
}

/* Verify the token can push to the repo. */
async function verifyLogin() {
  const res = await gh("GET", "/repos/" + REPO_OWNER + "/" + REPO_NAME);
  if (!res.ok) {
    throw new Error(
      res.status === 401
        ? "Невалиден токен."
        : "Няма достъп до " + REPO_OWNER + "/" + REPO_NAME + " (" + res.status + ")."
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

/* ---------------- Image upload ---------------- */
async function uploadImage(file, slug, tag) {
  const rawExt = (file.name.split(".").pop() || "jpg").toLowerCase();
  const ext = rawExt.replace(/[^a-z0-9]/g, "") || "jpg";
  // Timestamp keeps names unique, so re-uploads on edit never collide.
  const path =
    "blog/images/" + slug + "-" + tag + "-" + Date.now().toString(36) + "." + ext;
  const buf = await file.arrayBuffer();
  await putFile(path, arrayBufferToBase64(buf), "Add blog image: " + path + authorSuffix());
  return path;
}

/* Build the ordered blocks, uploading any newly-picked images.
   Each raw block: {type:'paragraph', text}
                 | {type:'image', file?:File, existingSrc?:string, alt} */
async function buildBlocks(rawBlocks, slug, say) {
  const blocks = [];
  let imgN = 1;
  for (let i = 0; i < rawBlocks.length; i++) {
    const b = rawBlocks[i];
    if (b.type === "paragraph") {
      blocks.push({ type: "paragraph", text: b.text });
    } else if (b.type === "image") {
      if (b.file) {
        say("Качване на снимка " + imgN + "…");
        const src = await uploadImage(b.file, slug, imgN);
        blocks.push({ type: "image", src: src, alt: b.alt || "" });
      } else if (b.existingSrc) {
        blocks.push({ type: "image", src: b.existingSrc, alt: b.alt || "" });
      }
      imgN++;
    }
  }
  return blocks;
}

/* ---------------- Create ---------------- */
async function publishPost(data, onProgress) {
  const say = onProgress || function () {};

  say("Проверка на съществуващите публикации…");
  const indexFile = await getFile("blog/index.json");
  let index = [];
  let indexSha;
  if (indexFile) {
    index = JSON.parse(base64ToUtf8(indexFile.content));
    indexSha = indexFile.sha;
  }
  const existing = {};
  index.forEach(function (p) { existing[p.slug] = true; });

  const base = data.date + "-" + slugify(data.title);
  let slug = base;
  let n = 2;
  while (existing[slug]) { slug = base + "-" + n; n++; }

  say("Качване на заглавната снимка…");
  const coverPath = await uploadImage(data.coverFile, slug, "cover");

  const blocks = await buildBlocks(data.blocks, slug, say);

  say("Записване на публикацията…");
  const postObj = { title: data.title, date: data.date, cover: coverPath, blocks: blocks };
  await putFile(
    "blog/posts/" + slug + ".json",
    utf8ToBase64(JSON.stringify(postObj, null, 4)),
    "Add blog post: " + data.title + authorSuffix()
  );

  say("Обновяване на списъка с новини…");
  index.push({ slug: slug, title: data.title, date: data.date, cover: coverPath });
  await putFile(
    "blog/index.json",
    utf8ToBase64(JSON.stringify(index, null, 4)),
    "Index blog post: " + data.title + authorSuffix(),
    indexSha
  );

  return slug;
}

/* ---------------- Edit (keeps the same slug/URL) ---------------- */
async function updatePost(slug, data, onProgress) {
  const say = onProgress || function () {};

  // Cover: upload a new one only if the user picked a file; else keep existing.
  let coverPath;
  if (data.coverFile) {
    say("Качване на новата корица…");
    coverPath = await uploadImage(data.coverFile, slug, "cover");
  } else {
    coverPath = data.existingCover;
  }

  const blocks = await buildBlocks(data.blocks, slug, say);

  say("Записване на промените…");
  const existing = await getFile("blog/posts/" + slug + ".json");
  const postObj = { title: data.title, date: data.date, cover: coverPath, blocks: blocks };
  await putFile(
    "blog/posts/" + slug + ".json",
    utf8ToBase64(JSON.stringify(postObj, null, 4)),
    "Edit blog post: " + data.title + authorSuffix(),
    existing ? existing.sha : undefined
  );

  say("Обновяване на списъка с новини…");
  const indexFile = await getFile("blog/index.json");
  let index = indexFile ? JSON.parse(base64ToUtf8(indexFile.content)) : [];
  let found = false;
  index = index.map(function (p) {
    if (p.slug === slug) {
      found = true;
      return { slug: slug, title: data.title, date: data.date, cover: coverPath };
    }
    return p;
  });
  if (!found) {
    index.push({ slug: slug, title: data.title, date: data.date, cover: coverPath });
  }
  await putFile(
    "blog/index.json",
    utf8ToBase64(JSON.stringify(index, null, 4)),
    "Update index: " + data.title + authorSuffix(),
    indexFile ? indexFile.sha : undefined
  );

  return slug;
}
