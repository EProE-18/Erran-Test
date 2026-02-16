(() => {
  const BASE_WIDTH = 800;
  const BASE_HEIGHT = 600;

  const WALL_LEFT = 40;
  const WALL_RIGHT = BASE_WIDTH - 40;
  const WALL_TOP = 50;
  const DRAIN_Y = BASE_HEIGHT;

  const BRICK_ROWS = 8;
  const BRICK_COLS = 14;
  const BRICK_GAP = 4;
  const BRICK_WIDTH = Math.floor((WALL_RIGHT - WALL_LEFT - BRICK_GAP * (BRICK_COLS - 1)) / BRICK_COLS);
  const BRICK_HEIGHT = 20;

  const SCORE_BY_COLOR = {
    yellow: 1,
    green: 3,
    orange: 5,
    red: 7
  };

  const COLORS = {
    bg: '#000000',
    hud: '#f7f7f7',
    paddle: '#f3f3f3',
    ball: '#ffffff',
    yellow: '#ffd23f',
    green: '#4caf50',
    orange: '#ff8a2a',
    red: '#e53935'
  };

  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d', { alpha: false });

  class AudioSystem {
    constructor() {
      this.context = null;
    }

    ensureContext() {
      if (!this.context) {
        this.context = new AudioContext();
      }
      if (this.context.state === 'suspended') {
        this.context.resume();
      }
    }

    beep({ freq = 440, duration = 0.05, type = 'square', volume = 0.05 }) {
      this.ensureContext();
      const now = this.context.currentTime;
      const osc = this.context.createOscillator();
      const gain = this.context.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(volume, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
      osc.connect(gain);
      gain.connect(this.context.destination);
      osc.start(now);
      osc.stop(now + duration);
    }
  }

  class Paddle {
    constructor() {
      this.fullWidth = 120;
      this.halfWidth = 60;
      this.width = this.fullWidth;
      this.height = 14;
      this.x = BASE_WIDTH / 2;
      this.y = BASE_HEIGHT - 45;
      this.speed = 560;
      this.moveDir = 0;
    }

    resetForWall() {
      this.width = this.fullWidth;
      this.x = BASE_WIDTH / 2;
      this.moveDir = 0;
    }

    shrink() {
      this.width = this.halfWidth;
    }

    update(dt) {
      this.x += this.moveDir * this.speed * dt;
      const half = this.width / 2;
      if (this.x - half < WALL_LEFT) this.x = WALL_LEFT + half;
      if (this.x + half > WALL_RIGHT) this.x = WALL_RIGHT - half;
    }

    setMouseX(x) {
      this.x = x;
      const half = this.width / 2;
      if (this.x - half < WALL_LEFT) this.x = WALL_LEFT + half;
      if (this.x + half > WALL_RIGHT) this.x = WALL_RIGHT - half;
    }

    draw(ctx) {
      ctx.fillStyle = COLORS.paddle;
      ctx.fillRect(this.x - this.width / 2, this.y, this.width, this.height);
    }
  }

  class Ball {
    constructor() {
      this.radius = 7;
      this.baseSpeed = 235;
      this.x = BASE_WIDTH / 2;
      this.y = BASE_HEIGHT - 55;
      this.vx = 0;
      this.vy = 0;
      this.inPlay = false;
      this.enteredTopArea = false;
    }

    resetOnPaddle(paddle) {
      this.inPlay = false;
      this.vx = 0;
      this.vy = 0;
      this.enteredTopArea = false;
      this.x = paddle.x;
      this.y = paddle.y - this.radius - 2;
    }

    serve() {
      if (this.inPlay) return;
      const minAngle = (Math.PI / 180) * 35;
      const maxAngle = (Math.PI / 180) * 70;
      const angle = minAngle + Math.random() * (maxAngle - minAngle);
      const direction = Math.random() < 0.5 ? -1 : 1;
      this.vx = Math.cos(angle) * this.baseSpeed * direction;
      this.vy = -Math.sin(angle) * this.baseSpeed;
      this.inPlay = true;
    }

    speed() {
      return Math.hypot(this.vx, this.vy);
    }

    setSpeed(targetSpeed) {
      const current = this.speed() || 1;
      const scale = targetSpeed / current;
      this.vx *= scale;
      this.vy *= scale;
    }

    draw(ctx) {
      ctx.fillStyle = COLORS.ball;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  class BrickField {
    constructor() {
      this.bricks = [];
      this.topY = 90;
      this.redTopY = this.topY;
      this.createWall();
    }

    createWall() {
      this.bricks = [];
      const rowColorsFromBottom = [
        'yellow',
        'yellow',
        'green',
        'green',
        'orange',
        'orange',
        'red',
        'red'
      ];

      for (let row = 0; row < BRICK_ROWS; row += 1) {
        const color = rowColorsFromBottom[BRICK_ROWS - 1 - row];
        const y = this.topY + row * (BRICK_HEIGHT + BRICK_GAP);
        for (let col = 0; col < BRICK_COLS; col += 1) {
          const x = WALL_LEFT + col * (BRICK_WIDTH + BRICK_GAP);
          this.bricks.push({
            x,
            y,
            w: BRICK_WIDTH,
            h: BRICK_HEIGHT,
            color,
            alive: true
          });
        }
      }

      this.redTopY = this.topY;
    }

    aliveCount() {
      return this.bricks.filter((b) => b.alive).length;
    }

    draw(ctx) {
      for (const brick of this.bricks) {
        if (!brick.alive) continue;
        ctx.fillStyle = COLORS[brick.color];
        ctx.fillRect(brick.x, brick.y, brick.w, brick.h);
      }
    }
  }

  class Game {
    constructor() {
      this.audio = new AudioSystem();
      this.paddle = new Paddle();
      this.ball = new Ball();
      this.brickField = new BrickField();

      this.score = 0;
      this.wallIndex = 1;
      this.turnsRemaining = 3;

      this.hitCount = 0;
      this.orangeContact = false;
      this.redContact = false;
      this.paddleShrunk = false;

      this.gameState = 'ready'; // ready, playing, gameover, victory
      this.lastTime = performance.now();
      this.accumulator = 0;
      this.fixedDt = 1 / 120;

      this.viewScale = 1;
      this.viewOffsetX = 0;
      this.viewOffsetY = 0;

      this.bindInput();
      this.resize();
      this.ball.resetOnPaddle(this.paddle);
      requestAnimationFrame((t) => this.loop(t));
    }

    bindInput() {
      window.addEventListener('resize', () => this.resize());

      window.addEventListener('mousemove', (event) => {
        const world = this.screenToWorld(event.clientX, event.clientY);
        if (!world) return;
        this.paddle.setMouseX(world.x);
        if (!this.ball.inPlay && (this.gameState === 'ready' || this.gameState === 'playing')) {
          this.ball.resetOnPaddle(this.paddle);
        }
      });

      window.addEventListener('mousedown', () => {
        this.serveBall();
      });

      window.addEventListener('keydown', (event) => {
        if (event.code === 'ArrowLeft') this.paddle.moveDir = -1;
        if (event.code === 'ArrowRight') this.paddle.moveDir = 1;

        if (event.code === 'Space') {
          event.preventDefault();
          this.serveBall();
        }

        if (event.code === 'KeyR') {
          this.restart();
        }

        if (event.code === 'Escape') {
          if (window.electronAPI?.quitApp) {
            window.electronAPI.quitApp();
          }
        }
      });

      window.addEventListener('keyup', (event) => {
        if (event.code === 'ArrowLeft' && this.paddle.moveDir < 0) this.paddle.moveDir = 0;
        if (event.code === 'ArrowRight' && this.paddle.moveDir > 0) this.paddle.moveDir = 0;
      });
    }

    restart() {
      this.score = 0;
      this.wallIndex = 1;
      this.turnsRemaining = 3;
      this.hitCount = 0;
      this.orangeContact = false;
      this.redContact = false;
      this.paddleShrunk = false;
      this.gameState = 'ready';

      this.paddle.resetForWall();
      this.ball.resetOnPaddle(this.paddle);
      this.brickField.createWall();
    }

    resetForNextTurn() {
      this.hitCount = 0;
      this.orangeContact = false;
      this.redContact = false;
      this.paddleShrunk = false;
      this.paddle.resetForWall();
      this.ball.resetOnPaddle(this.paddle);
      this.gameState = this.turnsRemaining > 0 ? 'ready' : 'gameover';
    }

    setupNextWall() {
      this.wallIndex += 1;
      if (this.wallIndex > 2) {
        this.gameState = 'victory';
        this.ball.inPlay = false;
        return;
      }

      this.hitCount = 0;
      this.orangeContact = false;
      this.redContact = false;
      this.paddleShrunk = false;
      this.paddle.resetForWall();
      this.ball.resetOnPaddle(this.paddle);
      this.brickField.createWall();
      this.gameState = 'ready';
    }

    serveBall() {
      if (this.gameState === 'gameover' || this.gameState === 'victory') return;
      this.ball.serve();
      if (this.ball.inPlay) {
        this.gameState = 'playing';
      }
    }

    resize() {
      const dpr = window.devicePixelRatio || 1;
      const width = window.innerWidth;
      const height = window.innerHeight;
      const scale = Math.min(width / BASE_WIDTH, height / BASE_HEIGHT);
      const renderWidth = Math.floor(BASE_WIDTH * scale);
      const renderHeight = Math.floor(BASE_HEIGHT * scale);

      canvas.style.width = `${renderWidth}px`;
      canvas.style.height = `${renderHeight}px`;

      canvas.width = Math.floor(renderWidth * dpr);
      canvas.height = Math.floor(renderHeight * dpr);

      ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);

      this.viewScale = scale;
      this.viewOffsetX = (width - renderWidth) / 2;
      this.viewOffsetY = (height - renderHeight) / 2;
    }

    screenToWorld(clientX, clientY) {
      const x = clientX - this.viewOffsetX;
      const y = clientY - this.viewOffsetY;
      if (x < 0 || y < 0 || x > BASE_WIDTH * this.viewScale || y > BASE_HEIGHT * this.viewScale) {
        return null;
      }
      return {
        x: x / this.viewScale,
        y: y / this.viewScale
      };
    }

    currentSpeedStage() {
      let stage = 0;
      if (this.hitCount >= 4) stage = Math.max(stage, 1);
      if (this.hitCount >= 12) stage = Math.max(stage, 2);
      if (this.orangeContact) stage = Math.max(stage, 3);
      if (this.redContact) stage = Math.max(stage, 4);
      return stage;
    }

    applySpeedStage() {
      if (!this.ball.inPlay) return;
      const speedByStage = [235, 270, 310, 345, 380];
      this.ball.setSpeed(speedByStage[this.currentSpeedStage()]);
    }

    registerHit() {
      this.hitCount += 1;
      this.applySpeedStage();
    }

    reflectFromPaddle() {
      const relative = (this.ball.x - this.paddle.x) / (this.paddle.width / 2);
      const clamped = Math.max(-1, Math.min(1, relative));

      const minAngle = (Math.PI / 180) * 22;
      const maxAngle = (Math.PI / 180) * 70;
      const angle = minAngle + (maxAngle - minAngle) * Math.abs(clamped);
      const dir = clamped >= 0 ? 1 : -1;

      const speed = this.ball.speed();
      this.ball.vx = Math.cos(angle) * speed * dir;
      this.ball.vy = -Math.sin(angle) * speed;
    }

    handleBrickCollision() {
      const ballLeft = this.ball.x - this.ball.radius;
      const ballRight = this.ball.x + this.ball.radius;
      const ballTop = this.ball.y - this.ball.radius;
      const ballBottom = this.ball.y + this.ball.radius;

      let chosen = null;
      let chosenPenX = 0;
      let chosenPenY = 0;
      let bestPen = -Infinity;

      for (const brick of this.brickField.bricks) {
        if (!brick.alive) continue;

        const overlaps =
          ballRight >= brick.x &&
          ballLeft <= brick.x + brick.w &&
          ballBottom >= brick.y &&
          ballTop <= brick.y + brick.h;

        if (!overlaps) continue;

        const penX = Math.min(ballRight - brick.x, brick.x + brick.w - ballLeft);
        const penY = Math.min(ballBottom - brick.y, brick.y + brick.h - ballTop);

        const axisPen = Math.max(penX, penY);
        if (axisPen > bestPen) {
          bestPen = axisPen;
          chosen = brick;
          chosenPenX = penX;
          chosenPenY = penY;
        }
      }

      if (!chosen) return false;

      chosen.alive = false;
      this.score += SCORE_BY_COLOR[chosen.color];
      this.registerHit();

      if (!this.orangeContact && chosen.color === 'orange') {
        this.orangeContact = true;
        this.applySpeedStage();
      }
      if (!this.redContact && chosen.color === 'red') {
        this.redContact = true;
        this.applySpeedStage();
      }

      // For ambiguous corner cases we resolve the bounce on the axis with greatest penetration.
      if (chosenPenX > chosenPenY) {
        this.ball.vx *= -1;
      } else {
        this.ball.vy *= -1;
      }

      this.audio.beep({ freq: 720, duration: 0.04, type: 'square', volume: 0.04 });
      return true;
    }

    updateBall(dt) {
      if (!this.ball.inPlay) {
        this.ball.x = this.paddle.x;
        this.ball.y = this.paddle.y - this.ball.radius - 2;
        return;
      }

      const distance = this.ball.speed() * dt;
      const substeps = Math.max(1, Math.ceil(distance / (this.ball.radius * 0.5)));
      const stepDt = dt / substeps;

      for (let i = 0; i < substeps; i += 1) {
        this.ball.x += this.ball.vx * stepDt;
        this.ball.y += this.ball.vy * stepDt;

        if (this.ball.y - this.ball.radius <= this.brickField.redTopY) {
          this.ball.enteredTopArea = true;
        }

        if (this.ball.x - this.ball.radius <= WALL_LEFT) {
          this.ball.x = WALL_LEFT + this.ball.radius;
          this.ball.vx = Math.abs(this.ball.vx);
          this.registerHit();
          this.audio.beep({ freq: 500, duration: 0.03, type: 'triangle', volume: 0.03 });
        }

        if (this.ball.x + this.ball.radius >= WALL_RIGHT) {
          this.ball.x = WALL_RIGHT - this.ball.radius;
          this.ball.vx = -Math.abs(this.ball.vx);
          this.registerHit();
          this.audio.beep({ freq: 500, duration: 0.03, type: 'triangle', volume: 0.03 });
        }

        if (this.ball.y - this.ball.radius <= WALL_TOP) {
          this.ball.y = WALL_TOP + this.ball.radius;
          this.ball.vy = Math.abs(this.ball.vy);
          this.registerHit();

          if (this.ball.enteredTopArea && !this.paddleShrunk) {
            this.paddle.shrink();
            this.paddleShrunk = true;
          }

          this.audio.beep({ freq: 420, duration: 0.03, type: 'triangle', volume: 0.03 });
        }

        const paddleTop = this.paddle.y;
        const paddleLeft = this.paddle.x - this.paddle.width / 2;
        const paddleRight = this.paddle.x + this.paddle.width / 2;
        const hitPaddle =
          this.ball.vy > 0 &&
          this.ball.y + this.ball.radius >= paddleTop &&
          this.ball.y - this.ball.radius <= paddleTop + this.paddle.height &&
          this.ball.x >= paddleLeft &&
          this.ball.x <= paddleRight;

        if (hitPaddle) {
          this.ball.y = paddleTop - this.ball.radius;
          this.reflectFromPaddle();
          this.registerHit();
          this.audio.beep({ freq: 260, duration: 0.05, type: 'square', volume: 0.05 });
        }

        const hitBrick = this.handleBrickCollision();
        if (hitBrick && this.brickField.aliveCount() === 0) {
          this.setupNextWall();
          return;
        }

        if (this.ball.y - this.ball.radius > DRAIN_Y) {
          this.turnsRemaining -= 1;
          this.audio.beep({ freq: 120, duration: 0.15, type: 'sawtooth', volume: 0.06 });
          this.resetForNextTurn();
          return;
        }
      }
    }

    update(dt) {
      if (this.gameState === 'gameover' || this.gameState === 'victory') return;
      this.paddle.update(dt);
      this.updateBall(dt);
    }

    drawHUD() {
      ctx.fillStyle = COLORS.hud;
      ctx.font = '20px Trebuchet MS, Arial, sans-serif';
      ctx.textBaseline = 'top';
      ctx.fillText(`Score: ${this.score}`, 14, 12);
      ctx.fillText(`Wall: ${Math.min(this.wallIndex, 2)}/2`, 320, 12);
      ctx.fillText(`Turns: ${this.turnsRemaining}`, 640, 12);
    }

    drawOverlay() {
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffffff';

      if (this.gameState === 'ready') {
        ctx.font = '30px Trebuchet MS, Arial, sans-serif';
        ctx.fillText('Press Space to Serve', BASE_WIDTH / 2, BASE_HEIGHT / 2 - 12);
        ctx.font = '18px Trebuchet MS, Arial, sans-serif';
        ctx.fillText('Move: Mouse or Arrow Keys   |   Serve: Space/Click   |   Restart: R   |   Quit: Esc', BASE_WIDTH / 2, BASE_HEIGHT / 2 + 26);
      }

      if (this.gameState === 'gameover' || this.gameState === 'victory') {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
        ctx.fillRect(0, 0, BASE_WIDTH, BASE_HEIGHT);

        ctx.fillStyle = '#ffffff';
        ctx.font = '46px Trebuchet MS, Arial, sans-serif';
        ctx.fillText(this.gameState === 'victory' ? 'Victory!' : 'Game Over', BASE_WIDTH / 2, BASE_HEIGHT / 2 - 90);

        ctx.font = '26px Trebuchet MS, Arial, sans-serif';
        ctx.fillText(`Final Score: ${this.score}`, BASE_WIDTH / 2, BASE_HEIGHT / 2 - 28);
        ctx.fillText(`Walls Cleared: ${this.gameState === 'victory' ? 2 : this.wallIndex - 1}`, BASE_WIDTH / 2, BASE_HEIGHT / 2 + 12);

        ctx.font = '20px Trebuchet MS, Arial, sans-serif';
        ctx.fillText('Press R to Restart', BASE_WIDTH / 2, BASE_HEIGHT / 2 + 58);
      }

      ctx.textAlign = 'start';
    }

    draw() {
      ctx.fillStyle = COLORS.bg;
      ctx.fillRect(0, 0, BASE_WIDTH, BASE_HEIGHT);

      ctx.strokeStyle = '#2f2f2f';
      ctx.lineWidth = 2;
      ctx.strokeRect(WALL_LEFT, WALL_TOP, WALL_RIGHT - WALL_LEFT, BASE_HEIGHT - WALL_TOP);

      this.brickField.draw(ctx);
      this.paddle.draw(ctx);
      this.ball.draw(ctx);
      this.drawHUD();
      this.drawOverlay();
    }

    loop(timestamp) {
      const delta = Math.min(0.05, (timestamp - this.lastTime) / 1000);
      this.lastTime = timestamp;
      this.accumulator += delta;

      while (this.accumulator >= this.fixedDt) {
        this.update(this.fixedDt);
        this.accumulator -= this.fixedDt;
      }

      this.draw();
      requestAnimationFrame((t) => this.loop(t));
    }
  }

  new Game();
})();
