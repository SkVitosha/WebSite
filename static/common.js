function initMobileMenu() {
  // Mobile menu functionality
  const overlay = document.getElementById("overlay");
  const hamburger = document.getElementById("hamburger");
  const nav = document.getElementById("nav");

  function checkScreenWidth() {
    if (window.innerWidth <= 768) {
      // Mobile: show hamburger, hide nav by default
      hamburger.style.display = "block";
      if (!nav.classList.contains("active")) {
        nav.style.display = "none";
      }
    } else {
      // Desktop: hide hamburger, show nav always
      hamburger.style.display = "none";
      nav.style.display = "block";
      nav.classList.remove("active"); // reset active state
    }
  }

  // Call on load
  checkScreenWidth();

  // Call on resize
  window.addEventListener("resize", () => {
    checkScreenWidth();
  });

  // Toggle menu on hamburger click
  hamburger.addEventListener("click", () => {
    overlay.classList.toggle("active");
    if (nav.classList.contains("active")) {
      nav.classList.remove("active");
      nav.style.display = "none";
    } else {
      nav.classList.add("active");
      nav.style.display = "block";
    }
    const isActive = nav.classList.contains("active");
    hamburger.style.display = isActive ? "none" : "block";
  });

  overlay.addEventListener("click", () => {
    nav.classList.remove("active");
    overlay.classList.remove("active");
    hamburger.style.display = "block";
  });
}

function initStickyHeader() {
  // Sticky header on scroll
  const header = document.getElementById("header");
  let scrolled = false;

  window.addEventListener("scroll", () => {
    if (window.scrollY > 50) {
      if (!scrolled) {
        header.classList.add("scrolled");
        scrolled = true;
      }
    } else {
      if (scrolled) {
        header.classList.remove("scrolled");
        scrolled = false;
      }
    }
  });
}
