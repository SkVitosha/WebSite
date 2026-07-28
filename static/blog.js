/* ============================================================
   Blog front-end — reads committed JSON, renders listing + post
   No auth needed here; these files are public in the repo.
   ============================================================ */

// Escape user-authored text before injecting into the DOM.
function escapeHtml(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// "2026-06-15" -> "15 юни 2026"
function formatDate(iso) {
  const months = [
    "януари", "февруари", "март", "април", "май", "юни",
    "юли", "август", "септември", "октомври", "ноември", "декември",
  ];
  const parts = String(iso).split("-");
  if (parts.length !== 3) return iso;
  const y = parts[0];
  const m = parseInt(parts[1], 10) - 1;
  const d = parseInt(parts[2], 10);
  if (isNaN(m) || isNaN(d) || !months[m]) return iso;
  return d + " " + months[m] + " " + y;
}

/* ---------------- Listing page (blog.html) ---------------- */
function renderBlogList(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  fetch("blog/index.json", { cache: "no-store" })
    .then(function (res) {
      if (!res.ok) throw new Error("index.json " + res.status);
      return res.json();
    })
    .then(function (posts) {
      if (!Array.isArray(posts) || posts.length === 0) {
        container.innerHTML =
          '<p class="blog-empty">Все още няма публикувани новини.</p>';
        return;
      }

      // Descending by date (newest first).
      posts.sort(function (a, b) {
        return String(b.date).localeCompare(String(a.date));
      });

      container.innerHTML = posts.map(cardHtml).join("");

      if (window.AOS && typeof AOS.refresh === "function") AOS.refresh();
    })
    .catch(function (err) {
      console.error("Failed to load blog index:", err);
      container.innerHTML =
        '<p class="blog-empty">В момента новините не могат да бъдат заредени.</p>';
    });
}

function cardHtml(post) {
  const href = "blog_post.html?slug=" + encodeURIComponent(post.slug);
  const cover = encodeURI(post.cover || "");
  return (
    '<a class="blog-card" href="' + href + '"' +
    ' data-aos="fade-up" data-aos-duration="800">' +
    '<div class="blog-card-image" style="background-image:url(\'' + cover + "')\"></div>" +
    '<div class="blog-card-info">' +
    '<p class="blog-card-date">' + escapeHtml(formatDate(post.date)) + "</p>" +
    '<h3 class="blog-card-title">' + escapeHtml(post.title) + "</h3>" +
    "</div></a>"
  );
}

/* ---------------- Detail page (blog_post.html) ---------------- */
function renderBlogPost(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const slug = new URLSearchParams(window.location.search).get("slug");
  if (!slug || !/^[a-z0-9-]+$/i.test(slug)) {
    container.innerHTML =
      '<p class="blog-empty">Публикацията не е намерена.</p>';
    return;
  }

  fetch("blog/posts/" + encodeURIComponent(slug) + ".json", { cache: "no-store" })
    .then(function (res) {
      if (!res.ok) throw new Error("post " + res.status);
      return res.json();
    })
    .then(function (post) {
      document.title = post.title + ' | KK "Витоша"';

      let html = "";
      html += '<div class="blog-post-date">' + escapeHtml(formatDate(post.date)) + "</div>";
      html += '<h1 class="blog-post-title">' + escapeHtml(post.title) + "</h1>";
      if (post.cover) {
        html +=
          '<img class="blog-post-cover" src="' + encodeURI(post.cover) +
          '" alt="' + escapeHtml(post.title) + '">';
      }
      html += '<div class="blog-post-body">';
      (post.blocks || []).forEach(function (block) {
        if (block.type === "paragraph") {
          html += '<p class="block-paragraph">' + escapeHtml(block.text) + "</p>";
        } else if (block.type === "image") {
          html +=
            '<img class="block-image" src="' + encodeURI(block.src) +
            '" alt="' + escapeHtml(block.alt || "") + '">';
        }
      });
      html += "</div>";

      container.innerHTML = html;
      if (window.AOS && typeof AOS.refresh === "function") AOS.refresh();
    })
    .catch(function (err) {
      console.error("Failed to load post:", err);
      container.innerHTML =
        '<p class="blog-empty">Публикацията не може да бъде заредена.</p>';
    });
}
