  // Tailwind play-CDN config for the Custom Price Upload Mod 2 block. Theme
  // colours/fonts arrive as data attributes on the block root (Liquid must
  // stay out of assets); the CDN recompiles when tailwind.config is assigned.
  (function() {
    var root = document.querySelector('[data-ul-custom-price-mod2]');
    var d = root ? root.dataset : {};
    var pick = function(key, fallback) { return d[key] && String(d[key]).trim() ? String(d[key]).trim() : fallback; };
    var apply = function() {
      if (!window.tailwind) return false;
      window.tailwind.config = {
        theme: {
          extend: {
            colors: {
              amazon: {
                dark: pick('themeColorSecondary', '#131921'),
                light: pick('themeColorSecondary', '#232f3e'),
                orange: pick('themeColorPrimary', '#ff9900'),
                yellow: pick('themeColorPrimary', '#febd69'),
                link: pick('themeColorLink', '#007185'),
                'link-hover': pick('themeColorLink', '#c45500'),
                price: pick('themeColorPrice', '#B12704'),
                success: pick('themeColorSuccess', '#007600'),
                error: pick('themeColorError', '#cc0c39'),
                warning: pick('themeColorWarning', '#e47911'),
                border: pick('themeColorBorder', '#d5d9d9')
              }
            },
            fontFamily: {
              amazon: [pick('themeFontBody', 'Arial'), 'sans-serif'],
              heading: [pick('themeFontHeading', 'Arial'), 'sans-serif']
            },
            maxWidth: { '2k': '2540px' },
            borderRadius: { 'theme': pick('themeBorderRadius', '4') + 'px' }
          }
        }
      };
      return true;
    };
    if (!apply()) {
      var tries = 0;
      var timer = setInterval(function() { tries += 1; if (apply() || tries > 50) clearInterval(timer); }, 100);
    }
  })();
