(function () {
  var root = document.documentElement;

  // Theme: follows the system unless the visitor picked one.
  function storedTheme() {
    try {
      return localStorage.getItem('theme');
    } catch (e) {
      return null;
    }
  }
  function isDark() {
    var theme = root.getAttribute('data-theme');
    if (theme) return theme === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  var initial = storedTheme();
  if (initial) root.setAttribute('data-theme', initial);

  document.addEventListener('DOMContentLoaded', function () {
    var toggle = document.querySelector('.theme-toggle');
    if (toggle) {
      toggle.addEventListener('click', function () {
        var next = isDark() ? 'light' : 'dark';
        root.setAttribute('data-theme', next);
        try {
          localStorage.setItem('theme', next);
        } catch (e) {
          // Storage can be unavailable; the choice then lasts for this page only.
        }
      });
    }

    if (window.hljs) {
      document.querySelectorAll('pre code').forEach(function (block) {
        window.hljs.highlightElement(block);
      });
    }

    // Copy buttons on code blocks.
    document.querySelectorAll('pre').forEach(function (pre) {
      var button = document.createElement('button');
      button.className = 'copy';
      button.type = 'button';
      button.textContent = 'Copy';
      button.addEventListener('click', function () {
        copy(pre.querySelector('code').innerText, button);
      });
      pre.appendChild(button);
    });

    document.querySelectorAll('[data-copy]').forEach(function (el) {
      el.addEventListener('click', function () {
        copy(el.getAttribute('data-copy'), el.querySelector('.copy-label') || el);
      });
    });

    // Tabs.
    document.querySelectorAll('.tabs').forEach(function (tabs) {
      var buttons = tabs.querySelectorAll('[role="tab"]');
      buttons.forEach(function (button) {
        button.addEventListener('click', function () {
          buttons.forEach(function (other) {
            var selected = other === button;
            other.setAttribute('aria-selected', String(selected));
            document.getElementById(other.getAttribute('aria-controls')).hidden = !selected;
          });
        });
      });
    });

    // Guide: anchors on headings, menu on small screens, current section in the sidebar.
    document.querySelectorAll('.content h2[id], .content h3[id]').forEach(function (heading) {
      var link = document.createElement('a');
      link.className = 'anchor';
      link.href = '#' + heading.id;
      link.textContent = '#';
      link.setAttribute('aria-label', 'Link to this section');
      heading.appendChild(link);
    });

    var sidebar = document.querySelector('.sidebar');
    var menu = document.querySelector('.menu-toggle');
    if (sidebar && menu) {
      menu.addEventListener('click', function () {
        var open = sidebar.classList.toggle('open');
        menu.setAttribute('aria-expanded', String(open));
      });
      sidebar.addEventListener('click', function (event) {
        if (event.target.tagName === 'A') {
          sidebar.classList.remove('open');
          menu.setAttribute('aria-expanded', 'false');
        }
      });
    }

    var links = document.querySelectorAll('.sidebar a[href^="#"]');
    if (links.length && 'IntersectionObserver' in window) {
      var byId = {};
      links.forEach(function (link) {
        byId[link.getAttribute('href').slice(1)] = link;
      });
      var observer = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (entry.isIntersecting && byId[entry.target.id]) {
              links.forEach(function (link) {
                link.classList.remove('active');
              });
              byId[entry.target.id].classList.add('active');
            }
          });
        },
        { rootMargin: '-70px 0px -70% 0px' }
      );
      document.querySelectorAll('.content h2[id]').forEach(function (heading) {
        observer.observe(heading);
      });
    }
  });

  function copy(text, label) {
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText(text).then(function () {
      var previous = label.textContent;
      label.textContent = 'Copied';
      setTimeout(function () {
        label.textContent = previous;
      }, 1200);
    });
  }
})();
