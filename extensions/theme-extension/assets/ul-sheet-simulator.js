

(function () {
  'use strict';

  if (window.ULSheetSimulator) return;

  var COLORS = {
    sheetBg: '#ffffff',
    sheetBorder: '#e2e8f0',
    sheetShadow: 'rgba(0, 0, 0, 0.06)',
    designFill: 'rgba(99, 102, 241, 0.12)',
    designStroke: '#6366f1',
    designStrokeHover: '#4f46e5',
    designText: '#6366f1',
    designRotatedFill: 'rgba(124, 58, 237, 0.1)',
    designRotatedStroke: '#7c3aed',
    marginLine: '#f1f5f9',
    marginDash: '#cbd5e1',
    gapLine: 'rgba(148, 163, 184, 0.3)',
    dimensionText: '#94a3b8',
    dimensionLine: '#cbd5e1',
    labelBg: 'rgba(255, 255, 255, 0.92)',
    wasteFill: 'rgba(239, 68, 68, 0.04)',
    indexText: '#8b5cf6',
    gridDot: 'rgba(226, 232, 240, 0.5)',
  };

  function SheetSimulator(canvas, options) {
    if (!canvas || !canvas.getContext) {
      throw new Error('Invalid canvas element');
    }

    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.options = Object.assign(
      {
        padding: 32,
        showDimensions: true,
        showGrid: false,
        showMargins: true,
        showDesignIndex: true,
        showGaps: false,
        animateIn: true,
        designImage: null,
        maxCanvasWidth: 600,
        maxCanvasHeight: 400,
      },
      options || {}
    );

    this.layout = null;
    this.sheet = null;
    this.scale = 1;
    this.margin = 0;
    this.animationFrame = null;
    this.hoveredDesign = -1;
    this.tooltipCallback = null;

    this._bindEvents();
  }

  SheetSimulator.prototype.setLayout = function (layout, sheet, marginInch) {
    this.layout = layout;
    this.sheet = sheet;
    this.margin = marginInch || 0;

    this._calculateScale();

    if (this.options.animateIn) {
      this._animateRender();
    } else {
      this.render(1);
    }
  };

  SheetSimulator.prototype._calculateScale = function () {
    if (!this.sheet) return;

    var padding = this.options.padding;
    var dimSpace = this.options.showDimensions ? 28 : 0;

    var containerWidth = this.canvas.parentElement
      ? this.canvas.parentElement.clientWidth - 32
      : this.options.maxCanvasWidth;

    var availWidth = Math.min(containerWidth, this.options.maxCanvasWidth) - padding * 2 - dimSpace;
    var availHeight = this.options.maxCanvasHeight - padding * 2 - dimSpace;

    var scaleX = availWidth / this.sheet.widthInch;
    var scaleY = availHeight / this.sheet.heightInch;
    this.scale = Math.min(scaleX, scaleY);

    var canvasWidth = Math.ceil(this.sheet.widthInch * this.scale + padding * 2 + dimSpace);
    var canvasHeight = Math.ceil(this.sheet.heightInch * this.scale + padding * 2 + dimSpace);

    var dpr = window.devicePixelRatio || 1;
    this.canvas.width = canvasWidth * dpr;
    this.canvas.height = canvasHeight * dpr;
    this.canvas.style.width = canvasWidth + 'px';
    this.canvas.style.height = canvasHeight + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this.originX = padding + dimSpace;
    this.originY = padding;
  };

  SheetSimulator.prototype._animateRender = function () {
    var self = this;
    var startTime = performance.now();
    var duration = 500;
    var designCount = this.layout ? this.layout.placements.length : 0;

    function frame(now) {
      var elapsed = now - startTime;
      var progress = Math.min(elapsed / duration, 1);

      var eased = 1 - Math.pow(1 - progress, 3);

      self.render(eased);

      if (progress < 1) {
        self.animationFrame = requestAnimationFrame(frame);
      }
    }

    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
    }

    this.animationFrame = requestAnimationFrame(frame);
  };

  SheetSimulator.prototype.render = function (progress) {
    progress = progress === undefined ? 1 : progress;

    var ctx = this.ctx;
    var s = this.scale;
    var ox = this.originX;
    var oy = this.originY;

    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    if (!this.layout || !this.sheet) return;

    var sw = this.sheet.widthInch * s;
    var sh = this.sheet.heightInch * s;

    ctx.save();
    ctx.shadowColor = COLORS.sheetShadow;
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 4;
    ctx.fillStyle = COLORS.sheetBg;
    this._roundRect(ctx, ox, oy, sw, sh, 4);
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = COLORS.sheetBorder;
    ctx.lineWidth = 1;
    this._roundRect(ctx, ox, oy, sw, sh, 4);
    ctx.stroke();

    if (this.options.showGrid) {
      this._drawGrid(ctx, ox, oy, sw, sh, s);
    }

    if (this.options.showMargins && this.margin > 0) {
      var m = this.margin * s;
      ctx.strokeStyle = COLORS.marginDash;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(ox + m, oy + m, sw - 2 * m, sh - 2 * m);
      ctx.setLineDash([]);
    }

    var placements = this.layout.placements;
    var designsToShow = Math.ceil(placements.length * progress);

    for (var i = 0; i < designsToShow; i++) {
      var p = placements[i];
      var dx = ox + p.x * s;
      var dy = oy + p.y * s;
      var dw = p.width * s;
      var dh = p.height * s;

      var designProgress = Math.min((progress * placements.length - i) * 2, 1);
      if (designProgress <= 0) continue;

      var alpha = designProgress;
      var scaleAnim = 0.8 + 0.2 * designProgress;

      ctx.save();
      ctx.globalAlpha = alpha;

      var cx = dx + dw / 2;
      var cy = dy + dh / 2;
      ctx.translate(cx, cy);
      ctx.scale(scaleAnim, scaleAnim);
      ctx.translate(-cx, -cy);

      var isHovered = i === this.hoveredDesign;
      var isRotated = p.rotated;
      ctx.fillStyle = isRotated ? COLORS.designRotatedFill : COLORS.designFill;
      if (isHovered) {
        ctx.fillStyle = 'rgba(99, 102, 241, 0.2)';
      }
      this._roundRect(ctx, dx, dy, dw, dh, 3);
      ctx.fill();

      ctx.strokeStyle = isRotated ? COLORS.designRotatedStroke : COLORS.designStroke;
      if (isHovered) {
        ctx.strokeStyle = COLORS.designStrokeHover;
        ctx.lineWidth = 2;
      } else {
        ctx.lineWidth = 1.5;
      }
      ctx.stroke();

      if (this.options.designImage && this.options.designImage.complete) {
        var imgPad = 4;
        ctx.drawImage(
          this.options.designImage,
          dx + imgPad,
          dy + imgPad,
          dw - imgPad * 2,
          dh - imgPad * 2
        );
      } else if (this.options.showDesignIndex && dw > 20 && dh > 16) {
        ctx.fillStyle = COLORS.indexText;
        ctx.font = '600 ' + Math.max(9, Math.min(13, dw * 0.18)) + 'px ' + 'system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('#' + (p.index + 1), cx, cy);
      }

      if (isRotated && dw > 28 && dh > 28) {
        ctx.fillStyle = COLORS.designRotatedStroke;
        ctx.font = '10px system-ui, sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        ctx.fillText('↻', dx + dw - 4, dy + 3);
      }

      ctx.restore();
    }

    if (this.options.showDimensions) {
      this._drawDimensions(ctx, ox, oy, sw, sh);
    }
  };

  SheetSimulator.prototype._drawGrid = function (ctx, ox, oy, sw, sh, scale) {
    var gridStep = scale;
    ctx.fillStyle = COLORS.gridDot;

    for (var x = gridStep; x < sw; x += gridStep) {
      for (var y = gridStep; y < sh; y += gridStep) {
        ctx.beginPath();
        ctx.arc(ox + x, oy + y, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  };

  SheetSimulator.prototype._drawDimensions = function (ctx, ox, oy, sw, sh) {
    ctx.fillStyle = COLORS.dimensionText;
    ctx.font = '500 11px system-ui, sans-serif';

    var widthLabel = this.sheet.widthInch + '"';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(widthLabel, ox + sw / 2, oy - 8);

    ctx.strokeStyle = COLORS.dimensionLine;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(ox, oy - 14);
    ctx.lineTo(ox + sw, oy - 14);
    ctx.stroke();

    this._drawArrowTip(ctx, ox, oy - 14, 'left');
    this._drawArrowTip(ctx, ox + sw, oy - 14, 'right');

    var heightLabel = this.sheet.heightInch + '"';
    ctx.save();
    ctx.translate(ox - 14, oy + sh / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(heightLabel, 0, 0);
    ctx.restore();

    ctx.beginPath();
    ctx.moveTo(ox - 20, oy);
    ctx.lineTo(ox - 20, oy + sh);
    ctx.stroke();

    this._drawArrowTip(ctx, ox - 20, oy, 'up');
    this._drawArrowTip(ctx, ox - 20, oy + sh, 'down');
  };

  SheetSimulator.prototype._drawArrowTip = function (ctx, x, y, direction) {
    var size = 4;
    ctx.fillStyle = COLORS.dimensionLine;
    ctx.beginPath();

    switch (direction) {
      case 'left':
        ctx.moveTo(x, y);
        ctx.lineTo(x + size, y - size / 2);
        ctx.lineTo(x + size, y + size / 2);
        break;
      case 'right':
        ctx.moveTo(x, y);
        ctx.lineTo(x - size, y - size / 2);
        ctx.lineTo(x - size, y + size / 2);
        break;
      case 'up':
        ctx.moveTo(x, y);
        ctx.lineTo(x - size / 2, y + size);
        ctx.lineTo(x + size / 2, y + size);
        break;
      case 'down':
        ctx.moveTo(x, y);
        ctx.lineTo(x - size / 2, y - size);
        ctx.lineTo(x + size / 2, y - size);
        break;
    }

    ctx.closePath();
    ctx.fill();
  };

  SheetSimulator.prototype._roundRect = function (ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  };

  SheetSimulator.prototype._bindEvents = function () {
    var self = this;

    this.canvas.addEventListener('mousemove', function (e) {
      var rect = self.canvas.getBoundingClientRect();
      var x = e.clientX - rect.left;
      var y = e.clientY - rect.top;

      var prevHovered = self.hoveredDesign;
      self.hoveredDesign = self._hitTest(x, y);

      if (self.hoveredDesign !== prevHovered) {
        self.render(1);

        if (self.hoveredDesign >= 0 && self.tooltipCallback) {
          var p = self.layout.placements[self.hoveredDesign];
          self.tooltipCallback({
            index: self.hoveredDesign,
            x: e.clientX,
            y: e.clientY,
            width: p.width,
            height: p.height,
            rotated: p.rotated,
          });
        }
      }

      self.canvas.style.cursor = self.hoveredDesign >= 0 ? 'pointer' : 'default';
    });

    this.canvas.addEventListener('mouseleave', function () {
      if (self.hoveredDesign >= 0) {
        self.hoveredDesign = -1;
        self.render(1);
      }
      self.canvas.style.cursor = 'default';
    });
  };

  SheetSimulator.prototype._hitTest = function (mx, my) {
    if (!this.layout || !this.layout.placements) return -1;

    var s = this.scale;
    var ox = this.originX;
    var oy = this.originY;

    for (var i = this.layout.placements.length - 1; i >= 0; i--) {
      var p = this.layout.placements[i];
      var dx = ox + p.x * s;
      var dy = oy + p.y * s;
      var dw = p.width * s;
      var dh = p.height * s;

      if (mx >= dx && mx <= dx + dw && my >= dy && my <= dy + dh) {
        return i;
      }
    }

    return -1;
  };

  SheetSimulator.prototype.onTooltip = function (callback) {
    this.tooltipCallback = callback;
  };

  SheetSimulator.prototype.setDesignImage = function (imageUrl) {
    if (!imageUrl) {
      this.options.designImage = null;
      this.render(1);
      return;
    }

    var self = this;
    var img = new Image();
    img.onload = function () {
      self.options.designImage = img;
      self.render(1);
    };
    img.src = imageUrl;
  };

  SheetSimulator.prototype.toggleGrid = function () {
    this.options.showGrid = !this.options.showGrid;
    this.render(1);
  };

  SheetSimulator.prototype.toggleDimensions = function () {
    this.options.showDimensions = !this.options.showDimensions;
    this._calculateScale();
    this.render(1);
  };

  SheetSimulator.prototype.toggleMargins = function () {
    this.options.showMargins = !this.options.showMargins;
    this.render(1);
  };

  SheetSimulator.prototype.exportImage = function () {
    return this.canvas.toDataURL('image/png');
  };

  SheetSimulator.prototype.destroy = function () {
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
    }
    this.layout = null;
    this.sheet = null;
    this.ctx = null;
    this.canvas = null;
  };

  function create(canvas, options) {
    return new SheetSimulator(canvas, options);
  }

  window.ULSheetSimulator = {
    create: create,
    COLORS: COLORS,
  };
})();
