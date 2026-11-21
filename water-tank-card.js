/* Standalone Home Assistant card. No changes to firmware or phone notifications. */
class WaterTankCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.enabled = false;
    this.muted = false;
    this.low = false;
    this.voices = new Set();
    this.sound = 'double';
    this.volume = 0.3;
  }

  setConfig(config) {
    if (!config.entity || !config.threshold_entity) {
      throw new Error('Укажите entity и threshold_entity');
    }
    this.stop();
    this.config = { name: 'Бак воды', ...config };
    this.shapes = { vertical: 'Круглый вертикальный', square: 'Квадратный', horizontal: 'Горизонтальный' };
    this.colors = { blue: 'Синий пластик', white: 'Белый пластик', metal: 'Красный металл' };
    this.shape = Object.hasOwn(this.shapes, config.tank_shape) ? config.tank_shape : 'vertical';
    this.color = Object.hasOwn(this.colors, config.tank_color) ? config.tank_color : 'blue';
    this.key = `water-tank-sound:${config.entity}`;
    try {
      const saved = JSON.parse(localStorage.getItem(this.key) || '{}');
      if (['double', 'triple', 'siren'].includes(saved.sound)) this.sound = saved.sound;
      if (Number.isFinite(saved.volume)) this.volume = Math.max(0, Math.min(1, saved.volume));
      if (!config.tank_shape && Object.hasOwn(this.shapes, saved.shape)) this.shape = saved.shape;
      if (!config.tank_color && Object.hasOwn(this.colors, saved.color)) this.color = saved.color;
    } catch (_) { /* Storage can be disabled by the browser. */ }
    this.build();
    this.update();
  }

  set hass(value) { this._hass = value; this.update(); }
  connectedCallback() { this.update(); }
  disconnectedCallback() {
    this.stop();
    this.enabled = false;
    if (this.audio) this.audio.close().catch(() => {});
    this.audio = null;
  }
  getCardSize() { return 7; }
  getGridOptions() { return { columns: 12, rows: 7, min_columns: 6 }; }

  number(entity) {
    const state = this._hass?.states?.[entity]?.state;
    if (state == null || String(state).trim() === '') return null;
    const value = Number(state);
    return Number.isFinite(value) ? value : null;
  }

  build() {
    this.shadowRoot.innerHTML = `
      <style>
        ha-card { padding:22px; color:var(--primary-text-color); }
        h2 { margin:0 0 16px; font-size:21px; }
        .main { display:flex; gap:20px; flex-wrap:wrap; align-items:center; justify-content:center; }
        .vessel { --shell:#167bc0; --edge:#084d87; position:relative; width:210px; height:225px; flex-shrink:0; }
        .vessel[data-color="white"] { --shell:#d9e0e5; --edge:#82929d; }
        .vessel[data-color="metal"] { --shell:#b65c48; --edge:#783b30; }
        .tank { position:absolute; left:28px; top:30px; width:150px; height:180px;
          border:3px solid var(--edge); border-radius:50% / 12%; overflow:hidden;
          background:linear-gradient(100deg,var(--shell),#ffffff28 35%,var(--shell));
          box-shadow:inset -12px 0 16px #0003, inset 8px 0 10px #fff2, 0 10px 12px #0002; }
        .lid { position:absolute; z-index:2; top:15px; left:77px; width:56px; height:15px;
          border-radius:50%; border:4px solid var(--edge); background:#29363e; box-shadow:0 5px 0 var(--shell); }
        .ribs { position:absolute; inset:0; background:repeating-linear-gradient(0deg,transparent 0 34px,#001e4438 35px 38px,#ffffff38 39px 40px); }
        .feet { display:none; position:absolute; bottom:4px; left:35px; width:140px; height:26px;
          border-left:14px solid var(--edge); border-right:14px solid var(--edge); box-sizing:border-box; }
        .outlet { position:absolute; bottom:22px; left:93px; width:15px; height:15px; border-radius:50%;
          border:4px solid #cad7df; background:#223640; box-shadow:1px 2px 2px #0006; }
        .vessel[data-shape="square"] .tank { left:15px; top:48px; width:174px; height:154px; border-radius:16px 16px 22px 22px; }
        .vessel[data-shape="square"] .lid { top:32px; }
        .vessel[data-shape="square"] .ribs { background:repeating-linear-gradient(90deg,transparent 0 30px,#001e4438 31px 39px,#ffffff38 40px 43px); }
        .vessel[data-shape="horizontal"] .tank { left:2px; top:60px; width:200px; height:130px; border-radius:65px; }
        .vessel[data-shape="horizontal"] .lid { top:44px; }
        .vessel[data-shape="horizontal"] .feet { display:block; bottom:17px; }
        .vessel[data-shape="horizontal"] .outlet { left:26px; bottom:53px; }
        .vessel[data-shape="horizontal"] .ribs { border-left:3px solid #ffffff38; border-right:3px solid #001e4438;
          inset:0 28px; border-radius:30%; background:repeating-linear-gradient(90deg,transparent 0 32px,#001e4438 33px 36px,#ffffff38 37px 39px); }
        .vessel[data-color="metal"] .ribs { background:none; }
        .water { position:absolute; bottom:0; width:100%; background:linear-gradient(#39c8ed,#177bc7);
          transition:height 1s; border-top:3px solid #9ce9ff; box-sizing:border-box; }
        .tank:after { content:''; position:absolute; inset:15px 14px; border-left:6px solid #ffffff30; border-radius:10px; }
        .percent { font-size:36px; font-weight:700; } .liters { font-size:21px; margin:8px 0; }
        .meta, .hint { color:var(--secondary-text-color); font-size:13px; line-height:1.6; }
        .alarm { min-height:26px; margin:16px 0 8px; font-weight:600; }
        .alert { color:#ef5350; animation:blink 1.2s infinite; }
        @keyframes blink { 50% { opacity:.4; } }
        @media(prefers-reduced-motion:reduce) { .alert { animation:none; } }
        .controls { display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin:10px 0; }
        button, select { background:var(--secondary-background-color,#eee); color:var(--primary-text-color,#222);
          border:1px solid var(--divider-color,#aaa); border-radius:10px; padding:10px; font:inherit; }
        button { cursor:pointer; } button:disabled { opacity:.5; cursor:default; }
        input { max-width:140px; vertical-align:middle; } label { font-size:14px; }
      </style>
      <ha-card>
        <h2></h2>
        <div class="main"><div class="vessel" role="img" aria-label="Бак воды">
          <div class="feet"></div><div class="tank"><div class="water"></div><div class="ribs"></div></div>
          <div class="lid"></div><div class="outlet"></div></div>
          <div><div class="percent">—</div><div class="liters">—</div><div class="meta"></div></div>
        </div>
        <div class="alarm" role="status" aria-live="polite"></div>
        <div class="controls">
          <button id="enable"></button><button id="mute">Заглушить тревогу</button>
        </div>
        <div class="controls">
          <select id="sound" aria-label="Звук тревоги"><option value="double">Двойной сигнал</option>
            <option value="triple">Тройной сигнал</option><option value="siren">Сирена</option></select>
          <button id="test">Проверить звук</button>
          <label>Громкость <input type="range" min="0" max="100" aria-label="Громкость"></label>
        </div>
        <details><summary>Внешний вид бака</summary><div class="controls">
          <select id="shape" aria-label="Форма бака"></select>
          <select id="color" aria-label="Материал и цвет бака"></select>
        </div></details>
        <div class="hint">Звук работает на этом компьютере, пока панель открыта и компьютер не спит.</div>
        <div id="audio-status" class="hint" role="status"></div>
      </ha-card>`;
    const root = this.shadowRoot;
    root.querySelector('h2').textContent = this.config.name;
    root.querySelector('#sound').value = this.sound;
    root.querySelector('input').value = this.volume * 100;
    root.querySelector('#sound').onchange = e => { this.sound = e.target.value; this.save(); };
    for (const [id, options] of [['shape', this.shapes], ['color', this.colors]]) {
      const select = root.querySelector(`#${id}`);
      for (const [value, label] of Object.entries(options)) select.add(new Option(label, value));
      select.value = this[id];
      select.onchange = e => { this[id] = e.target.value; this.appearance(); this.save(); };
    }
    this.appearance();
    root.querySelector('input').oninput = e => { this.volume = Number(e.target.value) / 100; this.save(); };
    root.querySelector('#enable').onclick = async () => {
      if (this.enabled) { this.enabled = false; this.stop(); }
      else if (await this.unlock()) { this.enabled = true; }
      this.update();
    };
    root.querySelector('#mute').onclick = () => { this.muted = true; this.stop(); this.update(); };
    root.querySelector('#test').onclick = async () => { if (await this.unlock()) this.play(); };
  }

  save() {
    try { localStorage.setItem(this.key, JSON.stringify({ sound: this.sound, volume: this.volume, shape: this.shape, color: this.color })); } catch (_) {}
  }
  appearance() {
    const vessel = this.shadowRoot.querySelector('.vessel');
    vessel.dataset.shape = this.shape;
    vessel.dataset.color = this.color;
    vessel.setAttribute('aria-label', `${this.shapes[this.shape]}, ${this.colors[this.color]}`);
  }
  async unlock() {
    try {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!this.audio || this.audio.state === 'closed') this.audio = new Audio();
      await this.audio.resume();
      if (this.audio.state !== 'running') throw new Error('Audio suspended');
      this.shadowRoot.querySelector('#audio-status').textContent = '';
      return true;
    } catch (_) {
      this.shadowRoot.querySelector('#audio-status').textContent = 'Браузер не разрешил звук. Проверьте разрешения сайта.';
      return false;
    }
  }

  update() {
    if (!this.config || !this.shadowRoot.querySelector('ha-card')) return;
    const level = this.number(this.config.entity);
    const threshold = this.number(this.config.threshold_entity);
    const validity = this.config.valid_entity ? this._hass?.states?.[this.config.valid_entity]?.state : null;
    const valid = this._hass?.connected !== false && level !== null && level >= 0 && level <= 100 &&
      threshold !== null && threshold >= 0 && threshold <= 100 &&
      (!this.config.valid_entity || ['true', 'on', '1'].includes(String(validity).toLowerCase()));
    // A missing measurement is not an empty tank and does not acknowledge an existing alarm.
    if (valid && level > threshold) this.muted = false;
    this.low = valid && level <= threshold;
    const root = this.shadowRoot;
    root.querySelector('.water').style.height = `${valid ? level : 0}%`;
    root.querySelector('.water').style.background = this.low ? '#e85c49' : '';
    root.querySelector('.percent').textContent = valid ? `${level.toFixed(1)}%` : '—';
    const liters = this.number(this.config.volume_entity);
    root.querySelector('.liters').textContent = valid && liters !== null && liters >= 0 ? `${liters.toFixed(1)} л` : '— л';
    const distance = this.number(this.config.distance_entity);
    root.querySelector('.meta').textContent = `Порог: ${threshold === null ? '—' : threshold}% · Расстояние: ${distance !== null && distance >= 0 ? distance.toFixed(1) + ' см' : 'нет данных'}`;
    root.querySelector('.alarm').textContent = !valid ? 'Нет достоверных данных' : this.low ?
      (this.muted ? '⚠ Низкий уровень · звук заглушён' : '⚠ Достигнут нижний порог воды') : 'Уровень воды в норме';
    root.querySelector('.alarm').classList.toggle('alert', this.low);
    root.querySelector('#enable').textContent = this.enabled ? 'Выключить звук' : 'Включить звук';
    root.querySelector('#mute').disabled = !this.low || this.muted;
    if (this.enabled && this.low && !this.muted && this.isConnected) {
      if (!this.timer) {
        this.play();
        this.timer = setInterval(() => this.play(), 10000);
      }
    } else if (this.timer) this.stop();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    for (const voice of this.voices) { try { voice.stop(); } catch (_) {} }
    this.voices.clear();
  }

  play() {
    if (!this.audio || this.audio.state !== 'running') {
      this.shadowRoot.querySelector('#audio-status').textContent = 'Звук приостановлен браузером. Выключите и снова включите звук.';
      return;
    }
    // Cancel the previous short pattern to avoid overlapping test/alarm sounds.
    for (const voice of this.voices) { try { voice.stop(); } catch (_) {} }
    this.voices.clear();
    const pattern = this.sound === 'siren' ? [[0, 600, 1.2, 1100], [1.25, 1100, 1.2, 600]] :
      this.sound === 'triple' ? [[0, 660, .2], [.3, 880, .2], [.6, 1100, .35]] : [[0, 880, .25], [.4, 880, .25]];
    for (const [offset, frequency, duration, endFrequency] of pattern) {
      const oscillator = this.audio.createOscillator();
      const gain = this.audio.createGain();
      const start = this.audio.currentTime + offset;
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency, start);
      if (endFrequency) oscillator.frequency.linearRampToValueAtTime(endFrequency, start + duration);
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(this.volume * .35, start + .02);
      gain.gain.setValueAtTime(this.volume * .35, start + duration - .03);
      gain.gain.linearRampToValueAtTime(0, start + duration);
      oscillator.connect(gain).connect(this.audio.destination);
      this.voices.add(oscillator);
      oscillator.onended = () => { this.voices.delete(oscillator); oscillator.disconnect(); gain.disconnect(); };
      oscillator.start(start);
      oscillator.stop(start + duration + .01);
    }
  }
}

if (!customElements.get('water-tank-card')) customElements.define('water-tank-card', WaterTankCard);
window.customCards = window.customCards || [];
window.customCards.push({ type: 'water-tank-card', name: 'Бак воды', description: 'Уровень воды и звуковая тревога на компьютере' });
